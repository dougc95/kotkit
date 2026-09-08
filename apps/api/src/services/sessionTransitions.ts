/**
 * Task 5.4.1 — pure session transition table and paused-seconds accounting
 * (design.md's "Session lifecycle (one machine, kind-gated)" diagram, D5,
 * D29). No database import anywhere in this file: `applyTransition` decides
 * WHAT the next `focus_sessions` row should look like and WHETHER a
 * `pause`/`resume` `session_events` row should be written alongside it;
 * `POST /sessions/{id}/transitions` (5.4.2) is the only caller that turns
 * this into an actual `SELECT ... FOR UPDATE` / `UPDATE` / `INSERT`.
 *
 * Transition table (kind-gated):
 *  - `running --pause--> paused`         (practice only; benchmark -> `invalid_for_kind`)
 *  - `paused  --resume--> running`       (practice only; benchmark -> `invalid_for_kind`),
 *    `pausedSeconds += now - currentPauseStartedAt`, the open pause cleared
 *  - `running | paused --end--> awaiting_review` — an open pause is closed
 *    into `pausedSeconds` first; `endedAt = now`; `completeInterval =`
 *    unpaused elapsed `>= targetSeconds`, the same rule for both kinds. This
 *    is also how "target reached" lands: the client sends `end` at the
 *    deadline and the server only CONFIRMS it here (D5/D24) — this function
 *    never runs on a GET.
 *  - `running | paused | awaiting_review --abandon--> abandoned` — an open
 *    pause is closed first; `endedAt = endedAt ?? now`; `completeInterval`
 *    and any derived eligibility are left completely untouched (abandon is
 *    always available, D29 — including from `paused`, which design.md's own
 *    ASCII diagram omits but D29 states plainly).
 *  - every other pair -> `invalid_from_state`: anything from `finalized` or
 *    `abandoned` (checked first, before any kind gate, so it applies
 *    uniformly whatever the requested type or kind), `resume` while
 *    `running`, `end` from `awaiting_review`, `pause`/`resume` in a lifecycle
 *    that isn't their one valid starting state.
 *
 * This function never yields `lifecycle: 'finalized'` and never reads or
 * writes a review column — `finalize` (group 5b) is the only writer of
 * derived fields (D4).
 *
 * Reason handling (D29): a `reason` string, when supplied, is threaded
 * through only for a `pause` transition, landing on `eventRow.reason`
 * (the route, 5.4.2, is what turns that into the stored event's
 * `details.reason`). `resume`, `end` and `abandon` accept the same optional
 * parameter but never let it reach the returned `patch` or an `eventRow` —
 * `resume` never receives one to begin with in practice (the client only
 * ever attaches a reason to a pause), and `end`/`abandon` drop it entirely,
 * matching D29's "reason is stored only on pause events; accepted and
 * ignored for end/abandon".
 */
import { randomUUID } from 'node:crypto'
import type { SessionKind, SessionLifecycle, TransitionType } from '@attention-lab/shared'

import { deriveTiming } from './sessionTiming.js'

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface SessionTransitionInput {
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
}

/** The exact `focus_sessions` columns a successful transition changes — never `finalized`, never a review column. */
export interface SessionTransitionPatch {
  readonly lifecycle: SessionLifecycle
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
}

/**
 * The one `session_events` row a `pause` or `resume` transition writes
 * alongside its `focus_sessions` patch (design.md's Database model: `type`,
 * `elapsed_ms`; `occurred_at`/`received_at` are `ctx.now`, stamped by the
 * route, not here). `reason` is `null` whenever none was supplied, and is
 * always `null` for `resume` regardless of what was passed to
 * `applyTransition` (D29: a reason is pause-only).
 */
export interface TransitionEventRow {
  readonly type: 'pause' | 'resume'
  readonly elapsedMs: number
  readonly reason: string | null
}

export type TransitionFailureReason = 'invalid_for_kind' | 'invalid_from_state'

export type ApplyTransitionResult =
  | { readonly ok: true; readonly patch: SessionTransitionPatch; readonly eventRow?: TransitionEventRow }
  | { readonly ok: false; readonly reason: TransitionFailureReason }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Once a session reaches either of these, no further transition is possible — checked before any kind gate or per-type rule. */
const TERMINAL_LIFECYCLES = ['finalized', 'abandoned'] as const satisfies readonly SessionLifecycle[]

/** `pause` and `resume` are the two transition types design.md restricts to practice sessions. */
const PAUSE_OR_RESUME = ['pause', 'resume'] as const satisfies readonly TransitionType[]

// ---------------------------------------------------------------------------
// Small pure arithmetic helpers
// ---------------------------------------------------------------------------

/** Whole seconds from `from` to `to`, floored — the same rule `sessionTiming.ts` uses for every other duration in this codebase. */
function diffSeconds(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 1000)
}

/** Folds an open pause (if any) into `pausedSeconds` as of `now`, returning the closed-pause pair `end` and `abandon` both need. */
function closeOpenPause(
  session: Pick<SessionTransitionInput, 'pausedSeconds' | 'currentPauseStartedAt'>,
  now: Date,
): { readonly pausedSeconds: number; readonly currentPauseStartedAt: null } {
  if (session.currentPauseStartedAt === null) {
    return { pausedSeconds: session.pausedSeconds, currentPauseStartedAt: null }
  }
  return {
    pausedSeconds: session.pausedSeconds + diffSeconds(session.currentPauseStartedAt, now),
    currentPauseStartedAt: null,
  }
}

