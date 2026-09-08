/**
 * `deletePrincipalData` (3.5.3; design.md D34, D35, API contracts
 * `POST /demo/reset`): the principal-scoped delete every demo-data reset
 * builds on — this task's `POST /demo/reset` route runs it directly, and
 * 3.5.4's `loadScenario` calls it before inserting a scenario's rows so a
 * "load" always starts from a clean slate for this principal.
 *
 * Only rows owned by `ctx.principalId` with `realm = ctx.realm` are ever
 * touched. The three realm roots (`programs`, `focus_sessions`,
 * `daily_checkins` — D34) carry `user_id`/`realm` directly; every other
 * user-owned table has neither column and is instead selected through its
 * parent, exactly as D34 prescribes:
 *  - `feed_usage` has no `user_id`/`realm` of its own — scoped via its
 *    `daily_checkins` parent (itself scoped via `programs`).
 *  - `session_events`, `session_reviews`, `session_amendments` and
 *    `agent_plans` have no `user_id`/`realm` of their own — scoped via their
 *    `focus_sessions` parent.
 *  - `benchmark_slots` and `protocol_revisions` have no `user_id`/`realm` of
 *    their own — scoped via their `programs` parent.
 *  - `mutation_receipts` has `user_id` but no `realm` column at all (D19's
 *    idempotency ledger predates realm-scoped data) — scoped by `user_id`
 *    alone, per the task brief.
 *
 * Deletes run in FK order (child before the table it references) so no
 * `ON DELETE CASCADE` is ever needed (migrations review, 3.3.4, asserts none
 * exists). The one exception is the circular pair `programs.current_revision_id
 * -> protocol_revisions.id` and `protocol_revisions.program_id -> programs.id`:
 * `programs.current_revision_id` is nulled out for this principal immediately
 * before `protocol_revisions` rows are deleted, breaking the cycle without
 * ever needing a deferred constraint.
 *
 * `user_profiles` is deliberately NOT in `USER_OWNED_TABLES` and is never
 * deleted: the profile row (its `timezone` and `preferences`) survives a
 * reset, and only `demo_clock_offset_seconds` is zeroed (D35), run last so an
 * offset used to compute any of the deletes above is never itself part of
 * what "current" meant while this ran.
 */
import { and, eq, getTableName, inArray } from 'drizzle-orm'
import type { AppTransaction } from '../../idempotency/withIdempotency.js'
import type { RequestContext } from '../../plugins/identity.js'
import { userProfiles } from '../schema/userProfiles.js'
import { programs } from '../schema/programs.js'
import { protocolRevisions } from '../schema/protocolRevisions.js'
import { benchmarkSlots } from '../schema/benchmarkSlots.js'
import { focusSessions } from '../schema/focusSessions.js'
import { sessionEvents } from '../schema/sessionEvents.js'
import { sessionReviews } from '../schema/sessionReviews.js'
import { sessionAmendments } from '../schema/sessionAmendments.js'
import { agentPlans } from '../schema/agentPlans.js'
import { dailyCheckins } from '../schema/dailyCheckins.js'
import { feedUsage } from '../schema/feedUsage.js'
import { mutationReceipts } from '../schema/mutationReceipts.js'

/**
 * Every user-owned table (every table exported from the schema barrel except
 * `user_profiles`), in the exact order `deletePrincipalData` deletes them —
 * see the module docstring for why this order is FK-safe. `demoReset.test.ts`
 * (1) asserts this covers the schema barrel exhaustively and exactly once;
 * (2) asserts the ordering against drizzle's own foreign-key metadata.
 */
export const USER_OWNED_TABLES = [
  feedUsage,
  dailyCheckins,
  sessionEvents,
  sessionReviews,
  sessionAmendments,
  agentPlans,
  focusSessions,
  benchmarkSlots,
  protocolRevisions,
  programs,
  mutationReceipts,
] as const

export type PrincipalScope = Pick<RequestContext, 'principalId' | 'realm'>

/**
 * Deletes every row this principal owns, scoped to `ctx.realm`, and zeroes
 * the demo clock offset on the surviving `user_profiles` row. Returns a
 * `{ tableName: deletedRowCount }` record — the caller (this task's
 * `POST /demo/reset` handler) logs exactly this and nothing else (never row
 * content).
 */
