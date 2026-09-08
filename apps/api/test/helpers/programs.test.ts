/**
 * 4.1.1 — integration smoke tests for the program seed helpers
 * (`insertProgram`, `insertSlotSet`, `insertSession`, `seedActiveProgram`,
 * `insertOtherPrincipalProgram`) and `loadOwnedProgram`'s ownership/realm
 * guards, against the real `attention_lab_test` database via `buildTestApp`
 * (3.2.1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { addDays } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from './buildTestApp.js'
import { benchmarkSlots, focusSessions, programs, protocolRevisions } from '../../src/db/schema/index.js'
import { deriveContext } from '../../src/plugins/identity.js'
import { loadOwnedProgram } from '../../src/services/program/programService.js'
import { DomainError, NotFoundError } from '../../src/errors.js'
import {
  insertOtherPrincipalProgram,
  insertProgram,
  insertSession,
  insertSlotSet,
  seedActiveProgram,
} from './programs.js'

function demoCtx() {
  return deriveContext({ identityMode: 'local-demo', offsetSeconds: 0, realNow: new Date() })
}

describe('program seed helpers (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  it('(1) insertProgram writes one programs row and one revision-1 row, and links current_revision_id', async () => {
    const { programId, revisionId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const programRows = await testApp.db.select().from(programs)
    expect(programRows).toHaveLength(1)
    expect(programRows[0]?.id).toBe(programId)
    expect(programRows[0]?.realm).toBe('demo')
    expect(programRows[0]?.currentRevisionId).toBe(revisionId)

    const revisionRows = await testApp.db.select().from(protocolRevisions)
    expect(revisionRows).toHaveLength(1)
    expect(revisionRows[0]).toMatchObject({
      id: revisionId,
      revision: 1,
      effectiveDay: 0,
      reason: 'initial plan',
    })
  })

  it('(2) insertSlotSet inserts four rows: baseline assignedLocalDate = baselineDate, final = baselineDate + 14', async () => {
    const baselineDate = '2026-09-06'
    const { programId } = await insertProgram(testApp.db, {
      baselineDate,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const slots = await insertSlotSet(testApp.db, programId)
    expect(slots.midpointA).toBeUndefined()

    const rows = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, programId))
    expect(rows).toHaveLength(4)

    const baselineRows = rows.filter((r) => r.phase === 'baseline')
    const finalRows = rows.filter((r) => r.phase === 'final')
    expect(baselineRows).toHaveLength(2)
    expect(finalRows).toHaveLength(2)
    for (const row of baselineRows) {
      expect(row.assignedLocalDate).toBe(baselineDate)
    }
    for (const row of finalRows) {
      expect(row.assignedLocalDate).toBe(addDays(baselineDate, 14))
    }
  })

  it('(3) insertSession (benchmark, with slotId) creates focus_sessions + session_reviews; episode_count NULL when omitted, 0 when given 0; practice + slotId violates the CHECK', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId: sessionOmitted } = await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: '2026-09-06',
      startedAt: new Date('2026-09-06T09:00:00.000Z'),
      endedAt: new Date('2026-09-06T09:20:00.000Z'),
      targetSeconds: 1200,
    })
    const sessionRows = await testApp.db
      .select()
      .from(focusSessions)
      .where(eq(focusSessions.id, sessionOmitted))
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]?.kind).toBe('benchmark')

    const reviewOmitted = await testApp.sql`
      select episode_count from session_reviews where session_id = ${sessionOmitted}
    `
    expect(reviewOmitted[0]?.episode_count).toBeNull()

    const { sessionId: sessionZero } = await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: '2026-09-06',
      startedAt: new Date('2026-09-06T09:30:00.000Z'),
      endedAt: new Date('2026-09-06T09:50:00.000Z'),
      targetSeconds: 1200,
      review: { episodeCount: 0 },
    })
    const reviewZero = await testApp.sql`
      select episode_count from session_reviews where session_id = ${sessionZero}
    `
    expect(reviewZero[0]?.episode_count).toBe(0)

    await expect(
      insertSession(testApp.db, {
        programId,
        kind: 'practice',
        slotId: slots.finalA,
        lifecycle: 'running',
        localDate: '2026-09-06',
        startedAt: new Date('2026-09-06T10:00:00.000Z'),
        targetSeconds: 600,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'focus_sessions_benchmark_has_slot' },
    })
  })

  it('(4) seedActiveProgram({ day: 4 }) is active with two finalized baseline benchmark attempts on Day 0 and zero practice rows', async () => {
    const { programId, slots, baselineSessionIds } = await seedActiveProgram(testApp.db, { day: 4 })

    const [program] = await testApp.db.select().from(programs).where(eq(programs.id, programId))
    expect(program?.status).toBe('active')

    const sessions = await testApp.db.select().from(focusSessions).where(eq(focusSessions.programId, programId))
    expect(sessions).toHaveLength(2)
    for (const session of sessions) {
      expect(session.kind).toBe('benchmark')
      expect(session.lifecycle).toBe('finalized')
      expect(session.localDate).toBe(program?.baselineDate)
      expect([slots.baselineA, slots.baselineB]).toContain(session.slotId)
    }
    expect(baselineSessionIds).toHaveLength(2)
    expect(sessions.every((s) => s.kind !== 'practice')).toBe(true)
  })

  it('(5) loadOwnedProgram on another principal\'s program throws NotFoundError with message "Not found"', async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)

    await expect(loadOwnedProgram(testApp.db, demoCtx(), other.programId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    try {
      await loadOwnedProgram(testApp.db, demoCtx(), other.programId)
      expect.unreachable('loadOwnedProgram should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect((err as NotFoundError).message).toBe('Not found')
      expect((err as NotFoundError).status).toBe(404)
    }
  })

  it('(6) loadOwnedProgram on the caller\'s own program with a foreign realm throws DomainError realm_mismatch, not 404', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    await testApp.db.update(programs).set({ realm: 'pilot' }).where(eq(programs.id, programId))

    try {
      await loadOwnedProgram(testApp.db, demoCtx(), programId)
      expect.unreachable('loadOwnedProgram should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect(err).not.toBeInstanceOf(NotFoundError)
      expect((err as DomainError).code).toBe('realm_mismatch')
      expect((err as DomainError).status).toBe(422)
    }
  })
})
