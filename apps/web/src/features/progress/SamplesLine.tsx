/**
 * The Progress report's sample-provenance line (task 8.8.1;
 * progress-report spec: "Sample counts and provenance are always visible").
 * Pure presentation of `report.samples` — no client-side recomputation
 * (D4): the eligible counts are exactly what the server sent.
 */
import type { ReportResponseValue } from '@attention-lab/shared'

export interface SamplesLineProps {
  readonly samples: ReportResponseValue['samples']
}

export function SamplesLine({ samples }: SamplesLineProps) {
  return (
    <div>
      <p>
        {samples.baselineEligible} of 2 baseline samples eligible · {samples.finalEligible} of 2 final
        samples eligible
      </p>
      <p className="text-sm text-[var(--color-text-muted)]">All counts are self-reported</p>
    </div>
  )
}
