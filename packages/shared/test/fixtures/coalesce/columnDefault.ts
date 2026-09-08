// Fixture for findZeroCoalesce pass (c): a nullable numeric column given a
// `.default(0)`, which would turn a blank review count into a stored 0 at
// the database layer. Regex-scanned only; excluded from the package's
// typecheck.
import { integer, pgTable } from 'drizzle-orm/pg-core'

export const sessionReviews = pgTable('session_reviews', {
  recallScore: integer('recall_score').default(0),
})
