/**
 * `withIdempotency`: the `mutation_receipts` helper every (IK)-marked route
 * (design.md D6, D21 — `POST /programs` 4.1.2, `POST /sessions` 5.1.1/5.1.2,
 * `POST /sessions/{id}/recall` 5.7.2, `POST /sessions/{id}/finalize` 5.8.1)
 * wraps its write in. `requireIdempotencyKey` (3.4.1's `keyHook.ts`) only
 * checks the header shape; this is what actually dedupes against the ledger.
 *
 * A single Postgres transaction does all of it: take an advisory lock keyed
 * on `(principalId, key)` so two concurrent duplicate requests serialize
 * instead of racing the receipt's primary key (D6's "10 concurrent identical
 * injects -> one row" requirement); look up the receipt; replay, conflict or
 * execute; upsert the receipt. Because `execute`'s write and the receipt
 * upsert share the transaction, a thrown error (validation, a domain 4xx
 * such as `event_count_mismatch`, or a database error) rolls both back
 * together — a rejected request records no receipt, so the same key is
 * accepted fresh on a later attempt (D21).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { AppDatabase } from '../plugins/db.js'
import type { RequestContext } from '../plugins/identity.js'
import { mutationReceipts } from '../db/schema/mutationReceipts.js'
import { ConflictError } from '../errors.js'

/** 7 days, in seconds — the receipt's lifetime once written (D6). */
export const RECEIPT_TTL_SECONDS = 7 * 24 * 3600

/**
 * The transaction handle `execute`/`load` receive. Derived from
 * `AppDatabase['transaction']`'s own callback parameter rather than
 * hand-assembling Drizzle's generic `PgTransaction<...>` type, so this stays
 * correct if the schema barrel's type parameter ever changes.
 */
export type AppTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

/** The subset of a stored receipt row `isReceiptLive` needs. */
export interface ReceiptLike {
  expiresAt: Date
}

/**
 * Pure: a receipt is live while `expires_at` is strictly after `now` — a
 * receipt whose `expires_at` equals `now` exactly is already expired (D40's
 * "receipts expire on the demo clock" caveat: `now` here is `ctx.now`, which
 * a demo-clock jump can move past `expires_at` without any real time
 * passing).
 */
export function isReceiptLive(receipt: ReceiptLike, now: Date): boolean {
  return receipt.expiresAt.getTime() > now.getTime()
}

/**
 * Exact-string equality, never case- or whitespace-insensitive: `requestHash`
 * (3.4.1) always produces 64 lowercase hex characters, so any deviation is a
 * genuinely different request, never a formatting quirk to normalize away.
 */
export function requestHashesEqual(a: string, b: string): boolean {
  return a === b
}

export interface WithIdempotencyOptions {
  /** The `Idempotency-Key` header value (a UUID string, per 3.4.1). */
  key: string
  /** The logical operation name folded into the stored receipt and, via 3.4.1's `requestHash`, into the hash itself. */
  operation: string
  /** `requestHash(operation, params, body)` — computed by the caller, not this helper, so callers stay in control of what `params`/`body` mean for their route. */
  requestHash: string
}

export interface WithIdempotencyResult<T> {
  /** `true` when an existing live receipt with the same hash was found (no `execute` call this time); `false` on a fresh execution. */
  replayed: boolean
  value: T
}

/**
 * `db, ctx, { key, operation, requestHash }, execute, load`. `execute` runs
 * only on a fresh call (no live receipt, or an expired one) and must return
 * both the value to hand back to the caller AND a `resultRef` — a small
 * string (an id is enough) the receipt stores so a later replay can `load`
 * the same result without re-running `execute`'s side effects.
 */
export async function withIdempotency<T>(
  db: AppDatabase,
  ctx: Pick<RequestContext, 'principalId' | 'now'>,
  opts: WithIdempotencyOptions,
  execute: (tx: AppTransaction) => Promise<{ resultRef: string; value: T }>,
  load: (tx: AppTransaction, resultRef: string) => Promise<T>,
): Promise<WithIdempotencyResult<T>> {
  const { key, operation, requestHash } = opts

  return db.transaction(async (tx) => {
    // Concurrent duplicate requests for the same (principal, key) must not
    // race the SELECT-then-INSERT below — the lock is released automatically
    // when this transaction commits or rolls back.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.principalId}:${key}`}))`)

    const [existing] = await tx
      .select()
      .from(mutationReceipts)
      .where(and(eq(mutationReceipts.userId, ctx.principalId), eq(mutationReceipts.idempotencyKey, key)))
      .limit(1)

    if (existing !== undefined && isReceiptLive(existing, ctx.now)) {
      if (requestHashesEqual(existing.requestHash, requestHash)) {
        return { replayed: true, value: await load(tx, existing.resultRef) }
      }
      throw new ConflictError(
        'idempotency_mismatch',
        'This request was already sent with different content.',
      )
    }

    // No live receipt (never sent, or the previous one expired): run the
    // real write. Any error thrown here — including a domain 4xx like
    // event_count_mismatch — aborts this whole transaction, so nothing below
    // ever runs and no receipt is written for this key (D21).
    const { resultRef, value } = await execute(tx)

    const expiresAt = new Date(ctx.now.getTime() + RECEIPT_TTL_SECONDS * 1000)

    // Upsert rather than plain insert: an expired row for this
    // (principal, key) is overwritten in place instead of colliding with the
    // primary key.
    await tx
      .insert(mutationReceipts)
      .values({
        userId: ctx.principalId,
        idempotencyKey: key,
        operation,
        requestHash,
        resultRef,
        createdAt: ctx.now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [mutationReceipts.userId, mutationReceipts.idempotencyKey],
        set: { operation, requestHash, resultRef, createdAt: ctx.now, expiresAt },
      })

    return { replayed: false, value }
  })
}
