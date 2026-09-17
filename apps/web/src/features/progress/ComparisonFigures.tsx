/**
 * The Progress report's baseline/final comparison figures (task 8.8.2;
 * progress-report spec: "Comparison mathematics", "No invented scores").
 * Mounted only when `report.comparison` exists (the caller's job — 8.8.1's
 * `Progress.tsx`); every number here is read straight off `ComparisonValue`
 * (2.4.1/2.7.5) and never recomputed (D4) — this component only formats and
 * chooses wording, it never derives `s0 - s14`, a percentage, or a mean of
 * its own.
 *
 * - `S0 → S14` always shown, even at a zero baseline (e.g. "0 → 0").
 * - The absolute-change figure is pluralised correctly and always precedes
 *   the percentage — the low-baseline rule's "leads with the absolute
 *   count".
 * - The percentage renders "Percentage: not applicable" exactly when
 *   `percentageReduction` is `null` — never `Infinity`, `NaN` or `100%` —
 *   and is wrapped in `<Reported>` so that absent tier renders as the same
 *   ink-muted ruled mark as every other "not a value" in the app, never a
 *   number-shaped placeholder.
 * - `lowBaseline` (s0 < 3) additionally shows a low-baseline note beside the
 *   percentage, explaining why the absolute count is the steadier figure —
 *   it never hides or alters the percentage itself.
 * - Recall means always render as "recall A → B".
 * - A mean first-switch time renders only when the server provided one
 *   (`firstSwitchMeanSeconds !== null`, i.e. all four attempts were
 *   `known`) — never a partial average over fewer than four.
 * - `s0 → s14`, the recall means and the mean first-switch time render in
 *   `<Reported mono>` — these are "tabular figures in comparisons", one of
 *   the three contexts mono is permitted in (the rework spec §4); the pluralised
 *   change sentence and the cause note are prose and stay `font-sans`.
 * - The cause note accompanies every rendered comparison, unconditionally.
 */
import type { ComparisonValue } from '@attention-lab/shared'
import { CAUSE_NOTE } from '@attention-lab/shared'

import { Reported } from '../../ui/Reported.js'
import { formatMmSs, formatPercentageChange, formatRecallMean, formatSwitchChange } from './format.js'

export interface ComparisonFiguresProps {
  readonly comparison: ComparisonValue
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

  const changeText = formatSwitchChange(absoluteChange)
  const percentageText = formatPercentageChange(percentageReduction)

  return (
    <section aria-label="Comparison figures" className="flex flex-col gap-2" data-testid="comparison-figures">
      <p data-testid="s0-s14-figure">
        <Reported mono>{`${s0} → ${s14}`}</Reported>
      </p>
      <p data-testid="change-figure">{changeText}</p>
      <p data-testid="percentage-figure">
        <Reported>{percentageText}</Reported>
      </p>
      {lowBaseline ? (
        <p className="text-sm text-ink-muted" data-testid="low-baseline-note">
          With fewer than three baseline switches, a percentage is unstable; the count above is the more reliable
          figure.
        </p>
      ) : null}
      <p data-testid="recall-means-figure">
        <Reported mono>{`recall ${formatRecallMean(recallBaselineMean)} → ${formatRecallMean(recallFinalMean)}`}</Reported>
      </p>
      {firstSwitchMeanSeconds !== null ? (
        <p data-testid="mean-first-switch-figure">
          <Reported mono>{`Mean T ${formatMmSs(Math.round(firstSwitchMeanSeconds))}`}</Reported>
        </p>
      ) : null}
      <p className="text-sm text-ink-muted" data-testid="cause-note">
        {CAUSE_NOTE}
      </p>
    </section>
  )
}
