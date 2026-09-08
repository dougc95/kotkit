/**
 * 5.6.1 — Fastify inject integration tests for
 * `PUT /sessions/{id}/agent-plan`, against the real `attention_lab_test`
 * database via `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers
 * with 4.1.1's program helpers, per D16 — no lower layer is re-created here.
 * Pure upsert-decision coverage (the insert/update/stale matrix) lives in
 * `test/services/agent-plan.unit.test.ts` (5.6.1's own unit file); this file
 * exercises the route's own concerns: ownership, the practice-only kind
 * gate, the active-lifecycle gate, the optimistic `expectedVersion` upsert
 * against the real `agent_plans` table, and the D20 embedding on
 * `GET /sessions/{id}`.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { seedSession } from '../helpers/sessions.js'
import { focusSessions, sessionEvents } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function putAgentPlan(app: FastifyInstance, sessionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/sessions/${sessionId}/agent-plan`,
    payload: body,
  })
}

async function getSession(app: FastifyInstance, sessionId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
}

interface AgentPlanBody {
  sessionId: string
  workstream: string | null
  waitingTask: string | null
  reviewCheckpoint: string | null
  resumeNote: string | null
  version: number
}

interface SessionBody {
  agentPlan: AgentPlanBody | null
}

async function loadFocusSessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId)).limit(1)
  if (!row) throw new Error(`loadFocusSessionRow: no focus_sessions row for '${sessionId}'`)
  return row
}

async function eventCountFor(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
  return rows.length
}

describe('PUT /sessions/{id}/agent-plan (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it("(1) first PUT with expectedVersion 0 -> 200, version 1, reviewCheckpoint 'end_of_block'", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const res = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 0,
      workstream: 'Write the report',
      waitingTask: 'Read a paper',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as AgentPlanBody
    expect(body.sessionId).toBe(sessionId)
    expect(body.version).toBe(1)
    expect(body.reviewCheckpoint).toBe('end_of_block')
    expect(body.workstream).toBe('Write the report')
    expect(body.waitingTask).toBe('Read a paper')
  })

  it('(2) second PUT expectedVersion 1 changing waitingTask -> version 2, workstream preserved', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const first = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 0,
      workstream: 'Write the report',
      waitingTask: 'Read a paper',
    })
    expect(first.statusCode).toBe(200)

    const second = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 1,
      waitingTask: 'Read a different paper',
    })
    expect(second.statusCode).toBe(200)
    const body = second.json() as AgentPlanBody
    expect(body.version).toBe(2)
    expect(body.waitingTask).toBe('Read a different paper')
    expect(body.workstream).toBe('Write the report')
  })

  it('(3) two tabs both send expectedVersion 1: first 200, second 409 stale_version whose details.current equals the first write; DB holds the first', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const created = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Initial plan' })
    expect(created.statusCode).toBe(200)

    const firstTab = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 1,
      waitingTask: 'Tab A wins this race',
    })
    expect(firstTab.statusCode).toBe(200)
    const firstBody = firstTab.json() as AgentPlanBody
    expect(firstBody.version).toBe(2)

    const secondTab = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 1,
      waitingTask: 'Tab B loses this race',
    })
    expect(secondTab.statusCode).toBe(409)
    const secondBody = secondTab.json() as ErrorBody
    expect(secondBody.code).toBe('stale_version')
    const current = secondBody.details?.current as AgentPlanBody
    expect(current).toEqual(firstBody)

    const getRes = await getSession(testApp.app, sessionId)
    const plan = (getRes.json() as SessionBody).agentPlan
    expect(plan?.waitingTask).toBe('Tab A wins this race')
    expect(plan?.version).toBe(2)
  })

  it('(4) expectedVersion 0 when a row already exists -> 409 stale_version', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const created = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Initial plan' })
    expect(created.statusCode).toBe(200)

    const res = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'A do-over' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('stale_version')
  })

  it('(5) benchmark session -> 422 practice_only', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Not allowed' })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('practice_only')
  })

  it('(6) finalized practice -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'finalized' })

    const res = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Too late' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('session_not_active')
  })

  it('(7) body with credentials/agentOutput/log fields -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const res = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 0,
      workstream: 'Write the report',
      credentials: 'sk-should-not-be-here',
      agentOutput: 'raw model output',
      log: 'a transcript',
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')
  })

  it("(8) other principal -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      lifecycle: 'running',
    })

    const res = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Not mine' })
    expect(res.statusCode).toBe(404)
    expect((res.json() as ErrorBody).code).toBe('not_found')
  })

  it('(9) focus_sessions.version, lifecycle and session_events count unchanged after plan writes', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const before = await loadFocusSessionRow(testApp, sessionId)
    const eventsBefore = await eventCountFor(testApp, sessionId)

    const first = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 0, workstream: 'Write the report' })
    expect(first.statusCode).toBe(200)
    const second = await putAgentPlan(testApp.app, sessionId, { expectedVersion: 1, waitingTask: 'Read a paper' })
    expect(second.statusCode).toBe(200)

    const after = await loadFocusSessionRow(testApp, sessionId)
    expect(after.version).toBe(before.version)
    expect(after.lifecycle).toBe(before.lifecycle)
    expect(await eventCountFor(testApp, sessionId)).toBe(eventsBefore)
  })

  it('(10) GET /sessions/{id} returns the stored plan', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const putRes = await putAgentPlan(testApp.app, sessionId, {
      expectedVersion: 0,
      workstream: 'Write the report',
      waitingTask: 'Read a paper',
      resumeNote: 'Pick up where recall left off',
    })
    expect(putRes.statusCode).toBe(200)
    const putBody = putRes.json() as AgentPlanBody

    const getRes = await getSession(testApp.app, sessionId)
    expect(getRes.statusCode).toBe(200)
    const plan = (getRes.json() as SessionBody).agentPlan
    expect(plan).toEqual(putBody)
    expect(plan?.resumeNote).toBe('Pick up where recall left off')
  })
})
