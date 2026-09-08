// Fixture for findZeroCoalesce pass (b): a raw/drizzle `sql` template that
// coalesces a nullable count column to 0. Regex-scanned only — this file is
// excluded from the package's typecheck, and its `drizzle-orm` import
// (packages/shared has no such dependency) is never resolved or executed.
import { sql } from 'drizzle-orm'

export const episodeCountQuery = sql`
  select COALESCE(episode_count, 0) as episode_count
  from focus_sessions
`
