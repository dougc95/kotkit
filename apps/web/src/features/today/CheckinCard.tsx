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

import { Button } from '../../ui/Button.js'
import { Reported } from '../../ui/Reported.js'

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

export function CheckinCard({ localDate, checkin }: CheckinCardProps) {
  const { status, missing, values } = checkin

  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-4">
      <h2 className="text-sm font-semibold text-ink">Check-in</h2>

      {status !== 'complete' && missing.length > 0 && (
        <p role="status" className="text-sm text-attention">
          {`Still needed: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-ink">
        <dt className="font-medium">Sleep</dt>
        <dd>
          <Reported>{renderMinutes(values.sleepMinutes)}</Reported>
        </dd>

        <dt className="font-medium">Phone feed</dt>
        <dd>
          <Reported>{renderMinutes(values.phoneFeedMinutes)}</Reported>
        </dd>

        <dt className="font-medium">Desktop feed</dt>
        <dd>
          <Reported>{renderMinutes(values.desktopFeedMinutes)}</Reported>
        </dd>
      </dl>

      <Button asChild variant="secondary" className="self-start">
        <Link to={`/checkin/${localDate}`}>Open check-in</Link>
      </Button>
    </div>
  )
}
