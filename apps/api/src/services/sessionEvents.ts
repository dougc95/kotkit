/**
 * Task 5.3.1 — pure helpers for `POST /sessions/{id}/events`: partitioning a
 * submitted batch into new/duplicate clientEventIds, catching an impossible
 * elapsed offset before anything is written, and marking a late-arriving
 * event's `details` with the D21 reconciliation warning. No database import
 * anywhere in this file — `appendEvents` (`services/session.ts`) is the one
 * and only place that turns any of this into a Postgres write (the
 * repository-guard unit test in `test/unit/sessionEvents.test.ts` enforces
 * that allowlist).
 *
 * Task 5.3.2 adds the two pure gates behind `POST
 * /sessions/{id}/events/{clientEventId}/void` (`voidEvent`,
 * `services/session.ts`): `canVoid` (a `finalized` attempt is immutable, D9)
 * and `isVoidableType` (a server-written `pause`/`resume` row can never be
 * voided, D28).
 *
 * See design.md D9 (events are append-only; undo is a void marker), D20 (the
 * one `SessionResponse` shape), D21 (idempotent creates; a rejected request
 * writes nothing), D26 (clock gaps: an unresolved `clock_gap` event re-opens
 * the prompt), D28 (undo: an unsent event is dropped locally; a sent event is
 * voided; server-written pause/resume rows are not voidable) and
 * specs/session-recovery.md's "Events are buffered, deduplicated and
 * acknowledged" / "Batch retried" / "Impossible offset".
 */
import type {
  ClockGapDetailsValue,
  EventDetailsValue,
  EventInputValue,
  SessionEventType,
  SessionLifecycle,
} from '@attention-lab/shared'

// ---------------------------------------------------------------------------
// EVENT_OFFSET_TOLERANCE_MS
// ---------------------------------------------------------------------------

/**
 * 5 seconds. D16–D40 fixes no exact value for how far a client-reported
 * `elapsedMs` may exceed the server's own `deriveTiming`-derived elapsed time
 * before the whole batch is rejected as impossible; this unit decides 5000 ms
 * (recorded in LIMITATIONS.md as a chosen, not validated, tolerance — the
 * same treatment D7.3's recall thresholds get in `domain/recall.ts`). An
 * event exactly AT this ceiling is allowed; one millisecond more is not.
 */
export const EVENT_OFFSET_TOLERANCE_MS = 5000

// ---------------------------------------------------------------------------
// partitionBatch
// ---------------------------------------------------------------------------

export interface PartitionBatchResult<T extends { readonly clientEventId: string }> {
  /** First occurrence of every clientEventId not already stored, in submitted order — candidates to insert. */
  readonly accepted: readonly T[]
  /** clientEventIds already stored, or repeated within this same batch (the second-and-later copy). */
  readonly duplicates: readonly string[]
}

/**
 * Splits `events` into `accepted` (genuinely new candidates to insert) and
 * `duplicates` (already stored, or a repeat within this same batch) — a
 * clientEventId repeated within the batch keeps only its FIRST occurrence in
 * `accepted`; every later copy goes to `duplicates`. Pure: `storedClientEventIds`
 * is supplied by the caller from a prior `SELECT`, never queried here, and the
 * actual `INSERT ... ON CONFLICT (session_id, client_event_id) DO NOTHING`
 * (`appendEvents`) is the real backstop against a genuine race between that
 * `SELECT` and the write.
 */
export function partitionBatch<T extends { readonly clientEventId: string }>(
  events: readonly T[],
  storedClientEventIds: ReadonlySet<string>,
): PartitionBatchResult<T> {
  const seenInBatch = new Set<string>()
  const accepted: T[] = []
  const duplicates: string[] = []

  for (const event of events) {
    if (storedClientEventIds.has(event.clientEventId) || seenInBatch.has(event.clientEventId)) {
      duplicates.push(event.clientEventId)
      continue
    }
    seenInBatch.add(event.clientEventId)
    accepted.push(event)
  }

  return { accepted, duplicates }
}

// ---------------------------------------------------------------------------
// findImpossibleOffsets
// ---------------------------------------------------------------------------

/** The subset of one submitted event `findImpossibleOffsets` needs. */
export interface OffsetCheckable {
  readonly clientEventId: string
  readonly elapsedMs: number
}

/**
 * The clientEventIds whose `elapsedMs` exceeds `maxAllowedElapsedMs` — the
 * caller computes that ceiling as `deriveTiming(session, ctx.now).elapsedSeconds
 * * 1000 + EVENT_OFFSET_TOLERANCE_MS` (measured to `ended_at` for an already-
 * ended session, exactly as `deriveTiming` already does). An event exactly AT
 * the ceiling is allowed (`>`, never `>=`); every event past it is named, not
 * just the first, so the caller's 422 `impossible_offset` can list every
 * offending id in one response.
 */
export function findImpossibleOffsets(
  events: readonly OffsetCheckable[],
  maxAllowedElapsedMs: number,
): string[] {
  return events.filter((event) => event.elapsedMs > maxAllowedElapsedMs).map((event) => event.clientEventId)
}

// ---------------------------------------------------------------------------
// withReconciliationWarning
// ---------------------------------------------------------------------------

/**
 * D21: a late event on a session that is already `finalized` or `abandoned`
 * is still stored in full — nothing this codebase does ever silently drops a
 * submitted event — but its `details` is merged with
 * `reconciliation_warning: true` so the stored record itself shows it arrived
 * after the result was locked. Every other submitted key (`alsoOffTask`,
 * `reason`, `gapSeconds`, `resolution`, ...) survives completely unchanged;
 * this never removes or renames anything the client sent.
 */
