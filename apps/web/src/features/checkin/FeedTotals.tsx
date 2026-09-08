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
 */
import { feedAggregates, type FeedRowValue } from '@attention-lab/shared'

import { toFeedRowInput } from './FeedRows.js'

export interface FeedTotalsProps {
  readonly rows: readonly FeedRowValue[]
}

export function FeedTotals({ rows }: FeedTotalsProps) {
  const aggregates = feedAggregates(rows.map(toFeedRowInput))

  return (
    <div className="flex flex-col gap-1 text-sm text-[var(--color-text-muted)]">
      {aggregates.feedDeviceMinutes !== null ? (
        <p>
          {aggregates.feedDeviceMinutes} {aggregates.unitLabel} (feed)
          {aggregates.partial ? <span> · Partial — a report is missing for phone or desktop</span> : null}
        </p>
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
