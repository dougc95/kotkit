/**
 * Off-task / external / agent-check tallies derived from stored session
 * events, and the "time to first voluntary switch" (T) derived from them.
 *
 * D9: events are append-only; a void marker (`voidedAt`) removes a row from
 * every tally without deleting it. D11: an `agent_check` event is a subtype —
 * when `details.alsoOffTask` is true it also counts as one off-task episode,
 * but off-task and agent-check tallies are never summed into a combined
 * total. D15: a `visibility` event (opt-in context only) is excluded from
 * every tally, and `pause`/`resume`/`clock_gap` are session-lifecycle
 * bookkeeping, not interruptions, so they are excluded too.
 *
 * See specs/practice-sessions/spec.md ("Interruption events with undo and
 * subtypes") and specs/benchmark-assessment/spec.md ("Interruption recording
 * during the benchmark", "Counts are confirmed at review and blank means
 * unknown", "First-switch time has three distinct states").
 */

import {
  FIRST_SWITCH_CAP_SECONDS,
  type CountMethod,
  type FirstSwitch,
  type FirstSwitchKind,
  type FirstSwitchMethod,
  type ReportedCount,
  type SessionEventType,
} from './types.js'

/** The subset of a stored `session_events` row the tally and T rules need. */
export interface EventLike {
  readonly clientEventId: string
  readonly type: SessionEventType
  readonly elapsedMs: number | null
  readonly voidedAt: string | null
  readonly details?: { readonly alsoOffTask?: boolean }
}

/** Event types that are lifecycle/context bookkeeping, never an interruption tally (D15). */
const UNCOUNTED_TYPES: ReadonlySet<SessionEventType> = new Set([
  'pause',
  'resume',
  'clock_gap',
  'visibility',
])

/**
 * Rows that count toward any tally: not voided (D9), and not one of the
 * lifecycle/context types D15 excludes.
 */
export function countedEvents(events: readonly EventLike[]): EventLike[] {
  return events.filter((event) => event.voidedAt === null && !UNCOUNTED_TYPES.has(event.type))
}

/**
 * Counted rows that are, or stand in for, one off-task episode (D11): plain
 * `off_task` rows, plus `agent_check` rows explicitly marked
 * `details.alsoOffTask === true`. Sorted by `elapsedMs` ascending with nulls
 * last, so the earliest-timed episode — the one T is derived from — is
 * always first.
 */
export function episodeEvents(events: readonly EventLike[]): EventLike[] {
  const episodes = countedEvents(events).filter(
    (event) =>
      event.type === 'off_task' ||
      (event.type === 'agent_check' && event.details?.alsoOffTask === true),
  )
  return [...episodes].sort((a, b) => {
    if (a.elapsedMs === null && b.elapsedMs === null) return 0
    if (a.elapsedMs === null) return 1
    if (b.elapsedMs === null) return -1
    return a.elapsedMs - b.elapsedMs
  })
}

export interface EventTallies {
  readonly offTask: number
  readonly external: number
  readonly agentChecks: number
}

/**
 * Raw tallies from stored events, kind-agnostic (the same function serves
 * both practice and benchmark sessions — the caller, not this function,
 * enforces that benchmark and practice metrics stay separate).
 *
 * `offTask` and `agentChecks` overlap by design (D11) — an agent check
 * marked also-off-task is counted in both — so this object deliberately has
 * no combined/total field: summing it would double-count.
 */
export function tallyEvents(events: readonly EventLike[]): EventTallies {
  const counted = countedEvents(events)
  return {
    offTask: episodeEvents(events).length,
    external: counted.filter((event) => event.type === 'external').length,
    agentChecks: counted.filter((event) => event.type === 'agent_check').length,
  }
}

export interface PrefillCounts {
  readonly episodeCount: ReportedCount
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly countMethod: CountMethod | null
}

/**
 * D31: a review's count fields are prefilled from events only when at least
 * one counted event exists for the session — otherwise every field stays
 * blank (`null`, never `0`), because "no events recorded yet" and "zero,
 * confirmed" are different states. When any counted event exists, all three
 * tallies are prefilled together (0 included) with `countMethod: 'event'`.
 */
export function prefillCounts(events: readonly EventLike[]): PrefillCounts {
  if (countedEvents(events).length === 0) {
    return { episodeCount: null, externalCount: null, unplannedAgentChecks: null, countMethod: null }
  }
  const tallies = tallyEvents(events)
  return {
    episodeCount: tallies.offTask,
    externalCount: tallies.external,
    unplannedAgentChecks: tallies.agentChecks,
    countMethod: 'event',
  }
}