export function withReconciliationWarning<T extends EventDetailsValue | ClockGapDetailsValue>(
  details: T,
): T & { reconciliation_warning: true } {
  return { ...details, reconciliation_warning: true }
}

// ---------------------------------------------------------------------------
// requiredCompanionFieldErrors — domain-required companion fields per event
// type (agent_check.alsoOffTask, clock_gap.gapSeconds), each schema-optional
// on the wire (contracts/sessions.ts) but mandatory for that one type.
// ---------------------------------------------------------------------------

/**
 * One offending event's D19 422 `fieldErrors` entry — keyed by clientEventId
 * (never a field-path string), matching D18's `details` convention of naming
 * the concrete thing that failed rather than a generic path.
 */
export interface RequiredCompanionFieldError {
  readonly clientEventId: string
  readonly message: string
}

/**
 * Every submitted event whose type requires a companion `details` field it
 * does not carry: `agent_check` requires `details.alsoOffTask` to be a
 * genuine boolean (present, `true` or `false` — an entirely absent `details`
 * object counts as missing); `clock_gap` requires `details.gapSeconds` to be
 * present (any non-negative integer; the wire schema already enforces the
 * range once present). Every other type has no companion requirement. Both
 * of these fields are schema-OPTIONAL on the wire (contracts/sessions.ts) —
 * this is what actually enforces "required for this type", as a 422 that
 * names every offending clientEventId, never a generic 400.
 */
export function requiredCompanionFieldErrors(
  events: readonly EventInputValue[],
): readonly RequiredCompanionFieldError[] {
  const errors: RequiredCompanionFieldError[] = []
  for (const event of events) {
    if (event.type === 'agent_check' && typeof event.details?.alsoOffTask !== 'boolean') {
      errors.push({ clientEventId: event.clientEventId, message: 'details.alsoOffTask is required for agent_check' })
    }
    if (event.type === 'clock_gap' && typeof event.details.gapSeconds !== 'number') {
      errors.push({ clientEventId: event.clientEventId, message: 'details.gapSeconds is required for clock_gap' })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// buildEventInsertRow — the exact row `appendEvents` inserts for one accepted
// event.
// ---------------------------------------------------------------------------

export interface BuildEventInsertRowParams {
  readonly sessionId: string
  readonly event: EventInputValue
  /** `ctx.now` (D8: one clock for every service, including this audit column). */
  readonly receivedAt: Date
  /** True on a `finalized`/`abandoned` session (D21) — merges `reconciliation_warning: true` into `details`. */
  readonly reconciliationWarning: boolean
}

export interface EventInsertRow {
  readonly sessionId: string
  readonly clientEventId: string
  readonly type: EventInputValue['type']
  readonly elapsedMs: number
  readonly occurredAt: Date
  readonly receivedAt: Date
  readonly details: EventDetailsValue | ClockGapDetailsValue
  readonly voidedAt: null
}

/**
 * Pure: the exact `session_events` insert row for one accepted event
 * (design.md's Database model). `details` is the event's own submitted
 * object verbatim (an absent `details` on a non-`clock_gap` event becomes
 * `{}`, matching the column's own NOT NULL default) — a `clock_gap` event
 * stored without a submitted `resolution` round-trips with no `resolution`
 * key present at all (D26: that absence IS the "unresolved" state, never a
 * stored `null`), and one submitted with `resolution: 'continued'` round-trips
 * unchanged. `reconciliationWarning` is applied on top via
 * `withReconciliationWarning`, never in place of the submitted details.
 */
export function buildEventInsertRow(params: BuildEventInsertRowParams): EventInsertRow {
  const { sessionId, event, receivedAt, reconciliationWarning } = params
  const submittedDetails: EventDetailsValue | ClockGapDetailsValue = event.details ?? {}
  const details = reconciliationWarning ? withReconciliationWarning(submittedDetails) : submittedDetails

  return {
    sessionId,
    clientEventId: event.clientEventId,
    type: event.type,
    elapsedMs: event.elapsedMs,
    occurredAt: new Date(event.occurredAt),
    receivedAt,
    details,
    voidedAt: null,
  }
}

// ---------------------------------------------------------------------------
// canVoid / isVoidableType — task 5.3.2 gates behind
// `POST /sessions/{id}/events/{clientEventId}/void`
// ---------------------------------------------------------------------------

/**
 * D9: once a session is `finalized`, its events are frozen — no
 * `session_events` row on it can ever be voided, whatever that row's own type
 * or current `voided_at`. Every other lifecycle remains voidable, including
 * `abandoned` (an abandoned attempt stays editable at the event level; only a
 * `finalized` one freezes) — this is deliberately the specific
 * finalized-immutability rule, not a general "session not active" gate.
 * `voidEvent` (`services/session.ts`) turns `false` into 409
 * `already_finalized`.
 */
export function canVoid(lifecycle: SessionLifecycle): boolean {
  return lifecycle !== 'finalized'
}

/**
 * Only a client-submitted event type may ever be voided: `off_task`,
 * `external`, `agent_check`, `clock_gap` and `visibility`. `pause` and
 * `resume` are server-written transition records (5.4.2, D29) — voiding one
 * would falsify `paused_seconds` while marking the row undone, so `voidEvent`
 * refuses them (D19 names no dedicated code for this; that unit reuses 422
 * `invalid_transition`, recorded as a decision in notes/LIMITATIONS.md, the
 * same treatment 5.3.1 gives its own unnamed-code case).
 */
export function isVoidableType(type: SessionEventType): boolean {
  return type !== 'pause' && type !== 'resume'
}
