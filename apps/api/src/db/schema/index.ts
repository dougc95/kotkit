// Barrel for Drizzle table definitions. One file per aggregate; group 3.3
// fills this in (user_profiles, programs, protocol_revisions,
// benchmark_slots, focus_sessions and their children, plus daily records
// and the idempotency ledger from 3.3.3). `buildTestApp.truncateAll()`
// (3.2.1) enumerates every table exported from here via
// `getTableConfig`/`isTable`, so a new file only needs a
// `export * from './x.js'` line below to be picked up by truncation and by
// drizzle's `schema` binding in `plugins/db.ts`.
export * from './userProfiles.js'
export * from './programs.js'
export * from './protocolRevisions.js'
export * from './benchmarkSlots.js'
export * from './focusSessions.js'
export * from './sessionEvents.js'
export * from './sessionReviews.js'
export * from './sessionAmendments.js'
export * from './agentPlans.js'
export * from './dailyCheckins.js'
export * from './feedUsage.js'
export * from './mutationReceipts.js'
