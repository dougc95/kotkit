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
 * amendment control is likewise only ever mounted for a finalized row.
 *
 * Every cell whose text can be one of the three-tier taxonomy's own strings
 * (a `ReportedCount`, a `FirstSwitch`, the disruption attestation,
 * eligibility, exclusion reasons, or the revision dash) is wrapped in
 * `<Reported>`, which tiers it: '20+, capped' is explicitly RECORDED (a
 * measurement, not an absence — the value this taxonomy exists to protect),
 * 'Unknown' is UNCERTAIN (amber), and 'Not reported'/'Not finalized'/'—' are
 * all ABSENT (ink-muted, ruled). S/T/Recall/E/M additionally render
 * `<Reported mono>`: this table is one of the two dense data tables
 * the rework spec §4 names explicitly ("the dense data tables (`AttemptTable` and
 * `ExactValuesTable` alike — digits must not shift in either)"), one of the
 * three contexts mono is permitted in.
 *
 * shadcn's own `Table` root component renders a SECOND `overflow-x-auto`
 * wrapper div with no `tabIndex`; since this table has no fixed width, that
 * inner div — not this file's own outer one — would become the actual
 * scrolling element, and it would fail axe's "scrollable-region-focusable"
 * check instead of passing it. So this keeps its existing single wrapper and
 * composes shadcn's table PARTS onto a plain `<table>`.
 */
import type { AttemptValue } from '@attention-lab/shared'

import { Reported } from '../../ui/Reported.js'
import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../ui/shadcn/table.js'
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
    <div className="relative overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <TableCaption className="sr-only">Benchmark attempts</TableCaption>
        <TableHeader>
          <TableRow className="border-b border-rule text-ink-muted">
            {COLUMN_HEADERS.map((header) => (
              <TableHead key={header} scope="col" className="px-2 py-2 font-medium whitespace-normal">
                {header}
              </TableHead>
            ))}
            <TableHead scope="col" className="px-2 py-2 whitespace-normal">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((attempt) => {
            const finalized = attempt.lifecycle === 'finalized'
            const revisionText =
              attempt.revisionNumber === null ? '—' : `Revision ${attempt.revisionNumber}`

            return (
              <TableRow key={attempt.attemptId} className="border-b border-rule align-top">
                <TableCell className="px-2 py-2 align-top">{formatPhase(attempt.phase)}</TableCell>
                <TableCell className="px-2 py-2 align-top">{attempt.label}</TableCell>
                <TableCell className="px-2 py-2 align-top font-mono tabular-nums">{attempt.localDate}</TableCell>
                <TableCell className="px-2 py-2 align-top">{formatTimeSource(attempt.timeSource)}</TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`status-${attempt.attemptId}`}>
                  {formatLifecycle(attempt.lifecycle)}
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`s-${attempt.attemptId}`}>
                  <Reported mono>
                    {finalized ? formatEpisodeCount(attempt.episodeCount, attempt.countMethod) : NOT_FINALIZED}
                  </Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`t-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatFirstSwitch(attempt.firstSwitch) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`recall-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.recallScore) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`e-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.externalCount) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`m-${attempt.attemptId}`}>
                  <Reported mono>{finalized ? formatReportedCount(attempt.mindWanderingCount) : NOT_FINALIZED}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`disruption-${attempt.attemptId}`}>
                  <Reported>{finalized ? formatDisruption(attempt.materiallyDisrupted) : NOT_FINALIZED}</Reported>
                </TableCell>
                {/* `whitespace-normal`: this column's content is a
                    comma-joined prose list (`formatConditions`), which
                    `TableCell`'s own base `whitespace-nowrap` would otherwise
                    force onto one unbreakable line, pushing the table far
                    past its `min-w-[1080px]`. `cn()` inside `TableCell`
                    merges this class last, so it wins over the base. */}
                <TableCell
                  className="px-2 py-2 align-top whitespace-normal"
                  data-testid={`conditions-${attempt.attemptId}`}
                >
                  <Reported>{formatConditions(attempt.conditions)}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`eligibility-${attempt.attemptId}`}>
                  {/* `eligible` is `Type.Boolean()` on the wire (report.ts's
                      AttemptSchema) — never null — so only NOT_FINALIZED
                      ever hits the absent tier here; 'Eligible'/'Not
                      eligible' both default to recorded. Tiered anyway: a
                      reviewer scanning this row for what's a real value and
                      what isn't should never have to remember which columns
                      "count". */}
                  <Reported>{finalized ? (attempt.eligible ? 'Eligible' : 'Not eligible') : NOT_FINALIZED}</Reported>
                </TableCell>
                {/* `whitespace-normal`: this column's content is a full
                    sentence per exclusion reason (`formatExclusionReasons`),
                    the same unbreakable-line problem `Conditions` has above. */}
                <TableCell
                  className="px-2 py-2 align-top whitespace-normal"
                  data-testid={`exclusion-${attempt.attemptId}`}
                >
                  <Reported>{formatExclusionReasons(attempt.exclusionReasons)}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top" data-testid={`revision-${attempt.attemptId}`}>
                  <Reported>{revisionText}</Reported>
                </TableCell>
                <TableCell className="px-2 py-2 align-top">
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
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </table>
    </div>
  )
}
