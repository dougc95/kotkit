/**
 * The Progress report's benchmark-attempt table (task 8.8.1). Every column
 * renders a value the server already computed — nothing here derives
 * eligibility, a score or a percentage of its own (D4).
 *
 * A row whose `lifecycle` is not `'finalized'` (running, paused,
 * awaiting_review, abandoned) shows that lifecycle word in its own Status
 * column and 'Not finalized' in every finalized-only column (S, T, recall
 * score, E, M, disruption, eligibility) — never a blank-as-null value, so an
 * in-progress or abandoned attempt can never be mistaken for a finalized
 * attempt that simply left counts unreported. The 'Explain or exclude'
 * amendment control (8.8.6, AmendmentDialog) is likewise only ever mounted
 * for a finalized row.
 */
import type { AttemptValue } from '@attention-lab/shared'

import { AmendmentDialog } from './AmendmentDialog.js'
import {
  formatConditions,
  formatDisruption,
  formatEpisodeCount,
  formatExclusionReasons,
  formatFirstSwitch,
  formatLifecycle,
  formatPhase,
  formatReportedCount,
  formatTimeSource,
  NOT_FINALIZED,
} from './format.js'

/** `AttemptValue` plus the revision NUMBER (never the raw `revisionId`) `Progress.tsx` joins in from `report.revisions`. */
export interface AttemptTableRow extends AttemptValue {
  readonly revisionNumber: number | null
}

export interface AttemptTableProps {
  readonly attempts: readonly AttemptTableRow[]
}

const COLUMN_HEADERS = [
  'Phase',
  'Label',
  'Date',
  'Time source',
  'Status',
  'S',
  'T',
  'Recall score',
  'E',
  'M',
  'Disruption',
  'Conditions',
  'Eligibility',
  'Exclusion reasons',
  'Protocol revision',
] as const

export function AttemptTable({ attempts }: AttemptTableProps) {
  if (attempts.length === 0) {
    return <p>No benchmark attempts yet.</p>
  }

  return (
    // See ExactValuesTable.tsx's identical comment: `tabIndex={0}` for axe's
    // "scrollable-region-focusable" (WCAG 2.1.1); no `role="region"` (the
    // table's own caption already names it, and a second named landmark
    // collided with other same-page region names in practice).
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <caption className="sr-only">Benchmark attempts</caption>
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
            {COLUMN_HEADERS.map((header) => (
              <th key={header} scope="col" className="px-2 py-2 font-medium">
                {header}
              </th>
            ))}
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => {
            const finalized = attempt.lifecycle === 'finalized'
            const revisionText =
              attempt.revisionNumber === null ? '—' : `Revision ${attempt.revisionNumber}`

            return (
              <tr key={attempt.attemptId} className="border-b border-[var(--color-border)] align-top">
                <td className="px-2 py-2">{formatPhase(attempt.phase)}</td>
                <td className="px-2 py-2">{attempt.label}</td>
                <td className="px-2 py-2">{attempt.localDate}</td>
                <td className="px-2 py-2">{formatTimeSource(attempt.timeSource)}</td>
                <td className="px-2 py-2" data-testid={`status-${attempt.attemptId}`}>
                  {formatLifecycle(attempt.lifecycle)}
                </td>
                <td className="px-2 py-2" data-testid={`s-${attempt.attemptId}`}>
                  {finalized ? formatEpisodeCount(attempt.episodeCount, attempt.countMethod) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2" data-testid={`t-${attempt.attemptId}`}>
                  {finalized ? formatFirstSwitch(attempt.firstSwitch) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2" data-testid={`recall-${attempt.attemptId}`}>
                  {finalized ? formatReportedCount(attempt.recallScore) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2" data-testid={`e-${attempt.attemptId}`}>
                  {finalized ? formatReportedCount(attempt.externalCount) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2" data-testid={`m-${attempt.attemptId}`}>
                  {finalized ? formatReportedCount(attempt.mindWanderingCount) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2" data-testid={`disruption-${attempt.attemptId}`}>
                  {finalized ? formatDisruption(attempt.materiallyDisrupted) : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2">{formatConditions(attempt.conditions)}</td>
                <td className="px-2 py-2" data-testid={`eligibility-${attempt.attemptId}`}>
                  {finalized ? (attempt.eligible ? 'Eligible' : 'Not eligible') : NOT_FINALIZED}
                </td>
                <td className="px-2 py-2">{formatExclusionReasons(attempt.exclusionReasons)}</td>
                <td className="px-2 py-2">{revisionText}</td>
                <td className="px-2 py-2">
                  {finalized ? (
                    // KNOWN LIMITATION: the report's AttemptValue schema carries no
                    // per-attempt amendments[] field (only the derived
                    // excludedByAmendment flag), so a previously created amendment
                    // (from an earlier page load) will not appear in this dialog's
                    // list until AttemptValue gains a real amendments[] field or this
                    // table fetches GET /sessions/{attemptId} per row. An amendment
                    // created in the SAME browser session appears immediately
                    // (AmendmentDialog appends its own 201 response locally).
                    <AmendmentDialog sessionId={attempt.attemptId} amendments={[]} />
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
