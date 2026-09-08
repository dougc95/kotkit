/**
 * CountFields — the second section of `/benchmark/:sessionId/scoring` (task
 * 8.4.3; design.md D7.1, D9, D11, D31; specs/benchmark-assessment: "Counts
 * are confirmed at review and blank means unknown", "First-switch time has
 * three distinct states"). Mounted by `BenchmarkReviewPage` (8.4.2) directly
 * below the Scoring section; two further sections (8.4.4, 8.4.5) are
 * appended after this one, without touching this file.
 *
 * Fully controlled: `BenchmarkReviewPage` owns the `CountFieldsValue` slice
 * and passes it down as `value`/`onChange` (unlike `Scoring`, 8.4.2, which
 * owns its own local answers state and only reports derived values upward)
 * — this component never keeps the count values themselves in local state,
 * only the cosmetic "has External been hand-edited yet" bookkeeping for its
 * badge (`externalTouched` below; S needs no equivalent — its own
 * `countMethod` already encodes exactly that).
 *
 * S (`episodeCount`) and E (`externalCount`) are prefilled once, on mount,
 * from `packages/shared`'s `prefillCounts(session.events)` — itself built on
 * `countedEvents`/`episodeEvents`: D9, a voided row is excluded from the
 * tally without being deleted; D11, an `agent_check` row marked
 * `alsoOffTask` counts as one S episode without ever being summed into an
 * agent-check total. `prefillCounts` returns every field `null` together
 * when NO counted event exists for the session (never `0`) — S and E then
 * start genuinely blank, with the placeholder "leave blank if unknown",
 * editable from the very first render.
 *
 * When events DID prefill S, its input is **disabled** and carries the
 * badge "from recorded events (method: event)" — the recorded event count
 * is the authoritative source and is never silently overwritten by a stray
 * keystroke. "Replace with a paper tally" is the one action that unlocks S:
 * it clears the field and flips `countMethod` to 'retrospective', matching
 * D31/D7.1's rule that any client-typed S always carries
 * `countMethod: 'retrospective'` on the wire — `ReviewInputSchema` has
 * exactly one `countMethod` field and it always accompanies `episodeCount`,
 * never E or M. E has no such lock: it stays a plain editable count,
 * prefilled once as a starting value with the same badge while unedited,
 * and the badge simply disappears on the first keystroke into it.
 *
 * M (`mindWanderingCount`) is never prefilled — there is no event type for
 * noticed mind-wandering — and is explicitly labeled "descriptive only": it
 * plays no role in eligibility or in the first-switch derivation below.
 *
 * The first-switch preview reuses `deriveFirstSwitch`/`formatFirstSwitch`
 * verbatim from `packages/shared` rather than re-deriving the three-state
 * rule in the UI: `episodeCount` blank -> no preview at all; `0` ->
 * "20+, capped"; event-derived with a timed earliest episode -> "m:ss
 * (event)"; retrospective with no estimate -> "Unknown" (never "20+, capped"
 * — the two are never interchangeable); retrospective with a 0–20
 * "Estimated minute of first switch" -> "≈ m min (estimate)". No total is
 * ever computed across S and E.
 */
import { useEffect, useRef, useState } from 'react'
import type { CountMethod, DerivedFirstSwitch, EventLike, SessionResponseValue } from '@attention-lab/shared'
import { FIRST_SWITCH_CAP_SECONDS, deriveFirstSwitch, formatFirstSwitch, prefillCounts } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'

const MAX_ESTIMATE_MINUTES = 20

// ---------------------------------------------------------------------------
// CountFieldsValue — the review-reducer slice this section owns.
// `BenchmarkReviewPage` (8.4.2's exception file) holds this in a plain
// `useState`, below its Scoring slice, and passes it straight through.
// ---------------------------------------------------------------------------

export interface CountFieldsValue {
  readonly episodeCount: string
  readonly countMethod: CountMethod | null
  readonly externalCount: string
  readonly mindWanderingCount: string
  readonly estimateMinutes: string
}

export const BLANK_COUNT_FIELDS_VALUE: CountFieldsValue = {
  episodeCount: '',
  countMethod: null,
  externalCount: '',
  mindWanderingCount: '',
  estimateMinutes: '',
}

/** Blank -> `null` (not reported); a non-negative integer string -> that number; anything else (defensive only — the inputs below never commit such a string) -> `null`. */
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