/** Unpaused elapsed seconds `now`, given a (possibly just-closed) `pausedSeconds` and no open pause — thin wrapper over `deriveTiming` so this file has exactly one source of truth for the elapsed formula. */
function unpausedElapsedSeconds(
  session: Pick<SessionTransitionInput, 'startedAt' | 'targetSeconds'>,
  pausedSeconds: number,
  effectiveEnd: Date | null,
  now: Date,
): number {
  return deriveTiming(
    {
      startedAt: session.startedAt,
      endedAt: effectiveEnd,
      targetSeconds: session.targetSeconds,
      pausedSeconds,
      currentPauseStartedAt: null,
    },
    now,
  ).elapsedSeconds
}

// ---------------------------------------------------------------------------
// Per-type transition logic
// ---------------------------------------------------------------------------

function invalidFromState(): ApplyTransitionResult {
  return { ok: false, reason: 'invalid_from_state' }
}

function applyPause(session: SessionTransitionInput, now: Date, reason: string | null): ApplyTransitionResult {
  if (session.lifecycle !== 'running') return invalidFromState()

  const elapsedMs = unpausedElapsedSeconds(session, session.pausedSeconds, session.endedAt, now) * 1000

  return {
    ok: true,
    patch: {
      lifecycle: 'paused',
      pausedSeconds: session.pausedSeconds,
      currentPauseStartedAt: now,
      endedAt: session.endedAt,
      completeInterval: session.completeInterval,
    },
    eventRow: { type: 'pause', elapsedMs, reason },
  }
}

function applyResume(session: SessionTransitionInput, now: Date): ApplyTransitionResult {
  if (session.lifecycle !== 'paused') return invalidFromState()

  const { pausedSeconds } = closeOpenPause(session, now)
  const elapsedMs = unpausedElapsedSeconds(session, pausedSeconds, session.endedAt, now) * 1000

  return {
    ok: true,
    patch: {
      lifecycle: 'running',
      pausedSeconds,
      currentPauseStartedAt: null,
      endedAt: session.endedAt,
      completeInterval: session.completeInterval,
    },
    // D29: resume never carries a reason, whatever `applyTransition` was called with.
    eventRow: { type: 'resume', elapsedMs, reason: null },
  }
}

function applyEnd(session: SessionTransitionInput, now: Date): ApplyTransitionResult {
  if (session.lifecycle !== 'running' && session.lifecycle !== 'paused') return invalidFromState()

  const { pausedSeconds } = closeOpenPause(session, now)
  const endedAt = now
  const elapsedSeconds = unpausedElapsedSeconds(session, pausedSeconds, endedAt, now)

  return {
    ok: true,
    patch: {
      lifecycle: 'awaiting_review',
      pausedSeconds,
      currentPauseStartedAt: null,
      endedAt,
      completeInterval: elapsedSeconds >= session.targetSeconds,
    },
  }
}

function applyAbandon(session: SessionTransitionInput, now: Date): ApplyTransitionResult {
  // The terminal-lifecycle check in `applyTransition` has already ruled out
  // `finalized`/`abandoned`, so every remaining lifecycle (`running`,
  // `paused`, `awaiting_review`) is a valid abandon source — abandon is
  // always available (D29).
  const { pausedSeconds } = closeOpenPause(session, now)

  return {
    ok: true,
    patch: {
      lifecycle: 'abandoned',
      pausedSeconds,
      currentPauseStartedAt: null,
      // `awaiting_review` already carries its own `endedAt` from the `end`
      // that put it there — abandon must not overwrite it with a later time.
      endedAt: session.endedAt ?? now,
      // Untouched either way: `running`/`paused` never had one (`null`
      // stays `null`); `awaiting_review`'s own `end`-derived value survives.
      completeInterval: session.completeInterval,
    },
  }
}

// ---------------------------------------------------------------------------
// applyTransition
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// buildPauseEventRow (task 5.4.2) — the exact `session_events` insert row a
// pause or resume transition writes alongside its `focus_sessions` patch.
// ---------------------------------------------------------------------------

export interface PauseEventInsertRow {
  readonly clientEventId: string
  readonly type: 'pause' | 'resume'
  readonly elapsedMs: number
  readonly occurredAt: Date
  readonly receivedAt: Date
  readonly details: { readonly reason: string | null }
}

/**
 * Pure (task 5.4.2): turns the `TransitionEventRow` a successful `pause`/
 * `resume` result carries into the exact `session_events` insert row
 * (design.md's Database model). `occurredAt` and `receivedAt` are both `now`
 * — the caller's own `ctx.now`, never read from a clock here — and
 * `details.reason` is `eventRow.reason` verbatim: already `null` for every
 * `resume` and for a `pause` with no supplied reason (D29 — `applyTransition`
 * decided that; this function only carries it through).
 */
export function buildPauseEventRow(eventRow: TransitionEventRow, now: Date): PauseEventInsertRow {
  return {
    clientEventId: randomUUID(),
    type: eventRow.type,
    elapsedMs: eventRow.elapsedMs,
    occurredAt: now,
    receivedAt: now,
    details: { reason: eventRow.reason },
  }
}

export function applyTransition(
  session: SessionTransitionInput,
  type: TransitionType,
  now: Date,
  reason?: string | null,
): ApplyTransitionResult {
  if ((TERMINAL_LIFECYCLES as readonly SessionLifecycle[]).includes(session.lifecycle)) {
    return invalidFromState()
  }

  if ((PAUSE_OR_RESUME as readonly TransitionType[]).includes(type) && session.kind !== 'practice') {
    return { ok: false, reason: 'invalid_for_kind' }
  }

  switch (type) {
    case 'pause':
      return applyPause(session, now, reason ?? null)
    case 'resume':
      return applyResume(session, now)
    case 'end':
      return applyEnd(session, now)
    case 'abandon':
      return applyAbandon(session, now)
  }
}
