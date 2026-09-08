/**
 * toFinalizeReview — converts `CountFields.tsx`'s `CountFieldsValue` slice
 * into the corresponding piece of `ReviewInputValue`, the body
 * `POST /sessions/{id}/finalize` accepts (task 8.4.3; design.md D7.1, D10,
 * D31). `BenchmarkReviewPage`'s footer section (8.4.5) is the one that
 * actually calls `useFinalizeSession(...).finalize(...)`; this module only
 * builds ITS section's contribution to that body, the same way later
 * sections (8.4.4's disruption/conditions, 8.4.5's own fields) each build
 * their own slice before 8.4.5 spreads every slice together.
 *
 * D7.1/D31's rule, restated precisely: a blank field is NEVER coerced to
 * `0` — it is simply absent from the returned object, exactly like an
 * unmentioned optional key in a hand-written `ReviewInputValue` literal —
 * while an EXPLICIT "0" the user typed is sent as the number `0`. This
 * applies independently to `episodeCount`, `externalCount` and
 * `mindWanderingCount`: each is present or absent purely on whether its own
 * field was left blank, never influenced by whether a sibling field is
 * blank or not.
 *
 * `countMethod` only ever accompanies `episodeCount` — `ReviewInputSchema`
 * has exactly one `countMethod` field and neither `externalCount` nor
 * `mindWanderingCount` has an equivalent concept — and is omitted whenever
 * `episodeCount` itself is omitted (a method for a count that was never
 * reported would be a stray, meaningless field).
 *
 * `firstSwitchEstimateSeconds` is included only when it could plausibly
 * matter to the server's first-switch derivation: `countMethod` is
 * 'retrospective' (an 'event'-derived S already has a server-side timed
 * episode to use instead — sending an estimate alongside it would suggest
 * the estimate might be preferred, which it never is), `episodeCount` is a
 * reported number greater than 0 (S = 0 always resolves to "20+, capped"
 * regardless of any estimate, and a blank S has no first-switch to derive
 * in the first place), and the estimate itself parses to a value the wire
 * contract (`Type.Integer({minimum: 1, maximum: FIRST_SWITCH_CAP_SECONDS -
 * 1})`) actually accepts — `estimateSecondsFor` below mirrors
 * `CountFields.tsx`'s own guard so a full 20-minute estimate (which lands
 * exactly on the disallowed upper boundary) is silently omitted rather than
 * sent as a value the API would reject.
 */
import type { ReviewInputValue } from '@attention-lab/shared'
import { FIRST_SWITCH_CAP_SECONDS } from '@attention-lab/shared'

import type { CountFieldsValue } from './CountFields.js'

/** Blank -> `null` (not reported, never coerced to 0); a non-negative integer string -> that number. */
function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  return Number(trimmed)
}

/** Mirrors `CountFields.tsx`'s `estimateSecondsFor`: minutes -> seconds only strictly below the cap. */
function estimateSecondsFor(parsedEstimateMinutes: number | null): number | null {
  if (parsedEstimateMinutes === null || parsedEstimateMinutes <= 0) {
    return null
  }
  const seconds = parsedEstimateMinutes * 60
  return seconds < FIRST_SWITCH_CAP_SECONDS ? seconds : null
}

/** This section's contribution to the finalize `review` body — merged with every other section's contribution by 8.4.5. */
export type CountFieldsReviewBody = Pick<
  ReviewInputValue,
  'episodeCount' | 'countMethod' | 'externalCount' | 'mindWanderingCount' | 'firstSwitchEstimateSeconds'
>

export function toFinalizeReview(state: CountFieldsValue): Partial<CountFieldsReviewBody> {
  const body: Partial<CountFieldsReviewBody> = {}

  const episodeCount = parseNonNegativeInt(state.episodeCount)
  if (episodeCount !== null) {
    body.episodeCount = episodeCount
    if (state.countMethod !== null) {
      body.countMethod = state.countMethod
    }
  }

  const externalCount = parseNonNegativeInt(state.externalCount)
  if (externalCount !== null) {
    body.externalCount = externalCount
  }

  const mindWanderingCount = parseNonNegativeInt(state.mindWanderingCount)
  if (mindWanderingCount !== null) {
    body.mindWanderingCount = mindWanderingCount
  }

  if (state.countMethod === 'retrospective' && episodeCount !== null && episodeCount > 0) {
    const estimateSeconds = estimateSecondsFor(parseNonNegativeInt(state.estimateMinutes))
    if (estimateSeconds !== null) {
      body.firstSwitchEstimateSeconds = estimateSeconds
    }
  }

  return body
}
