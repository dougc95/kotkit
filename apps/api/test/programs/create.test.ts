/**
 * 4.1.2 — Fastify inject integration tests for `POST /programs` against the
 * real `attention_lab_test` database, via `buildTestApp` (3.2.1).
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { focusSessions, programs, protocolRevisions } from '../../src/db/schema/index.js'

const VALID_BODY = {
  baselineDate: '2026-09-06',
  timezone: 'Europe/Madrid',
  practiceTargetSeconds: 600,
}

describe('POST /programs (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function post(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
    return testApp.app.inject({
      method: 'POST',
      url: '/api/v1/programs',
      payload,
      headers: { 'idempotency-key': randomUUID(), ...headers },
    })
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

  it('(1) valid body -> 201, draft/version 1, revision 1/effectiveDay 0/"initial plan", exactly one programs row and one protocol_revisions row, current_revision_id equals the revision id', async () => {
    const res = await post(VALID_BODY)
    expect(res.statusCode).toBe(201)

    const body = res.json() as { program: Record<string, unknown>; revision: Record<string, unknown> }
    expect(body.program.status).toBe('draft')
    expect(body.program.version).toBe(1)
    expect(body.revision.revision).toBe(1)
    expect(body.revision.effectiveDay).toBe(0)
    expect(body.revision.reason).toBe('initial plan')
    expect(body.program.currentRevisionId).toBe(body.revision.id)

    const programRows = await testApp.db.select().from(programs)
    expect(programRows).toHaveLength(1)
    const revisionRows = await testApp.db.select().from(protocolRevisions)
    expect(revisionRows).toHaveLength(1)
    expect(programRows[0]!.currentRevisionId).toBe(revisionRows[0]!.id)
  })

  it('(2) feedEstimateMinutes omitted -> DB feed_estimate_min IS NULL and response feedEstimateMinutes null; leisureAllowanceMinutes omitted -> 20', async () => {
    const res = await post(VALID_BODY)
    expect(res.statusCode).toBe(201)
    const body = res.json() as {
      program: { feedEstimateMinutes: unknown; leisureAllowanceMinutes: number; id: string }
    }
    expect(body.program.feedEstimateMinutes).toBeNull()
    expect(body.program.leisureAllowanceMinutes).toBe(20)

    const [row] = await testApp.db.select().from(programs).where(eq(programs.id, body.program.id))
    expect(row!.feedEstimateMin).toBeNull()
    expect(row!.leisureAllowanceMin).toBe(20)
  })

  it("(3) body containing realm: 'pilot' -> 400 fieldErrors.realm and zero rows", async () => {
    const res = await post({ ...VALID_BODY, realm: 'pilot' })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors?.realm).toBeDefined()

    const programRows = await testApp.db.select().from(programs)
    expect(programRows).toHaveLength(0)
  })

  it("(4) body without realm -> stored realm 'demo'", async () => {
    const res = await post(VALID_BODY)
    expect(res.statusCode).toBe(201)
    const body = res.json() as { program: { realm: string } }
    expect(body.program.realm).toBe('demo')
  })

  it('(5) practiceTargetSeconds 300 -> stored settings.bandCeilings Days 1-3 entry is 10 minutes (600s)', async () => {
    const res = await post({ ...VALID_BODY, practiceTargetSeconds: 300 })
    expect(res.statusCode).toBe(201)
    const body = res.json() as {
      revision: { settings: { bandCeilings: Array<{ fromDay: number; toDay: number; minutes: number }> } }
    }
    const days1to3 = body.revision.settings.bandCeilings.find((b) => b.fromDay === 1 && b.toDay === 3)
    expect(days1to3?.minutes).toBe(10)
  })

  it("(6) timezone 'Mars/Olympus' -> 400 fieldErrors.timezone; 'America/Bogota' stored verbatim", async () => {
    const bad = await post({ ...VALID_BODY, timezone: 'Mars/Olympus' })
    expect(bad.statusCode).toBe(400)
    const badBody = bad.json() as { fieldErrors?: Record<string, string> }
    expect(badBody.fieldErrors?.timezone).toBeDefined()

    const good = await post({ ...VALID_BODY, timezone: 'America/Bogota' })
    expect(good.statusCode).toBe(201)
    const goodBody = good.json() as { program: { timezone: string } }
    expect(goodBody.program.timezone).toBe('America/Bogota')
  })

  it('(7) body without timezone -> 400', async () => {
    const { timezone: _timezone, ...withoutTimezone } = VALID_BODY
    const res = await post(withoutTimezone)
    expect(res.statusCode).toBe(400)
  })

  it("(8) missing Idempotency-Key -> 400 fieldErrors['Idempotency-Key']; non-UUID key -> 400", async () => {
    const missing = await testApp.app.inject({ method: 'POST', url: '/api/v1/programs', payload: VALID_BODY })
    expect(missing.statusCode).toBe(400)
    const missingBody = missing.json() as { fieldErrors?: Record<string, string> }
    expect(missingBody.fieldErrors?.['Idempotency-Key']).toBeDefined()

    const nonUuid = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/programs',
      payload: VALID_BODY,
      headers: { 'idempotency-key': 'not-a-uuid' },
    })
    expect(nonUuid.statusCode).toBe(400)
  })

  it('(9) same key + same body twice -> 201 then 200, same programId, byte-identical body, still one row', async () => {
    const key = randomUUID()
    const res1 = await post(VALID_BODY, { 'idempotency-key': key })
    expect(res1.statusCode).toBe(201)

    const res2 = await post(VALID_BODY, { 'idempotency-key': key })
    expect(res2.statusCode).toBe(200)

    expect(res2.json()).toEqual(res1.json())

    const programRows = await testApp.db.select().from(programs)
    expect(programRows).toHaveLength(1)
  })

  it('(10) same key + different body -> 409 idempotency_mismatch', async () => {
    const key = randomUUID()
    const res1 = await post(VALID_BODY, { 'idempotency-key': key })
    expect(res1.statusCode).toBe(201)

    const res2 = await post({ ...VALID_BODY, practiceTargetSeconds: 900 }, { 'idempotency-key': key })
    expect(res2.statusCode).toBe(409)
    expect((res2.json() as { code: string }).code).toBe('idempotency_mismatch')
  })

  it('(11) response carries x-request-id and Cache-Control: no-store', async () => {
    const res = await post(VALID_BODY)
    expect(res.statusCode).toBe(201)
    expect(res.headers['x-request-id']).toBeDefined()
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('(12) after create, focus_sessions count for the program is 0', async () => {
    const res = await post(VALID_BODY)
    expect(res.statusCode).toBe(201)
    const body = res.json() as { program: { id: string } }

    const sessionRows = await testApp.db
      .select()
      .from(focusSessions)
      .where(eq(focusSessions.programId, body.program.id))
    expect(sessionRows).toHaveLength(0)
  })
})
