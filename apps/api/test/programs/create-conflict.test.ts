/**
 * 4.1.3 — Fastify inject integration tests for the one-open-program-per-user
 * rule on `POST /programs`, against the real `attention_lab_test` database
 * via `buildTestApp` (3.2.1). Complements `create.test.ts` (4.1.2), which
 * this file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, createProgramViaApi } from '../helpers/programs.js'
import { programs } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'Europe/Madrid',
  practiceTargetSeconds: 600,
}

describe('POST /programs — one open program per user (integration, attention_lab_test)', () => {
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

  it("(1) a draft program exists -> second POST -> 409 program_exists with details.existingProgramId/existingStatus 'draft', no new row, message has no UUID", async () => {
    const { programId } = await insertProgram(testApp.db, {
      ...BASE_PROGRAM,
      status: 'draft',
    })

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)

    expect(res.statusCode).toBe(409)
    const body = res.body as unknown as {
      code: string
      message: string
      details?: { existingProgramId: string; existingStatus: string }
    }
    expect(body.code).toBe('program_exists')
    expect(body.details?.existingProgramId).toBe(programId)
    expect(body.details?.existingStatus).toBe('draft')

    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    expect(uuidPattern.test(body.message)).toBe(false)

    const rows = await testApp.db.select().from(programs)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(programId)
  })

  it("(2) status updated directly to 'baseline_ready' -> 409 program_exists", async () => {
    const { programId } = await insertProgram(testApp.db, { ...BASE_PROGRAM, status: 'draft' })
    await testApp.db.update(programs).set({ status: 'baseline_ready' }).where(eq(programs.id, programId))

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)
    expect(res.statusCode).toBe(409)
    expect((res.body as unknown as { code: string }).code).toBe('program_exists')
  })

  it("(3) status updated directly to 'active' -> 409 program_exists", async () => {
    const { programId } = await insertProgram(testApp.db, { ...BASE_PROGRAM, status: 'draft' })
    await testApp.db.update(programs).set({ status: 'active' }).where(eq(programs.id, programId))

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)
    expect(res.statusCode).toBe(409)
    expect((res.body as unknown as { code: string }).code).toBe('program_exists')
  })

  it("(4) status updated directly to 'completed' -> 201 and a new program row", async () => {
    const { programId } = await insertProgram(testApp.db, { ...BASE_PROGRAM, status: 'draft' })
    await testApp.db.update(programs).set({ status: 'completed' }).where(eq(programs.id, programId))

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)
    expect(res.statusCode).toBe(201)

    const rows = await testApp.db.select().from(programs)
    expect(rows).toHaveLength(2)
  })

  it("(5) status updated directly to 'archived' -> 201", async () => {
    const { programId } = await insertProgram(testApp.db, { ...BASE_PROGRAM, status: 'draft' })
    await testApp.db.update(programs).set({ status: 'archived' }).where(eq(programs.id, programId))

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)
    expect(res.statusCode).toBe(201)

    const rows = await testApp.db.select().from(programs)
    expect(rows).toHaveLength(2)
  })

  it('(6) two concurrent inject POSTs with different keys -> exactly one 201 and one 409 program_exists, exactly one open row', async () => {
    const [res1, res2] = await Promise.all([
      createProgramViaApi(testApp.app, BASE_PROGRAM),
      createProgramViaApi(testApp.app, BASE_PROGRAM),
    ])

    const statusCodes = [res1.statusCode, res2.statusCode].sort()
    expect(statusCodes).toEqual([201, 409])

    const conflict = res1.statusCode === 409 ? res1 : res2
    expect((conflict.body as unknown as { code: string }).code).toBe('program_exists')

    const rows = await testApp.db.select().from(programs)
    const openRows = rows.filter((row) => row.status === 'draft')
    expect(openRows).toHaveLength(1)
  })

  it('(7) an open program seeded for another principal does not block -> 201 and the seeded row is untouched', async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)

    const res = await createProgramViaApi(testApp.app, BASE_PROGRAM)
    expect(res.statusCode).toBe(201)

    const [otherRow] = await testApp.db.select().from(programs).where(eq(programs.id, other.programId))
    expect(otherRow?.status).toBe('draft')
    expect(otherRow?.userId).toBe(other.userId)

    const rows = await testApp.db.select().from(programs)
    expect(rows).toHaveLength(2)
  })
})
