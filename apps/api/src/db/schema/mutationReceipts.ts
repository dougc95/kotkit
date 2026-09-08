/**
 * `mutation_receipts`: the idempotency ledger (design.md D6, D21).
 * `(user_id, idempotency_key)` is the composite primary key, so a retried
 * `POST /programs`, `POST /sessions`, recall or finalize dedupes per
 * principal — see `apps/api/src/idempotency/withIdempotency.ts` (3.4.2).
 * No FK to `user_profiles` and no `ON DELETE` from any parent: a receipt
 * must survive independently of the resource it created, and
 * `deletePrincipalData` (3.5.3) removes rows for a principal explicitly
 * instead. Receipts expire on `expires_at` (`RECEIPT_TTL_SECONDS`, D40's
 * demo-clock caveat).
 */
import { pgTable, text, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core'

export const mutationReceipts = pgTable(
  'mutation_receipts',
  {
    userId: text('user_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    resultRef: text('result_ref').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.idempotencyKey] })],
)
