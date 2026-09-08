/**
 * 5.4.1 — unit tests for `applyTransition` (design.md's session lifecycle
 * diagram, D5, D29). Pure — no database. Covered by API integration in
 * 5.4.2 (this task has no integration suite of its own).
 *
 * Two suites: a 40-row table (4 transition types x 5 lifecycles x 2 kinds)
 * that only asserts the ok/reason outcome, and 16 named cases that pin down
 * the exact patch/eventRow values for the scenarios design.md calls out by
 * name.
 */
import { describe, expect, it } from 'vitest'

import {
  applyTransition,
  buildPauseEventRow,
  type SessionTransitionInput,
  type TransitionFailureReason,
} from '../../src/services/sessionTransitions.js'
import type { SessionKind, SessionLifecycle, TransitionType } from '@attention-lab/shared'

const STARTED_AT = new Date('2026-09-06T10:00:00.000Z')

function secondsAfterStart(seconds: number): Date {
  return new Date(STARTED_AT.getTime() + seconds * 1000)
}

function baseSession(overrides: Partial<SessionTransitionInput> = {}): SessionTransitionInput {
  return {
    kind: 'practice',
    lifecycle: 'running',
    startedAt: STARTED_AT,
    targetSeconds: 900,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    endedAt: null,
    completeInterval: null,
    ...overrides,
  }
}

/** One representative, internally-consistent session for each lifecycle — used by the 40-row table, where only the ok/reason outcome is asserted. */
function sessionFor(lifecycle: SessionLifecycle, kind: SessionKind): SessionTransitionInput {
  switch (lifecycle) {
    case 'running':
      return baseSession({ kind, lifecycle })
    case 'paused':
      return baseSession({ kind, lifecycle, currentPauseStartedAt: secondsAfterStart(50) })
    case 'awaiting_review':
      return baseSession({ kind, lifecycle, endedAt: secondsAfterStart(150), completeInterval: true })
    case 'finalized':
      return baseSession({ kind, lifecycle, endedAt: secondsAfterStart(150), completeInterval: true })
    case 'abandoned':
      return baseSession({ kind, lifecycle, endedAt: secondsAfterStart(150) })
  }
}

const TABLE_NOW = secondsAfterStart(200)

type TableRow = readonly [TransitionType, SessionLifecycle, SessionKind, boolean, TransitionFailureReason?]

// 4 types x 5 lifecycles x 2 kinds = 40 rows.
const TABLE: readonly TableRow[] = [
  // practice
  ['pause', 'running', 'practice', true],
  ['pause', 'paused', 'practice', false, 'invalid_from_state'],
  ['pause', 'awaiting_review', 'practice', false, 'invalid_from_state'],
  ['pause', 'finalized', 'practice', false, 'invalid_from_state'],
  ['pause', 'abandoned', 'practice', false, 'invalid_from_state'],

  ['resume', 'running', 'practice', false, 'invalid_from_state'],
  ['resume', 'paused', 'practice', true],
  ['resume', 'awaiting_review', 'practice', false, 'invalid_from_state'],
  ['resume', 'finalized', 'practice', false, 'invalid_from_state'],
  ['resume', 'abandoned', 'practice', false, 'invalid_from_state'],

  ['end', 'running', 'practice', true],
  ['end', 'paused', 'practice', true],
  ['end', 'awaiting_review', 'practice', false, 'invalid_from_state'],
  ['end', 'finalized', 'practice', false, 'invalid_from_state'],
  ['end', 'abandoned', 'practice', false, 'invalid_from_state'],

  ['abandon', 'running', 'practice', true],
  ['abandon', 'paused', 'practice', true],
  ['abandon', 'awaiting_review', 'practice', true],
  ['abandon', 'finalized', 'practice', false, 'invalid_from_state'],
  ['abandon', 'abandoned', 'practice', false, 'invalid_from_state'],

  // benchmark
  ['pause', 'running', 'benchmark', false, 'invalid_for_kind'],
  ['pause', 'paused', 'benchmark', false, 'invalid_for_kind'],
  ['pause', 'awaiting_review', 'benchmark', false, 'invalid_for_kind'],
  ['pause', 'finalized', 'benchmark', false, 'invalid_from_state'],
  ['pause', 'abandoned', 'benchmark', false, 'invalid_from_state'],

  ['resume', 'running', 'benchmark', false, 'invalid_for_kind'],
  ['resume', 'paused', 'benchmark', false, 'invalid_for_kind'],
  ['resume', 'awaiting_review', 'benchmark', false, 'invalid_for_kind'],
  ['resume', 'finalized', 'benchmark', false, 'invalid_from_state'],
  ['resume', 'abandoned', 'benchmark', false, 'invalid_from_state'],

  ['end', 'running', 'benchmark', true],
  ['end', 'paused', 'benchmark', true],
  ['end', 'awaiting_review', 'benchmark', false, 'invalid_from_state'],
  ['end', 'finalized', 'benchmark', false, 'invalid_from_state'],
  ['end', 'abandoned', 'benchmark', false, 'invalid_from_state'],

  ['abandon', 'running', 'benchmark', true],
  ['abandon', 'paused', 'benchmark', true],
  ['abandon', 'awaiting_review', 'benchmark', true],
  ['abandon', 'finalized', 'benchmark', false, 'invalid_from_state'],
  ['abandon', 'abandoned', 'benchmark', false, 'invalid_from_state'],
]

