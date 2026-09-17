/**
 * Read-only feed totals preview for CheckinForm's "More detail" section
 * (task 8.7.2; design.md D36). Every number here comes straight from
 * `feedAggregates` (`packages/shared` `domain/feed.ts`) — this component
 * performs no arithmetic, summing or partial-detection of its own (D4).
 *
 * `rows` is the full current set of feed rows the day would save — the
 * still-active 8.7.1 headline ('all') rows alongside every complete detail
 * row (8.7.2) — exactly as `feedAggregates` expects: it sums scope-`feed`
 * rows regardless of whether they came from a headline field or a detail
 * row, and never adds short-video minutes on top of the total they are a
 * subset of.
 *
 * The partial notice is nested inside the same `feedDeviceMinutes !== null`
 * check as the total it qualifies, exactly as before this change — when
 * there is no feed-scope row for either device yet, `feedDeviceMinutes` is
 * `null` and neither line renders, so opening "More detail" on a
 * not-yet-started day does not lead with a "Partial" complaint about a total
 * that does not exist yet. It used to read " · Partial — a report is
 * missing for phone or desktop" on the same line as the total — a banned
 * middle-dot meta string (shadcn-ui-rework the rework spec §4) — and is now its
 * own plain-clause line; the design doc is explicit that the exact
 * replacement wording is not asserted by any test. Nothing here frames feed
 * minutes as a score to minimise or a number to be ashamed of: the flexible
 * cross-device feed policy supersedes the original zero-feed rule and
 * planned leisure scrolling is compatible with the program (CLAUDE.md).
 */
import { feedAggregates, type FeedRowValue } from '@attention-lab/shared'

import { toFeedRowInput } from './FeedRows.js'

export interface FeedTotalsProps {
  readonly rows: readonly FeedRowValue[]
}

export function FeedTotals({ rows }: FeedTotalsProps) {
  const aggregates = feedAggregates(rows.map(toFeedRowInput))

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      {aggregates.feedDeviceMinutes !== null ? (
        <>
          <p>
            {aggregates.feedDeviceMinutes} {aggregates.unitLabel} (feed)
          </p>
          {aggregates.partial ? <p>Partial: a report is missing for phone or desktop</p> : null}
        </>
      ) : null}
      {aggregates.shortVideoDeviceMinutes !== null ? <p>of which short video: {aggregates.shortVideoDeviceMinutes} min</p> : null}
      {aggregates.appTotals.map((row, index) => (
        <p key={index}>
          Broad app total: {row.minutes} min — {row.device} {row.platform}
        </p>
      ))}
    </div>
  )
}
