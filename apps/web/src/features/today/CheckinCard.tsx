/**
 * Today's check-in summary card (task 8.2.3; design.md D22; CLAUDE.md
 * "Unknown != zero"). Rendered entirely from the parent Today screen's own
 * `GET /programs/{id}/today` response (`today.checkin`) — this component
 * issues no request of its own, in particular never
 * `GET /programs/{id}/days/{date}` (that call belongs to the full check-in
 * form at `/checkin/:date`, task 8.7.1). `checkin.values` preserves `null`
 * for anything not yet reported (D22): a `null` field always renders "not
 * yet reported", and an explicit `0` always renders "0 min" — the two are
 * never conflated, in either direction.
 */
import { Link } from 'react-router'
import type { CheckinField, TodayResponseValue } from '@attention-lab/shared'

export interface CheckinCardProps {
  /**
   * Accepted for parity with the other Today slots (BlockCard,
   * SuggestionBanner) and a future caller scoping a link or analytics call
   * to the program — this card makes no query of its own and does not need
   * it for that.
   */
  readonly programId: string
  readonly localDate: string
  readonly checkin: TodayResponseValue['checkin']
}

const FIELD_LABEL: Record<CheckinField, string> = {
  sleep: 'sleep',
  feed: 'feed',
}

/** `null` -> "not yet reported"; an explicit `0` -> "0 min" — never coalesced (CLAUDE.md). */
function renderMinutes(value: number | null): string {
  return value === null ? 'not yet reported' : `${value} min`
}

const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:brightness-95 self-start'

export function CheckinCard({ localDate, checkin }: CheckinCardProps) {
  const { status, missing, values } = checkin

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Check-in</h2>

      {status !== 'complete' && missing.length > 0 && (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          {`Still needed: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-[var(--color-text)]">
        <dt className="font-medium">Sleep</dt>
        <dd>{renderMinutes(values.sleepMinutes)}</dd>

        <dt className="font-medium">Phone feed</dt>
        <dd>{renderMinutes(values.phoneFeedMinutes)}</dd>

        <dt className="font-medium">Desktop feed</dt>
        <dd>{renderMinutes(values.desktopFeedMinutes)}</dd>
      </dl>

      <Link className={LINK_CLASSES} to={`/checkin/${localDate}`}>
        Open check-in
      </Link>
    </div>
  )
}