/**
 * Gates a keystroke rather than the committed value: blank is always
 * allowed (that is how a field gets back to "unreported"), a non-digit
 * keystroke is ignored, and — when `max` is given — a value above it is
 * ignored too. Mirrors `features/review/CountField.tsx`'s
 * ignore-the-bad-keystroke philosophy, extended with the estimate field's
 * upper bound.
 */
function isValidDigitsInput(raw: string, max?: number): boolean {
  if (raw === '') {
    return true
  }
  if (!/^\d+$/.test(raw)) {
    return false
  }
  if (max !== undefined && Number(raw) > max) {
    return false
  }
  return true
}

/**
 * The estimate input is capped at `MAX_ESTIMATE_MINUTES` (20) minutes, but
 * `deriveFirstSwitch` rejects an `estimateSeconds` at or above
 * `FIRST_SWITCH_CAP_SECONDS` (20 * 60) — a full 20-minute estimate lands
 * exactly on that boundary. Rather than let a valid-looking UI value throw
 * at derivation time, minutes -> seconds conversion is only ever attempted
 * strictly below the cap; 20 (and 0, and blank) simply contribute no
 * estimate, matching "blank" for derivation purposes without inventing a
 * value the domain layer would reject.
 */
function estimateSecondsFor(parsedEstimateMinutes: number | null): number | null {
  if (parsedEstimateMinutes === null || parsedEstimateMinutes <= 0) {
    return null
  }
  const seconds = parsedEstimateMinutes * 60
  return seconds < FIRST_SWITCH_CAP_SECONDS ? seconds : null
}

// ---------------------------------------------------------------------------
// CountField — one S/E numeric field: badge while prefilled-and-untouched,
// placeholder while blank, optionally disabled while locked to an
// event-derived S.
// ---------------------------------------------------------------------------

export interface CountFieldProps {
  readonly label: string
  readonly value: string
  readonly method: CountMethod | null
  readonly onChange: (value: string) => void
  readonly prefilled: boolean
  readonly disabled?: boolean
}