describe('services/sessionTransitions applyTransition — 40-row matrix', () => {
  for (const [type, lifecycle, kind, expectedOk, expectedReason] of TABLE) {
    it(`${type} from ${lifecycle} (${kind}) -> ok=${expectedOk}${expectedReason ? ` (${expectedReason})` : ''}`, () => {
      const session = sessionFor(lifecycle, kind)
      const result = applyTransition(session, type, TABLE_NOW)
      expect(result.ok).toBe(expectedOk)
      if (!expectedOk) {
        expect(result).toEqual({ ok: false, reason: expectedReason })
      }
    })
  }
})

describe('services/sessionTransitions applyTransition — named cases', () => {
  it('practice running pause -> paused with a pause eventRow', () => {
    const now = secondsAfterStart(300)
    const result = applyTransition(baseSession({ kind: 'practice', lifecycle: 'running' }), 'pause', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch).toEqual({
      lifecycle: 'paused',
      pausedSeconds: 0,
      currentPauseStartedAt: now,
      endedAt: null,
      completeInterval: null,
    })
    expect(result.eventRow).toEqual({ type: 'pause', elapsedMs: 300_000, reason: null })
  })

  it('benchmark running pause -> invalid_for_kind', () => {
    const result = applyTransition(
      baseSession({ kind: 'benchmark', lifecycle: 'running' }),
      'pause',
      secondsAfterStart(10),
    )
    expect(result).toEqual({ ok: false, reason: 'invalid_for_kind' })
  })

  it('benchmark paused resume -> invalid_for_kind', () => {
    const session = baseSession({
      kind: 'benchmark',
      lifecycle: 'paused',
      currentPauseStartedAt: secondsAfterStart(50),
    })
    const result = applyTransition(session, 'resume', secondsAfterStart(100))
    expect(result).toEqual({ ok: false, reason: 'invalid_for_kind' })
  })

  it('resume after 240 s -> pausedSeconds 240, pause cleared, resume eventRow', () => {
    const pauseStartedAt = secondsAfterStart(300)
    const now = secondsAfterStart(540)
    const session = baseSession({ kind: 'practice', lifecycle: 'paused', currentPauseStartedAt: pauseStartedAt })
    const result = applyTransition(session, 'resume', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.pausedSeconds).toBe(240)
    expect(result.patch.currentPauseStartedAt).toBeNull()
    expect(result.patch.lifecycle).toBe('running')
    expect(result.eventRow).toEqual({ type: 'resume', elapsedMs: 300_000, reason: null })
  })

  it('end during a pause closes the open pause then ends', () => {
    const pauseStartedAt = secondsAfterStart(300)
    const now = secondsAfterStart(360)
    const session = baseSession({
      kind: 'practice',
      lifecycle: 'paused',
      pausedSeconds: 100,
      currentPauseStartedAt: pauseStartedAt,
      targetSeconds: 900,
    })
    const result = applyTransition(session, 'end', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.pausedSeconds).toBe(160)
    expect(result.patch.currentPauseStartedAt).toBeNull()
    expect(result.patch.lifecycle).toBe('awaiting_review')
    expect(result.patch.endedAt).toEqual(now)
    expect(result.eventRow).toBeUndefined()
  })

  it('practice end at 480 s of 900 -> completeInterval false, endedAt now (early finish)', () => {
    const now = secondsAfterStart(480)
    const session = baseSession({ kind: 'practice', lifecycle: 'running', targetSeconds: 900 })
    const result = applyTransition(session, 'end', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.completeInterval).toBe(false)
    expect(result.patch.endedAt).toEqual(now)
    expect(result.patch.lifecycle).toBe('awaiting_review')
  })

  it('benchmark end at 840 s -> completeInterval false (stop early)', () => {
    const now = secondsAfterStart(840)
    const session = baseSession({ kind: 'benchmark', lifecycle: 'running', targetSeconds: 1200 })
    const result = applyTransition(session, 'end', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.completeInterval).toBe(false)
  })

  it('end at wall 1140 s with 240 s paused on a 900 s target -> completeInterval true (paused seconds excluded)', () => {
    const now = secondsAfterStart(1140)
    const session = baseSession({ kind: 'practice', lifecycle: 'running', targetSeconds: 900, pausedSeconds: 240 })
    const result = applyTransition(session, 'end', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.completeInterval).toBe(true)
    expect(result.patch.pausedSeconds).toBe(240)
  })

  it('benchmark end at wall 1200 s -> completeInterval true and lifecycle awaiting_review, never finalized (interval reached)', () => {
    const now = secondsAfterStart(1200)
    const session = baseSession({ kind: 'benchmark', lifecycle: 'running', targetSeconds: 1200 })
    const result = applyTransition(session, 'end', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.patch.completeInterval).toBe(true)
    expect(result.patch.lifecycle).toBe('awaiting_review')
    expect(result.patch.lifecycle).not.toBe('finalized')
  })

  it('abandon from running, paused and awaiting_review -> abandoned with completeInterval unchanged, the open pause closed and no eligibility set', () => {
    // running
    {
      const now = secondsAfterStart(50)
      const session = baseSession({ kind: 'practice', lifecycle: 'running', completeInterval: null })
      const result = applyTransition(session, 'abandon', now)
      if (!result.ok) throw new Error('expected ok')
      expect(result.patch).toEqual({
        lifecycle: 'abandoned',
        pausedSeconds: 0,
        currentPauseStartedAt: null,
        endedAt: now,
        completeInterval: null,
      })
      expect(result.eventRow).toBeUndefined()
    }

    // paused: the open pause is folded into pausedSeconds
    {
      const pauseStartedAt = secondsAfterStart(10)
      const now = secondsAfterStart(40)
      const session = baseSession({
        kind: 'practice',
        lifecycle: 'paused',
        pausedSeconds: 50,
        currentPauseStartedAt: pauseStartedAt,
        completeInterval: null,
      })
      const result = applyTransition(session, 'abandon', now)
      if (!result.ok) throw new Error('expected ok')
      expect(result.patch.pausedSeconds).toBe(80)
      expect(result.patch.currentPauseStartedAt).toBeNull()
      expect(result.patch.endedAt).toEqual(now)
      expect(result.patch.completeInterval).toBeNull()
      expect(result.eventRow).toBeUndefined()
    }

    // awaiting_review: already ended by a prior `end` — abandon must not move endedAt or touch completeInterval
    {
      const endedAt = secondsAfterStart(500)
      const now = secondsAfterStart(600)
      const session = baseSession({
        kind: 'practice',
        lifecycle: 'awaiting_review',
        endedAt,
        completeInterval: false,
      })
      const result = applyTransition(session, 'abandon', now)
      if (!result.ok) throw new Error('expected ok')
      expect(result.patch.lifecycle).toBe('abandoned')
      expect(result.patch.endedAt).toEqual(endedAt)
      expect(result.patch.completeInterval).toBe(false)
      expect(result.patch.currentPauseStartedAt).toBeNull()
      expect(result.eventRow).toBeUndefined()
    }
  })

  it('every transition from finalized -> invalid_from_state', () => {
    const types: readonly TransitionType[] = ['pause', 'resume', 'end', 'abandon']
    for (const kind of ['practice', 'benchmark'] as const) {
      for (const type of types) {
        const session = baseSession({
          kind,
          lifecycle: 'finalized',
          endedAt: secondsAfterStart(150),
          completeInterval: true,
        })
        expect(applyTransition(session, type, secondsAfterStart(200))).toEqual({
          ok: false,
          reason: 'invalid_from_state',
        })
      }
    }
  })

  it('every transition from abandoned -> invalid_from_state', () => {
    const types: readonly TransitionType[] = ['pause', 'resume', 'end', 'abandon']
    for (const kind of ['practice', 'benchmark'] as const) {
      for (const type of types) {
        const session = baseSession({ kind, lifecycle: 'abandoned', endedAt: secondsAfterStart(150) })
        expect(applyTransition(session, type, secondsAfterStart(200))).toEqual({
          ok: false,
          reason: 'invalid_from_state',
        })
      }
    }
  })

  it('end from awaiting_review -> invalid_from_state', () => {
    const session = baseSession({
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: secondsAfterStart(150),
      completeInterval: true,
    })
    expect(applyTransition(session, 'end', secondsAfterStart(200))).toEqual({
      ok: false,
      reason: 'invalid_from_state',
    })
  })

  it('resume while running -> invalid_from_state', () => {
    const session = baseSession({ kind: 'practice', lifecycle: 'running' })
    expect(applyTransition(session, 'resume', secondsAfterStart(200))).toEqual({
      ok: false,
      reason: 'invalid_from_state',
    })
  })

  it('pause eventRow.elapsedMs equals unpaused elapsed at now', () => {
    const now = secondsAfterStart(500)
    const session = baseSession({ kind: 'practice', lifecycle: 'running', pausedSeconds: 20 })
    const result = applyTransition(session, 'pause', now)
    if (!result.ok) throw new Error('expected ok')
    expect(result.eventRow?.elapsedMs).toBe(480_000)
  })

  it('a reason passed alongside end or abandon never reaches the returned patch or an eventRow (reason is pause-only, D29)', () => {
    const now = secondsAfterStart(100)

    const endResult = applyTransition(
      baseSession({ kind: 'practice', lifecycle: 'running' }),
      'end',
      now,
      'planned_break',
    )
    if (!endResult.ok) throw new Error('expected ok')
    expect(Object.keys(endResult.patch)).not.toContain('reason')
    expect(endResult.eventRow).toBeUndefined()

    const abandonResult = applyTransition(
      baseSession({ kind: 'practice', lifecycle: 'running' }),
      'abandon',
      now,
      'planned_break',
    )
    if (!abandonResult.ok) throw new Error('expected ok')
    expect(Object.keys(abandonResult.patch)).not.toContain('reason')
    expect(abandonResult.eventRow).toBeUndefined()
  })
})

// 5.4.2 (appended): buildPauseEventRow — the exact session_events insert row
// a pause/resume transition writes alongside its focus_sessions patch.
describe('services/sessionTransitions buildPauseEventRow', () => {
  it('produces a uuid client_event_id, occurred_at = received_at = now and details.reason from the body or null', () => {
    const now = secondsAfterStart(300)

    const withReason = buildPauseEventRow({ type: 'pause', elapsedMs: 300_000, reason: 'planned_break' }, now)
    expect(withReason.clientEventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(withReason.type).toBe('pause')
    expect(withReason.elapsedMs).toBe(300_000)
    expect(withReason.occurredAt).toEqual(now)
    expect(withReason.receivedAt).toEqual(now)
    expect(withReason.details).toEqual({ reason: 'planned_break' })

    const withoutReason = buildPauseEventRow({ type: 'resume', elapsedMs: 540_000, reason: null }, now)
    expect(withoutReason.details).toEqual({ reason: null })
    // Two calls never collide on the same clientEventId.
    expect(withoutReason.clientEventId).not.toBe(withReason.clientEventId)
  })
})
