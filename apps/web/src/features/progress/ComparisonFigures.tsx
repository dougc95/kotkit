/**
 * The Progress report's baseline/final comparison figures (task 8.8.2;
 * progress-report spec: "Comparison mathematics", "No invented scores").
 * Mounted only when `report.comparison` exists (the caller's job — 8.8.1's
 * `Progress.tsx`, wired via this task's `centralWiringNeeded`); every
 * number here is read straight off `ComparisonValue` (2.4.1/2.7.5) and
 * never recomputed (D4) — this component only formats and chooses wording,
 * it never derives `s0 - s14`, a percentage, or a mean of its own.
 *
 * - `S0 → S14` always shown, even at a zero baseline (e.g. "0 → 0").
 * - The absolute-change figure is pluralised correctly ("1 fewer switch",
 *   "2 fewer switches") and always precedes the percentage, which is what
 *   "leads with the absolute count" (the low-baseline rule) means here —
 *   the percentage is never the only figure shown.
 * - The percentage renders "Percentage: not applicable" exactly when
 *   `percentageReduction` is `null` (which the domain layer guarantees is
 *   exactly when `s0 === 0`) — never `Infinity`, `NaN` or `100%`.
 * - `percentageReduction` is signed (positive when switches fell, negative
 *   when they rose) — formatting a negative value as "N% reduction" would
 *   misdescribe an increase, so the sign only ever changes the WORD
 *   ("reduction" vs "increase") applied to `Math.abs(percentageReduction)`;
 *   the underlying number is still exactly what the server computed.
 * - `lowBaseline` (s0 < 3) additionally shows a low-baseline note beside
 *   the percentage, explaining why the absolute count is the steadier
 *   figure — it never hides or alters the percentage itself.
 * - Recall means always render as "recall A → B".
 * - A mean first-switch time renders only when the server provided one
 *   (`firstSwitchMeanSeconds !== null`, i.e. all four attempts were
 *   `known`) — never a partial average over fewer than four.
 * - The cause note accompanies every rendered comparison, unconditionally.
 */
import type { ComparisonValue } from '@attention-lab/shared'
import { CAUSE_NOTE } from '@attention-lab/shared'

import { formatMmSs } from './format.js'

export interface ComparisonFiguresProps {
  readonly comparison: ComparisonValue
}

function switchWord(count: number): string {
  return count === 1 ? 'switch' : 'switches'
}

/** `4` -> `'4'`, `4.5` -> `'4.5'` — never a trailing `.0` for a whole-number mean. */
function formatMean(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function ComparisonFigures({ comparison }: ComparisonFiguresProps) {
  const {
    s0,
    s14,
    absoluteChange,
    percentageReduction,
    lowBaseline,
    recallBaselineMean,
    recallFinalMean,
    firstSwitchMeanSeconds,
  } = comparison

  let changeText: string
  if (absoluteChange > 0) {
    changeText = `${absoluteChange} fewer ${switchWord(absoluteChange)}`
  } else if (absoluteChange < 0) {
    const more = Math.abs(absoluteChange)
    changeText = `${more} more ${switchWord(more)}`
  } else {
    changeText = 'No change in switches'
  }

  let percentageText: string
  if (percentageReduction === null) {
    percentageText = 'Percentage: not applicable'
  } else if (percentageReduction >= 0) {
    percentageText = `${percentageReduction}% reduction`
  } else {
    percentageText = `${Math.abs(percentageReduction)}% increase`
  }

  return (
    <section aria-label="Comparison figures" className="flex flex-col gap-2" data-testid="comparison-figures">
      <p data-testid="s0-s14-figure">
        {s0} → {s14}
      </p>
      <p data-testid="change-figure">{changeText}</p>
      <p data-testid="percentage-figure">{percentageText}</p>
      {lowBaseline ? (
        <p className="text-sm text-[var(--color-text-muted)]" data-testid="low-baseline-note">
          With fewer than three baseline switches, a percentage is unstable; the count above is the more reliable
          figure.
        </p>
      ) : null}
      <p data-testid="recall-means-figure">
        recall {formatMean(recallBaselineMean)} → {formatMean(recallFinalMean)}
      </p>
      {firstSwitchMeanSeconds !== null ? (
        <p data-testid="mean-first-switch-figure">Mean T {formatMmSs(Math.round(firstSwitchMeanSeconds))}</p>
      ) : null}
      <p className="text-sm text-[var(--color-text-muted)]" data-testid="cause-note">
        {CAUSE_NOTE}
      </p>
    </section>
  )
}
