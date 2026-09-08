/**
 * Task 4.5.3 — the pure pieces of `GET /programs/{id}/today`: adapting a
 * `daily_checkins` row's sleep value into the shared check-in aggregates, and
 * assembling the wire `TodayResponse` envelope. Pure: no database import, no
 * route registration — `getToday` (programService.ts) loads every input this
 * module needs (the program snapshot, the day's check-in row and its feed
 * rows, the progression suggestion) and calls `toTodayResponse` once at the
 * end.
 *
 * D16: check-in completeness AND its value aggregates stay the single
 * implementation in `packages/shared/src/domain/feed.ts` (`checkinStatus`,
 * `checkinValues`) — `checkinValuesFrom` here is a thin, exactly-named
 * wrapper around `checkinValues`, never a second computation of the same
 * phone/desktop aggregates.
 */
import { checkinValues } from '@attention-lab/shared'
import type {
  CheckinField,
  CheckinSleep,
  CheckinStatus,
  CheckinValues,
  FeedRowInput,
  LocalDate,
  NextActionValue,
  ProgressionSuggestion,
  TodayResponseValue,
} from '@attention-lab/shared'

import type { Block } from './blocks.js'

/**
 * Sleep plus the phone/desktop headline feed aggregates (D22's
 * `today.checkin.values`): `row` is `null` for a program-local date with no
 * check-in row at all, in which case every value is `null` (never `0` —
 * "unknown != zero"). Delegates entirely to `checkinValues` (feed.ts, D16)
 * so this is never a second implementation of the same aggregation.
 */
export function checkinValuesFrom(
  row: CheckinSleep | null,
  feedRows: readonly FeedRowInput[],
): CheckinValues {
  return checkinValues(row, feedRows)
}

/** The already-computed `checkin` slice `toTodayResponse` assembles verbatim into the response. */
export interface TodayCheckin {
  readonly status: CheckinStatus
  readonly missing: readonly CheckinField[]
  readonly values: CheckinValues
}

export interface ToTodayResponseInput {
  readonly day: number
  readonly localDate: LocalDate
  readonly blocks: readonly [Block, Block]
  readonly checkin: TodayCheckin
  /** `null` -> the `suggestion` key is omitted entirely (D22) — never sent as an explicit `null`. */
  readonly suggestion: ProgressionSuggestion | null
  readonly nextAction: NextActionValue
}

/**
 * Builds the 2.7.3 `TodayResponse` envelope, amended by D22. The response
 * carries exactly `{ day, localDate, blocks, checkin, nextAction }` plus
 * `suggestion` when (and only when) one exists — no streak, missed-day or
 * punitive derived field is ever added, and stress/mindfulness/note are not
 * part of this shape at all (they belong to the days route, 6.1).
 */
export function toTodayResponse(input: ToTodayResponseInput): TodayResponseValue {
  const base: TodayResponseValue = {
    day: input.day,
    localDate: input.localDate,
    blocks: [input.blocks[0], input.blocks[1]],
    checkin: {
      status: input.checkin.status,
      missing: [...input.checkin.missing],
      values: { ...input.checkin.values },
    },
    nextAction: input.nextAction,
  }

  if (input.suggestion === null) return base

  return {
    ...base,
    suggestion: {
      suggestedTargetSeconds: input.suggestion.suggestedTargetSeconds,
      qualifiedOn: [input.suggestion.qualifiedOn[0], input.suggestion.qualifiedOn[1]],
    },
  }
}
