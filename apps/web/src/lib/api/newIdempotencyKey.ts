/**
 * One idempotency key per logical mutation (design.md D6, D21, D16): a
 * caller (a hook or screen — `useStartSession` 7.4.4, `useFinalizeSession`
 * 7.3.5, and any future readiness/recall flow) creates exactly one key with
 * this function and reuses the SAME key on every retry of that one logical
 * start/recall/finalize, never minting a fresh key per HTTP attempt. The
 * client (`client.ts`) never generates a key itself — it only ever sends
 * whatever key the caller passes in `RequestOptions.idempotencyKey`.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