export function CountField({ label, value, method, onChange, prefilled, disabled = false }: CountFieldProps) {
  const id = `count-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        placeholder="leave blank if unknown"
        aria-describedby={prefilled ? hintId : undefined}
        className="min-h-11 w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)] disabled:opacity-70"
        onChange={(event) => {
          const raw = event.target.value
          if (!isValidDigitsInput(raw)) {
            return
          }
          onChange(raw)
        }}
      />
      {prefilled ? (
        <p id={hintId} className="text-xs text-[var(--color-text-muted)]">
          from recorded events (method: {method ?? 'event'})
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FirstSwitchPreview — renders the already-derived three-state result.
// Never re-derives or re-labels it: "Unknown" and "20+, capped" come from
// two disjoint branches below and can never be confused for one another.
// ---------------------------------------------------------------------------

export interface FirstSwitchPreviewProps {
  readonly firstSwitch: DerivedFirstSwitch | null
  readonly estimateMinutes: string
}

export function FirstSwitchPreview({ firstSwitch, estimateMinutes }: FirstSwitchPreviewProps) {
  if (firstSwitch === null) {
    return null
  }

  const { firstSwitch: result, method } = firstSwitch

  let text: string
  if (result.kind === 'none_capped') {
    text = '20+, capped'
  } else if (result.kind === 'unknown') {
    text = 'Unknown'
  } else if (method === 'estimate') {
    text = `≈ ${estimateMinutes} min (estimate)`
  } else {
    text = `${formatFirstSwitch(result)} (event)`
  }

  return <p className="text-sm text-[var(--color-text)]">First switch, preview: {text}</p>
}

// ---------------------------------------------------------------------------
// CountFields
// ---------------------------------------------------------------------------

export interface CountFieldsProps {
  readonly session: SessionResponseValue
  readonly value: CountFieldsValue
  readonly onChange: (value: CountFieldsValue) => void
}

export function CountFields({ session, value, onChange }: CountFieldsProps) {
  // `EventResponseValue.details` is a wire-level union (plain event details
  // vs. clock-gap details) that TypeScript cannot structurally narrow to
  // `EventLike`'s `{ alsoOffTask?: boolean }` on its own, even though every
  // branch is safe to read `.alsoOffTask` off (a clock_gap event's details
  // simply has no such key, so it reads as `undefined` — exactly what
  // `episodeEvents`'s `alsoOffTask === true` check expects). `clock_gap`
  // itself is also one of `UNCOUNTED_TYPES`, excluded before `.details` is
  // ever consulted at all (D15).
  const events = session.events as unknown as readonly EventLike[]

  // Applies the one-time event prefill on mount only — by the time this
  // section renders, `BenchmarkReviewPage` has already resolved its
  // `GET /sessions/{id}` (session.events is final), so there is no later
  // moment this needs to re-fire, and re-firing on every render would
  // repeatedly clobber whatever the user has since typed.
  const appliedPrefillRef = useRef(false)
  const [externalTouched, setExternalTouched] = useState(false)

  useEffect(() => {
    if (appliedPrefillRef.current) {
      return
    }
    appliedPrefillRef.current = true
    const prefill = prefillCounts(events)
    if (prefill.countMethod === null) {
      return
    }
    onChange({
      ...value,
      episodeCount: String(prefill.episodeCount),
      externalCount: String(prefill.externalCount),
      countMethod: 'event',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only, see comment above.
  }, [])

  function handleEpisodeChange(next: string): void {
    onChange({ ...value, episodeCount: next, countMethod: next === '' ? null : 'retrospective' })
  }

  function handleReplaceWithPaperTally(): void {
    onChange({ ...value, episodeCount: '', countMethod: 'retrospective' })
  }

  function handleExternalChange(next: string): void {
    setExternalTouched(true)
    onChange({ ...value, externalCount: next })
  }

  function handleMindWanderingChange(next: string): void {
    onChange({ ...value, mindWanderingCount: next })
  }

  function handleEstimateChange(next: string): void {
    if (!isValidDigitsInput(next, MAX_ESTIMATE_MINUTES)) {
      return
    }
    onChange({ ...value, estimateMinutes: next })
  }

  const parsedEpisodeCount = parseNonNegativeInt(value.episodeCount)
  const parsedEstimateMinutes = parseNonNegativeInt(value.estimateMinutes)

  const firstSwitch = deriveFirstSwitch({
    events,
    episodeCount: parsedEpisodeCount,
    countMethod: value.countMethod,
    estimateSeconds: estimateSecondsFor(parsedEstimateMinutes),
  })

  const sIsEventLocked = value.countMethod === 'event'
  const showEstimateInput =
    value.countMethod === 'retrospective' && parsedEpisodeCount !== null && parsedEpisodeCount > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6">
        <div className="space-y-2">
          <CountField
            label="Off-task episodes (S)"
            value={value.episodeCount}
            method={value.countMethod}
            prefilled={sIsEventLocked}
            disabled={sIsEventLocked}
            onChange={handleEpisodeChange}
          />
          {sIsEventLocked ? (
            <Button variant="secondary" onClick={handleReplaceWithPaperTally}>
              Replace with a paper tally
            </Button>
          ) : null}
        </div>

        <CountField
          label="External interruptions (E)"
          value={value.externalCount}
          method={value.countMethod}
          prefilled={!externalTouched && value.externalCount !== ''}
          onChange={handleExternalChange}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="mind-wandering-count" className="block text-sm font-medium text-[var(--color-text)]">
          Noticed mind-wandering (M)
        </label>
        <p id="mind-wandering-count-hint" className="text-xs text-[var(--color-text-muted)]">
          descriptive only
        </p>
        <input
          id="mind-wandering-count"
          type="text"
          inputMode="numeric"
          value={value.mindWanderingCount}
          placeholder="leave blank if unknown"
          aria-describedby="mind-wandering-count-hint"
          className="min-h-11 w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)]"
          onChange={(event) => {
            if (!isValidDigitsInput(event.target.value)) {
              return
            }
            handleMindWanderingChange(event.target.value)
          }}
        />
      </div>

      <FirstSwitchPreview firstSwitch={firstSwitch} estimateMinutes={value.estimateMinutes} />

      {showEstimateInput ? (
        <div className="space-y-1">
          <label htmlFor="first-switch-estimate" className="block text-sm font-medium text-[var(--color-text)]">
            Estimated minute of first switch
          </label>
          <input
            id="first-switch-estimate"
            type="text"
            inputMode="numeric"
            value={value.estimateMinutes}
            placeholder="leave blank if unknown"
            className="min-h-11 w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)]"
            onChange={(event) => handleEstimateChange(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  )
}
