/**
 * The Progress screen (task 8.8.1), mounted at `/progress` under RailLayout
 * (7.1.3). Resolves `GET /programs/current` -> `GET /programs/{id}/report`
 * (the 7.4 session-aware refetch policy applies via the app's shared
 * `QueryClient` defaults — no query here overrides it) and renders the
 * sample-provenance line and the attempt table; no score, percentage or
 * eligibility is ever computed here (D4) — every value comes straight from
 * the report response.
 *
 * `ResultState`/`ComparisonFigures`/`ComparabilityWarnings` (8.8.2),
 * `PracticeTrend`/`DailyTrend` (8.8.3) and `ExportPreview` (8.8.4) are wired
 * in below.
 *
 * `GET /programs/current`'s real, verified shape (D22) returns 200 with
 * `program: null` when the acting principal has no program yet — it never
 * 404s. This component treats that as the primary "no program" path. A
 * `NotFoundError` is handled the identical way defensively (same empty
 * state), so the same code serves both a literal 404 and any other framing
 * of "there is no program to report on".
 */
import { useQuery } from '@tanstack/react-query'
import type { ReportResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { NotFoundError, ValidationError } from '../../lib/api/errors.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { AttemptTable, type AttemptTableRow } from './AttemptTable.js'
import { ComparabilityWarnings } from './ComparabilityWarnings.js'
import { ComparisonFigures } from './ComparisonFigures.js'
import { DailyTrend } from './DailyTrend.js'
import { ExportPreview } from './ExportPreview.js'
import { formatRealm } from './format.js'
import { PracticeTrend } from './PracticeTrend.js'
import { ProgressEmptyState } from './ProgressEmptyState.js'
import { ResultState } from './ResultState.js'
import { SamplesLine } from './SamplesLine.js'

/**
 * Joins each attempt's `revisionId` to the revision NUMBER the matching
 * `report.revisions` row carries — the table renders "Revision 3", never
 * the raw revision id (no ids in the DOM). A revision the report did not
 * include (should not happen; every attempt's revision is created before
 * the attempt can exist) falls back to `null`, rendered as '—'.
 */
function withRevisionNumbers(
  attempts: ReportResponseValue['attempts'],
  revisions: ReportResponseValue['revisions'],
): AttemptTableRow[] {
  const revisionNumberById = new Map(revisions.map((revision) => [revision.id, revision.revision]))
  return attempts.map((attempt) => ({
    ...attempt,
    revisionNumber: revisionNumberById.get(attempt.revisionId) ?? null,
  }))
}

interface ReportSectionsProps {
  readonly programId: string
}

/** Everything after "a program exists" — its own component so its query only ever runs with a real `programId`. */
function ReportSections({ programId }: ReportSectionsProps) {
  const reportQuery = useQuery({
    queryKey: queryKeys.report(programId),
    queryFn: () => api.report.get(programId),
  })

  if (reportQuery.isPending) {
    return <div aria-busy="true">Loading report</div>
  }

  if (reportQuery.isError || reportQuery.data === undefined) {
    // 422 realm mixing: the fixed server message, no partial table (identity-realm:
    // "Realms are never mixed in a result" — a mixed report is never rendered half-built).
    if (reportQuery.error instanceof ValidationError) {
      return (
        <div role="alert">
          <p>{reportQuery.error.message}</p>
        </div>
      )
    }
    return (
      <div>
        <p>Report unavailable. Retry.</p>
        <Button
          onClick={() => {
            void reportQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  const report = reportQuery.data

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-[var(--color-text-muted)]">{formatRealm(report.realm)}</p>

      <SamplesLine samples={report.samples} />

      <AttemptTable attempts={withRevisionNumbers(report.attempts, report.revisions)} />

      <ResultState resultState={report.resultState} />
      {report.comparison !== undefined ? <ComparisonFigures comparison={report.comparison} /> : null}
      <ComparabilityWarnings warnings={report.warnings} />

      <PracticeTrend practice={report.practice} />
      <DailyTrend days={report.days} />

      <ExportPreview programId={programId} />
    </div>
  )
}

export function Progress() {
  const currentQuery = useQuery({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
  })

  if (currentQuery.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (currentQuery.isError || currentQuery.data === undefined) {
    if (currentQuery.error instanceof NotFoundError) {
      return <ProgressEmptyState />
    }
    return (
      <div>
        <p>Report unavailable. Retry.</p>
        <Button
          onClick={() => {
            void currentQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  const { program } = currentQuery.data
  if (program === null) {
    return <ProgressEmptyState />
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Progress</h1>
      <ReportSections programId={program.id} />
    </div>
  )
}
