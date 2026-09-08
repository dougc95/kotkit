/**
 * 4.4.1 — Fastify inject integration tests for `POST
 * /programs/{id}/revisions` against the real `attention_lab_test` database,
 * via `buildTestApp` (3.2.1). Complements the pure-function unit tests in
 * `src/services/program/revisions.test.ts` (`nextRevisionNumber`,
 * `normalizeReason`, `effectiveDayAllowed`, `composeSettings`), which this
 * file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_BAND_CEILINGS, localDateForProgramDay } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  insertOtherPrincipalProgram,
  insertSession,
  seedActiveProgram,
} from '../helpers/programs.js'
import { focusSessions, programs, protocolRevisions } from '../../src/db/schema/index.js'

interface RevisionDto {
  id: string
  revision: number
  effectiveDay: number
  settings: { practiceTargetSeconds: number; bandCeilings: unknown[]; leisureAllowanceMin: number }
  reason: string
  createdAt: string
}

interface ProgramDto {
  id: string
  status: string
  version: number
  currentRevisionId: string
}

interface CreateRevisionResponseBody {
  revision: RevisionDto
  program: ProgramDto
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
}

describe('POST /programs/{id}/revisions (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function postRevision(
    app: FastifyInstance,
    programId: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/programs/${programId}/revisions`,
      payload,
    })
    return { statusCode: res.statusCode, body: res.json() }
  }

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('(1) seedActiveProgram day 8, seven Day 1-7 finalized practice sessions on revision 1, POST effectiveDay 8 practiceTargetSeconds 1200 leisureAllowanceMin 20 reason "more time" -> 201 revision 2 effectiveDay 8 bandCeilings equal DEFAULT_BAND_CEILINGS; all seven sessions still reference revision 1; current_revision_id = revision 2, version incremented', async () => {
    const { programId, revisionId: revision1Id } = await seedActiveProgram(testApp.db, { day: 8 })

    const [programRow] = await testApp.db
      .select({ baselineDate: programs.baselineDate, version: programs.version })
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1)
    if (!programRow) throw new Error('program row missing')

    const sessionIds: string[] = []
    for (let day = 1; day <= 7; day++) {
      const localDate = localDateForProgramDay(programRow.baselineDate, day)
      const { sessionId } = await insertSession(testApp.db, {
        programId,
        kind: 'practice',
        lifecycle: 'finalized',
        localDate,
        startedAt: new Date(`${localDate}T09:00:00.000Z`),
        endedAt: new Date(`${localDate}T09:10:00.000Z`),
        targetSeconds: 600,
        completeInterval: true,
      })
      sessionIds.push(sessionId)
    }

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 1200, leisureAllowanceMin: 20 },
      reason: 'more time',
    })

    expect(statusCode).toBe(201)
    const created = body as CreateRevisionResponseBody
    expect(created.revision.revision).toBe(2)
    expect(created.revision.effectiveDay).toBe(8)
    expect(created.revision.settings.bandCeilings).toEqual(DEFAULT_BAND_CEILINGS)
    expect(created.program.version).toBe(programRow.version + 1)
    expect(created.program.currentRevisionId).toBe(created.revision.id)

    const rows = await testApp.db
      .select({ id: focusSessions.id, revisionId: focusSessions.revisionId })
      .from(focusSessions)
      .where(eq(focusSessions.programId, programId))
    const bySessionId = new Map(rows.map((row) => [row.id, row.revisionId]))
    for (const sessionId of sessionIds) {
      expect(bySessionId.get(sessionId)).toBe(revision1Id)
    }
  })

  it('(2) empty reason -> 400 fieldErrors.reason and no row', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900 },
      reason: '',
    })

    expect(statusCode).toBe(400)
    const err = body as ErrorBody
    expect(err.code).toBe('malformed_request')

    const rows = await testApp.db
      .select({ revision: protocolRevisions.revision })
      .from(protocolRevisions)
      .where(eq(protocolRevisions.programId, programId))
    expect(rows).toHaveLength(1)
  })

  it('(3) whitespace reason -> 400', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900 },
      reason: '   ',
    })

    expect(statusCode).toBe(400)
    expect((body as ErrorBody).code).toBe('malformed_request')
    expect((body as ErrorBody).fieldErrors).toEqual({ reason: 'is required' })
  })

  it('(4) effectiveDay 5 on Day 8 -> 422 effective_day_in_past', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 5,
      settings: { practiceTargetSeconds: 900 },
      reason: 'more time',
    })

    expect(statusCode).toBe(422)
    expect((body as ErrorBody).code).toBe('effective_day_in_past')
  })

  it('(5) settings with extra benchmarkSeconds -> 400 (benchmark duration never follows progression)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900, benchmarkSeconds: 1200 },
      reason: 'more time',
    })

    expect(statusCode).toBe(400)
    expect((body as ErrorBody).code).toBe('malformed_request')
  })

  it('(6) reason "progression accepted" with practiceTargetSeconds 1200 -> 201 (suggestion accept path)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 1200 },
      reason: 'progression accepted',
    })

    expect(statusCode).toBe(201)
    expect((body as CreateRevisionResponseBody).revision.reason).toBe('progression accepted')
  })

  it('(7) PATCH, PUT and DELETE on /programs/:id/revisions/:rid -> 404 (immutable)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })
    const fakeRevisionId = '00000000-0000-4000-8000-000000000000'

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res =
        method === 'DELETE'
          ? await testApp.app.inject({
              method,
              url: `/api/v1/programs/${programId}/revisions/${fakeRevisionId}`,
            })
          : await testApp.app.inject({
              method,
              url: `/api/v1/programs/${programId}/revisions/${fakeRevisionId}`,
              payload: { reason: 'x' },
            })
      expect(res.statusCode).toBe(404)
    }
  })

  it("(8) another principal's program -> 404", async () => {
    const { programId } = await insertOtherPrincipalProgram(testApp.db)

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 600 },
      reason: 'more time',
    })

    expect(statusCode).toBe(404)
    expect((body as ErrorBody).code).toBe('not_found')
  })

  it('(9) two revisions posted on Day 8 both effective 8 -> governingRevisionFor picks revision 3 and current_revision_id is revision 3', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const first = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900 },
      reason: 'first change',
    })
    expect(first.statusCode).toBe(201)
    const firstRevision = (first.body as CreateRevisionResponseBody).revision
    expect(firstRevision.revision).toBe(2)

    const second = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 1200 },
      reason: 'second change',
    })
    expect(second.statusCode).toBe(201)
    const secondRevision = (second.body as CreateRevisionResponseBody).revision
    expect(secondRevision.revision).toBe(3)

    const currentRes = await testApp.app.inject({ method: 'GET', url: '/api/v1/programs/current' })
    const currentBody = currentRes.json() as { revision: { revision: number } }
    expect(currentBody.revision.revision).toBe(3)

    const [programRow] = await testApp.db
      .select({ currentRevisionId: programs.currentRevisionId })
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1)
    expect(programRow?.currentRevisionId).toBe(secondRevision.id)
  })

  it('(10) body containing realm -> 400', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900 },
      reason: 'more time',
      realm: 'demo',
    })

    expect(statusCode).toBe(400)
    expect((body as ErrorBody).code).toBe('malformed_request')
  })

  it('(11) settings containing bandCeilings -> 400 (server-owned)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: {
        practiceTargetSeconds: 900,
        bandCeilings: [{ fromDay: 1, toDay: 3, minutes: 10 }],
      },
      reason: 'more time',
    })

    expect(statusCode).toBe(400)
    expect((body as ErrorBody).code).toBe('malformed_request')
  })

  it('(12) settings omitting leisureAllowanceMin on a program with leisure_allowance_min 30 -> stored settings.leisureAllowanceMin 30', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8 })

    await testApp.db.update(programs).set({ leisureAllowanceMin: 30 }).where(eq(programs.id, programId))

    const { statusCode, body } = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 900 },
      reason: 'more time',
    })

    expect(statusCode).toBe(201)
    expect((body as CreateRevisionResponseBody).revision.settings.leisureAllowanceMin).toBe(30)
  })
})
