/**
 * The Progress report's comparability warnings (task 8.8.2; progress-report
 * spec: "Comparability warnings"). Pure presentation of `report.warnings` —
 * each entry's `.message` already names the differing observed condition
 * (device format, language, material level or accommodations) and both
 * sides' values, computed server-side by `comparabilityWarnings` (2.4.3).
 * This component never touches `eligible`/`exclusionReasons` and never
 * recomputes a difference of its own (D4); a warning is shown beside the
 * still-rendered comparison, never in place of it or as a reason to hide
 * it — comparability warnings are informational only.
 */
import type { ComparabilityWarningValue } from '@attention-lab/shared'

export interface ComparabilityWarningsProps {
  readonly warnings: readonly ComparabilityWarningValue[]
}

export function ComparabilityWarnings({ warnings }: ComparabilityWarningsProps) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <ul
      aria-label="Comparability warnings"
      className="flex flex-col gap-1 text-sm text-[var(--color-text-muted)]"
      data-testid="comparability-warnings"
    >
      {warnings.map((warning) => (
        <li key={`${warning.label}-${warning.field}`} data-testid={`warning-${warning.label}-${warning.field}`}>
          {warning.message}
        </li>
      ))}
    </ul>
  )
}
