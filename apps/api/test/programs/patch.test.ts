/**
 * 4.4.2 — Fastify inject integration tests for `PATCH /programs/{id}`
 * against the real `attention_lab_test` database, via `buildTestApp`
 * (3.2.1). Complements the pure-function unit tests in
 * `src/services/program/patch.test.ts` (`canTransition`, `dateEditAllowed`,
 * `recomputeAssignedDates`), which this file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { addDays } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  createProgramViaApi,
  insertOtherPrincipalProgram,
  insertProgram,
  insertSlotSet,
} from '../helpers/programs.js'
import { benchmarkSlots, programs, protocolRevisions } from '../../src/db/schema/index.js'

interface ProgramDto {
  id: string
  status: string
  baselineDate: string
  leisureAllowanceMinutes: number
  version: number
}

interface PatchProgramResponseBody {
  program: ProgramDto
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
}

const BASELINE_DATE = '2026-09-06'

describe('PATCH /programs/{id} (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function patchProgram(
    app: FastifyInstance,
    programId: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/programs/${programId}`,
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

  it('(1) insertProgram draft + insertSlotSet -> PATCH baselineDate +3 days -> 200, every slot assigned_local_date shifted by 3 local days', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const newBaselineDate = addDays(BASELINE_DATE, 3)
    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      baselineDate: newBaselineDate,
    })

    expect(statusCode).toBe(200)
    expect((body as PatchProgramResponseBody).program.baselineDate).toBe(newBaselineDate)

    const rows = await testApp.db
      .select({ id: benchmarkSlots.id, phase: benchmarkSlots.phase, assignedLocalDate: benchmarkSlots.assignedLocalDate })
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.programId, programId))
    const byId = new Map(rows.map((row) => [row.id, row.assignedLocalDate]))

    expect(byId.get(slots.baselineA)).toBe(newBaselineDate)
    expect(byId.get(slots.baselineB)).toBe(newBaselineDate)
    expect(byId.get(slots.finalA)).toBe(addDays(newBaselineDate, 14))
    expect(byId.get(slots.finalB)).toBe(addDays(newBaselineDate, 14))
  })

  it('(2) baseline_ready program PATCH baselineDate -> 422 date_locked, dates unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    const before = await testApp.db
      .select({ id: benchmarkSlots.id, assignedLocalDate: benchmarkSlots.assignedLocalDate })
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.programId, programId))

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      baselineDate: addDays(BASELINE_DATE, 3),
    })

    expect(statusCode).toBe(422)
    expect((body as ErrorBody).code).toBe('date_locked')

    const after = await testApp.db
      .select({ id: benchmarkSlots.id, assignedLocalDate: benchmarkSlots.assignedLocalDate })
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.programId, programId))
    expect(after).toEqual(before)
    expect(slots.baselineA).toBeTruthy()
  })

  it('(3) wrong expectedVersion -> 409 stale_version with details.current.version equal to the stored version', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 999,
      leisureAllowanceMinutes: 25,
    })

    expect(statusCode).toBe(409)
    const err = body as ErrorBody
    expect(err.code).toBe('stale_version')
    const current = err.details?.current as ProgramDto
    expect(current.version).toBe(1)
  })

  it('(4) leisureAllowanceMinutes 30 on an active program -> 200, leisure_allowance_min 30, protocol_revisions count unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      leisureAllowanceMinutes: 30,
    })

    expect(statusCode).toBe(200)
    expect((body as PatchProgramResponseBody).program.leisureAllowanceMinutes).toBe(30)

    const revisionRows = await testApp.db
      .select({ id: protocolRevisions.id })
      .from(protocolRevisions)
      .where(eq(protocolRevisions.programId, programId))
    expect(revisionRows).toHaveLength(1)
  })

  it('(5) status archived on an active program -> 200, then POST /programs with a new key -> 201 (explicit archive frees the one-program rule)', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      status: 'archived',
    })
    expect(statusCode).toBe(200)
    expect((body as PatchProgramResponseBody).program.status).toBe('archived')

    const created = await createProgramViaApi(testApp.app)
    expect(created.statusCode).toBe(201)
  })

  it('(6) status completed from active -> 200; from baseline_ready -> 200', async () => {
    const active = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const fromActive = await patchProgram(testApp.app, active.programId, {
      expectedVersion: 1,
      status: 'completed',
    })
    expect(fromActive.statusCode).toBe(200)
    expect((fromActive.body as PatchProgramResponseBody).program.status).toBe('completed')

    const baselineReady = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
    const fromBaselineReady = await patchProgram(testApp.app, baselineReady.programId, {
      expectedVersion: 1,
      status: 'completed',
    })
    expect(fromBaselineReady.statusCode).toBe(200)
    expect((fromBaselineReady.body as PatchProgramResponseBody).program.status).toBe('completed')
  })

  it('(7) PATCH on a completed program -> 409 program_terminal', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'completed',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      leisureAllowanceMinutes: 25,
    })

    expect(statusCode).toBe(409)
    expect((body as ErrorBody).code).toBe('program_terminal')
  })

  it('(8) status "draft", "baseline_ready" or "active" in body -> 400 (contract)', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    for (const status of ['draft', 'baseline_ready', 'active']) {
      const { statusCode, body } = await patchProgram(testApp.app, programId, {
        expectedVersion: 1,
        status,
      })
      expect(statusCode).toBe(400)
      expect((body as ErrorBody).code).toBe('malformed_request')
    }
  })

  it('(9) body with timezone -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      timezone: 'Europe/Madrid',
    })

    expect(statusCode).toBe(400)
    expect((body as ErrorBody).code).toBe('malformed_request')
  })

  it("(10) another principal's program -> 404", async () => {
    const { programId } = await insertOtherPrincipalProgram(testApp.db)

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      leisureAllowanceMinutes: 25,
    })

    expect(statusCode).toBe(404)
    expect((body as ErrorBody).code).toBe('not_found')
  })

  it('(11) draft -> "completed" -> 409 invalid_status_transition', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      status: 'completed',
    })

    expect(statusCode).toBe(409)
    expect((body as ErrorBody).code).toBe('invalid_status_transition')
  })

  it('(12) status archived on a draft -> 200 status archived', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await patchProgram(testApp.app, programId, {
      expectedVersion: 1,
      status: 'archived',
    })

    expect(statusCode).toBe(200)
    expect((body as PatchProgramResponseBody).program.status).toBe('archived')
  })
})