// ---------------------------------------------------------------------------
// Time to first voluntary switch (T) — a three-state derivation, never
// coalesced. See specs/benchmark-assessment/spec.md ("First-switch time has
// three distinct states") and types.ts's `FirstSwitch` doc comment.
// ---------------------------------------------------------------------------

export interface DeriveFirstSwitchInput {
  readonly events: readonly EventLike[]
  /** S as reported at review; `null` only when S itself was never reported. */
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  /** An optional user-supplied estimate in seconds, 1..1199. */
  readonly estimateSeconds: number | null
}

export interface DerivedFirstSwitch {
  readonly firstSwitch: FirstSwitch
  readonly method: FirstSwitchMethod | null
}

/**
 * Derives T from S and, depending on how S was counted, either the earliest
 * timed episode event or a user estimate. `countMethod: 'event'` and
 * `countMethod: 'retrospective'` are alternatives, never combined: a
 * retrospective count never consults event timing, and an estimate is never
 * added on top of an event-derived time.
 *
 * - `episodeCount` null → not derivable → `null` (maps to the nullable
 *   `first_switch_*` columns).
 * - `episodeCount` 0 → `{kind:'none_capped'}`, method `null`.
 * - `episodeCount` > 0, `countMethod` 'event', and the earliest episode event
 *   carries `elapsedMs` → `{kind:'known', seconds}`, method `'event'`.
 * - otherwise, an `estimateSeconds` → `{kind:'known', seconds}`, method
 *   `'estimate'` (estimate must be 1..1199, else throws).
 * - otherwise → `{kind:'unknown'}`, method `null`.
 */
export function deriveFirstSwitch(input: DeriveFirstSwitchInput): DerivedFirstSwitch | null {
  const { events, episodeCount, countMethod, estimateSeconds } = input

  if (episodeCount === null) return null
  if (episodeCount === 0) return { firstSwitch: { kind: 'none_capped' }, method: null }

  if (countMethod === 'event') {
    const earliest = episodeEvents(events)[0]
    if (earliest !== undefined && earliest.elapsedMs !== null) {
      return {
        firstSwitch: { kind: 'known', seconds: Math.floor(earliest.elapsedMs / 1000) },
        method: 'event',
      }
    }
  }

  if (estimateSeconds !== null) {
    if (
      !Number.isFinite(estimateSeconds) ||
      estimateSeconds <= 0 ||
      estimateSeconds >= FIRST_SWITCH_CAP_SECONDS
    ) {
      throw new RangeError(
        `First-switch estimate must be between 1 and ${FIRST_SWITCH_CAP_SECONDS - 1} seconds ` +
          `(got ${estimateSeconds})`,
      )
    }
    return { firstSwitch: { kind: 'known', seconds: estimateSeconds }, method: 'estimate' }
  }

  return { firstSwitch: { kind: 'unknown' }, method: null }
}

/** Renders `FirstSwitch` exactly as the PRD requires: "Unknown" never renders as "20+". */
export function formatFirstSwitch(firstSwitch: FirstSwitch): string {
  switch (firstSwitch.kind) {
    case 'none_capped':
      return '20+, capped'
    case 'known': {
      const minutes = Math.floor(firstSwitch.seconds / 60)
      const seconds = firstSwitch.seconds % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }
    case 'unknown':
      return 'Unknown'
  }
}

/** The `first_switch_*` column trio (`session_reviews`), all null together or not at all. */
export interface StoredFirstSwitch {
  readonly first_switch_kind: FirstSwitchKind | null
  readonly first_switch_seconds: number | null
  readonly first_switch_method: FirstSwitchMethod | null
}

export function toStoredFirstSwitch(result: DerivedFirstSwitch | null): StoredFirstSwitch {
  if (result === null) {
    return { first_switch_kind: null, first_switch_seconds: null, first_switch_method: null }
  }
  return {
    first_switch_kind: result.firstSwitch.kind,
    first_switch_seconds: result.firstSwitch.kind === 'known' ? result.firstSwitch.seconds : null,
    first_switch_method: result.method,
  }
}

export function fromStoredFirstSwitch(row: StoredFirstSwitch): DerivedFirstSwitch | null {
  if (row.first_switch_kind === null) return null
  if (row.first_switch_kind === 'known') {
    if (row.first_switch_seconds === null) {
      throw new Error(
        'Corrupt first_switch row: kind "known" must carry a non-null first_switch_seconds',
      )
    }
    return {
      firstSwitch: { kind: 'known', seconds: row.first_switch_seconds },
      method: row.first_switch_method,
    }
  }
  return { firstSwitch: { kind: row.first_switch_kind }, method: row.first_switch_method }
}
