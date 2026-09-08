import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { eq, getTableName, isTable } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { createLogger } from '../../src/logging.js'
import { requestHash } from '../../src/idempotency/requestHash.js'
import { IDEMPOTENCY_KEY_HEADER, requireIdempotencyKey } from '../../src/idempotency/keyHook.js'
import {
  RECEIPT_TTL_SECONDS,
  isReceiptLive,
  requestHashesEqual,
  withIdempotency,
} from '../../src/idempotency/withIdempotency.js'
import { ConflictError } from '../../src/errors.js'
import { LOCAL_DEMO_PRINCIPAL_ID, ensurePrincipalProfile } from '../../src/plugins/identity.js'
import * as schema from '../../src/db/schema/index.js'
import { programs } from '../../src/db/schema/programs.js'
import { mutationReceipts } from '../../src/db/schema/mutationReceipts.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: resolveTestDatabaseUrl(process.env),
    logLevel: 'silent',
    ...overrides,
  }
}

/**
 * Builds the real app plus one test-only route (`POST /api/v1/__test/idem`)
 * that runs a `programs` insert through `withIdempotency` — the same "route
 * added before `ready()`" pattern as hash.test.ts's `buildHashTestApp` and
 * identity.test.ts's `buildIdentityTestApp` (`buildTestApp` itself calls
 * `ready()` before a caller gets to register anything, so it cannot host a
 * custom route).
 *
 * The inserted row always uses status `'archived'` — a TERMINAL program
 * status, deliberately never `'draft'`/`'baseline_ready'`/`'active'` — so
 * repeated fresh executions across these test cases never collide with
 * `programs_one_open_per_user` (design.md D33). That partial unique index is
 * a real product invariant this file has nothing to do with; it tests the
 * idempotency ledger, not program lifecycle, and `programs` is only the
 * nearest existing table with an id to stand in for "some write".
 *
 * Two body flags select what `execute` does after inserting: `fail: true`
 * throws the `ConflictError('event_count_mismatch', ...)` the task brief
 * describes; `crash: true` throws a plain `Error` to exercise the unmapped
 * 500 path and prove nothing commits. An `x-test-operation` header
 * (defaulting to `'test.create'`) lets a test vary the operation string fed
 * into `requestHash` without needing a second route, proving the operation
 * is folded into the hash (3.4.1) end to end.
 */
