// Fixture for findZeroCoalesce pass (a): `count` is a genuinely nullable
// ReportedCount, so coalescing it to 0 silently turns "not reported" into
// "reported as zero". Excluded from packages/shared/tsconfig.json's own
// typecheck; compiled ad hoc by the tool instead.
import type { ReportedCount } from '../../../src/domain/types.js'

export function reportedTotal(count: ReportedCount): number {
  const total = count ?? 0
  return total
}