export async function deletePrincipalData(
  tx: AppTransaction,
  ctx: PrincipalScope,
): Promise<Record<string, number>> {
  const { principalId, realm } = ctx
  const counts: Record<string, number> = {}

  // Fresh subquery builders on every call site below (never reused across
  // two `.where()` calls) — each is a distinct `select` descriptor scoped to
  // this principal's own rows in that parent table.
  const ownedProgramIds = () =>
    tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.userId, principalId), eq(programs.realm, realm)))

  const ownedCheckinIds = () =>
    tx
      .select({ id: dailyCheckins.id })
      .from(dailyCheckins)
      .innerJoin(programs, eq(dailyCheckins.programId, programs.id))
      .where(and(eq(programs.userId, principalId), eq(dailyCheckins.realm, realm)))

  const ownedSessionIds = () =>
    tx
      .select({ id: focusSessions.id })
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, principalId), eq(focusSessions.realm, realm)))

  counts[getTableName(feedUsage)] = (
    await tx
      .delete(feedUsage)
      .where(inArray(feedUsage.checkinId, ownedCheckinIds()))
      .returning({ id: feedUsage.id })
  ).length

  counts[getTableName(dailyCheckins)] = (
    await tx
      .delete(dailyCheckins)
      .where(inArray(dailyCheckins.id, ownedCheckinIds()))
      .returning({ id: dailyCheckins.id })
  ).length

  counts[getTableName(sessionEvents)] = (
    await tx
      .delete(sessionEvents)
      .where(inArray(sessionEvents.sessionId, ownedSessionIds()))
      .returning({ id: sessionEvents.id })
  ).length

  counts[getTableName(sessionReviews)] = (
    await tx
      .delete(sessionReviews)
      .where(inArray(sessionReviews.sessionId, ownedSessionIds()))
      .returning({ sessionId: sessionReviews.sessionId })
  ).length

  counts[getTableName(sessionAmendments)] = (
    await tx
      .delete(sessionAmendments)
      .where(inArray(sessionAmendments.sessionId, ownedSessionIds()))
      .returning({ id: sessionAmendments.id })
  ).length

  counts[getTableName(agentPlans)] = (
    await tx
      .delete(agentPlans)
      .where(inArray(agentPlans.sessionId, ownedSessionIds()))
      .returning({ sessionId: agentPlans.sessionId })
  ).length

  counts[getTableName(focusSessions)] = (
    await tx
      .delete(focusSessions)
      .where(and(eq(focusSessions.userId, principalId), eq(focusSessions.realm, realm)))
      .returning({ id: focusSessions.id })
  ).length

  counts[getTableName(benchmarkSlots)] = (
    await tx
      .delete(benchmarkSlots)
      .where(inArray(benchmarkSlots.programId, ownedProgramIds()))
      .returning({ id: benchmarkSlots.id })
  ).length

  // Breaks the programs <-> protocol_revisions cycle (see module docstring)
  // before protocol_revisions rows for this principal are deleted below.
  await tx
    .update(programs)
    .set({ currentRevisionId: null })
    .where(and(eq(programs.userId, principalId), eq(programs.realm, realm)))

  counts[getTableName(protocolRevisions)] = (
    await tx
      .delete(protocolRevisions)
      .where(inArray(protocolRevisions.programId, ownedProgramIds()))
      .returning({ id: protocolRevisions.id })
  ).length

  counts[getTableName(programs)] = (
    await tx
      .delete(programs)
      .where(and(eq(programs.userId, principalId), eq(programs.realm, realm)))
      .returning({ id: programs.id })
  ).length

  counts[getTableName(mutationReceipts)] = (
    await tx
      .delete(mutationReceipts)
      .where(eq(mutationReceipts.userId, principalId))
      .returning({ userId: mutationReceipts.userId })
  ).length

  // The profile row itself is kept (its timezone and preferences survive a
  // reset) — only the demo clock offset returns to zero (D35).
  await tx
    .update(userProfiles)
    .set({ demoClockOffsetSeconds: 0 })
    .where(eq(userProfiles.id, principalId))

  return counts
}