async function buildReceiptsTestApp(): Promise<{
  app: FastifyInstance
  truncateAll(): Promise<void>
  close(): Promise<void>
}> {
  const loggerInstance = createLogger({ level: 'silent' })
  const app = await buildApp(testConfig(), { loggerInstance })

  await app.register(
    async (instance) => {
      instance.post(
        '/__test/idem',
        { preHandler: requireIdempotencyKey },
        async (request, reply) => {
          const body = (request.body ?? {}) as { fail?: boolean; crash?: boolean }
          const operationHeader = request.headers['x-test-operation']
          const operation =
            typeof operationHeader === 'string' && operationHeader.length > 0
              ? operationHeader
              : 'test.create'
          const key = request.idempotencyKey!
          const hash = requestHash(operation, {}, body)

          const { replayed, value } = await withIdempotency<{ id: string }>(
            app.db,
            request.ctx,
            { key, operation, requestHash: hash },
            async (tx) => {
              const [program] = await tx
                .insert(programs)
                .values({
                  userId: request.ctx.principalId,
                  realm: request.ctx.realm,
                  baselineDate: '2026-09-06',
                  timezone: 'UTC',
                  status: 'archived',
                  leisureAllowanceMin: 20,
                })
                .returning({ id: programs.id })

              if (body.crash) {
                throw new Error('boom')
              }
              if (body.fail) {
                throw new ConflictError(
                  'event_count_mismatch',
                  'Stored event count does not match.',
                  { details: { expected: 5, stored: 4 } },
                )
              }

              return { resultRef: program!.id, value: { id: program!.id } }
            },
            async (tx, resultRef) => {
              const [program] = await tx
                .select({ id: programs.id })
                .from(programs)
                .where(eq(programs.id, resultRef))
              return { id: program!.id }
            },
          )

          reply.code(replayed ? 200 : 201)
          return value
        },
      )
    },
    { prefix: '/api/v1' },
  )

  await app.ready()

  async function truncateAll(): Promise<void> {
    const tableNames = (Object.values(schema) as unknown[]).filter(isTable).map((table) => getTableName(table))
    if (tableNames.length > 0) {
      const identifiers = tableNames.map((name) => `"${name}"`).join(', ')
      await app.sql.unsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`)
    }
    await ensurePrincipalProfile(app.db)
  }

  return { app, truncateAll, close: () => app.close() }
}

describe('withIdempotency.ts (unit)', () => {
  it('(1) isReceiptLive with expires_at == now -> false', () => {
    const t = new Date('2026-09-06T12:00:00.000Z')
    expect(isReceiptLive({ expiresAt: t }, t)).toBe(false)
  })

  it('(2) isReceiptLive with now = expires_at - 1s -> true', () => {
    const expiresAt = new Date('2026-09-06T12:00:00.000Z')
    const now = new Date(expiresAt.getTime() - 1000)
    expect(isReceiptLive({ expiresAt }, now)).toBe(true)
  })

  it('(3) isReceiptLive with now = expires_at + 1s -> false', () => {
    const expiresAt = new Date('2026-09-06T12:00:00.000Z')
    const now = new Date(expiresAt.getTime() + 1000)
    expect(isReceiptLive({ expiresAt }, now)).toBe(false)
  })

  it('(4) requestHashesEqual is exact-string: differing case is a mismatch', () => {
    expect(requestHashesEqual('ab12cd', 'ab12cd')).toBe(true)
    expect(requestHashesEqual('ab12cd', 'AB12CD')).toBe(false)
  })
})

describe('withIdempotency (integration, attention_lab_test)', () => {
  let app: FastifyInstance
  let truncateAll: () => Promise<void>
  let close: () => Promise<void>

  beforeAll(async () => {
    const built = await buildReceiptsTestApp()
    app = built.app
    truncateAll = built.truncateAll
    close = built.close
  })

  afterAll(async () => {
    await close()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  async function post(payload: Record<string, unknown>, headers: Record<string, string>) {
    return await app.inject({ method: 'POST', url: '/api/v1/__test/idem', payload, headers })
  }

  it('(a) two identical requests with the same key -> 201 then 200, same id, exactly one program row', async () => {
    const key = randomUUID()

    const res1 = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res1.statusCode).toBe(201)
    const id1 = (res1.json() as { id: string }).id

    const res2 = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res2.statusCode).toBe(200)
    expect((res2.json() as { id: string }).id).toBe(id1)

    const rows = await app.db.select().from(programs)
    expect(rows).toHaveLength(1)
  })

  it('(b) same key, different body -> 409 idempotency_mismatch, still one program row, message has no UUID', async () => {
    const key = randomUUID()

    await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    const res2 = await post({ fail: true }, { [IDEMPOTENCY_KEY_HEADER]: key })

    expect(res2.statusCode).toBe(409)
    const body = res2.json() as { code: string; message: string }
    expect(body.code).toBe('idempotency_mismatch')
    expect(body.message).not.toMatch(UUID_PATTERN)

    const rows = await app.db.select().from(programs)
    expect(rows).toHaveLength(1)
  })

  it('(c) after the receipt expires, same key + different body -> 201 fresh execution, receipt rewritten with a new hash and a later expiry', async () => {
    const key = randomUUID()

    const res1 = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res1.statusCode).toBe(201)

    const [before] = await app.db
      .select()
      .from(mutationReceipts)
      .where(eq(mutationReceipts.idempotencyKey, key))
    expect(before).toBeDefined()

    await app.sql`UPDATE user_profiles SET demo_clock_offset_seconds = ${RECEIPT_TTL_SECONDS + 1} WHERE id = ${LOCAL_DEMO_PRINCIPAL_ID}`

    const res2 = await post({ fail: false }, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res2.statusCode).toBe(201)

    const rows = await app.db.select().from(mutationReceipts).where(eq(mutationReceipts.idempotencyKey, key))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.requestHash).not.toBe(before!.requestHash)
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime())
  })

  it('(d) a receipt for a different user_id with the same key does not affect the local-demo principal', async () => {
    const key = randomUUID()
    const now = new Date()
    await app.db.insert(mutationReceipts).values({
      userId: 'other',
      idempotencyKey: key,
      operation: 'test.create',
      requestHash: 'f'.repeat(64),
      resultRef: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RECEIPT_TTL_SECONDS * 1000),
    })

    const res = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res.statusCode).toBe(201)

    const rows = await app.db.select().from(mutationReceipts).where(eq(mutationReceipts.idempotencyKey, key))
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.userId === LOCAL_DEMO_PRINCIPAL_ID)).toBe(true)
    expect(rows.some((r) => r.userId === 'other')).toBe(true)
  })

  it('(e) execute throwing a generic Error -> 500, no receipt row and no program row (rollback)', async () => {
    const key = randomUUID()
    const res = await post({ crash: true }, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res.statusCode).toBe(500)

    const programRows = await app.db.select().from(programs)
    expect(programRows).toHaveLength(0)
    const receiptRows = await app.db.select().from(mutationReceipts)
    expect(receiptRows).toHaveLength(0)
  })

  it('(f) 10 concurrent identical injects -> one program row, one 201 and nine 200 with the same id', async () => {
    const key = randomUUID()
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post({}, { [IDEMPOTENCY_KEY_HEADER]: key })),
    )

    const statusCodes = responses.map((r) => r.statusCode).sort((a, b) => a - b)
    expect(statusCodes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201])

    const ids = new Set(responses.map((r) => (r.json() as { id: string }).id))
    expect(ids.size).toBe(1)

    const rows = await app.db.select().from(programs)
    expect(rows).toHaveLength(1)
  })

  it('(g) the stored receipt result_ref equals the created program id', async () => {
    const key = randomUUID()
    const res = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    const id = (res.json() as { id: string }).id

    const [receipt] = await app.db.select().from(mutationReceipts).where(eq(mutationReceipts.idempotencyKey, key))
    expect(receipt!.resultRef).toBe(id)
  })

  it('(h) same key and body but a different operation -> 409 idempotency_mismatch (operation is part of the hash)', async () => {
    const key = randomUUID()

    const res1 = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res1.statusCode).toBe(201)

    const res2 = await post({}, { [IDEMPOTENCY_KEY_HEADER]: key, 'x-test-operation': 'test.other' })
    expect(res2.statusCode).toBe(409)
    expect((res2.json() as { code: string }).code).toBe('idempotency_mismatch')
  })

  it('(i) {fail:true} -> 409 event_count_mismatch with details {expected:5,stored:4}, zero receipt rows and zero program rows', async () => {
    const key = randomUUID()
    const res = await post({ fail: true }, { [IDEMPOTENCY_KEY_HEADER]: key })

    expect(res.statusCode).toBe(409)
    const body = res.json() as { code: string; details?: { expected: number; stored: number } }
    expect(body.code).toBe('event_count_mismatch')
    expect(body.details).toEqual({ expected: 5, stored: 4 })

    const programRows = await app.db.select().from(programs)
    expect(programRows).toHaveLength(0)
    const receiptRows = await app.db.select().from(mutationReceipts)
    expect(receiptRows).toHaveLength(0)
  })

  it('(j) retrying the same key with {fail:false} after a failed attempt -> 201 (not idempotency_mismatch), one program row, receipt now present', async () => {
    const key = randomUUID()

    const failed = await post({ fail: true }, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(failed.statusCode).toBe(409)

    const res = await post({ fail: false }, { [IDEMPOTENCY_KEY_HEADER]: key })
    expect(res.statusCode).toBe(201)

    const programRows = await app.db.select().from(programs)
    expect(programRows).toHaveLength(1)
    const receiptRows = await app.db.select().from(mutationReceipts)
    expect(receiptRows).toHaveLength(1)
  })
})
