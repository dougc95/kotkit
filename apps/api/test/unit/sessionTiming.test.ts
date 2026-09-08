/**
 * 5.2.1 — unit tests for `deriveTiming` (design.md D5). Pure — no database.
 * Covered by API integration in 5.1.1, 5.2.2 and 5.4.2 (this task has no
 * integration suite of its own).
 */
import { describe, expect, it } from 'vitest'

import { deriveTiming, type SessionTimingInput } from '../../src/services/sessionTiming.js'

const STARTED_AT = new Date('2026-09-06T10:00:00.000Z')

function session(overrides: Partial<SessionTimingInput> = {}): SessionTimingInput {
  return {
    startedAt: STARTED_AT,
    endedAt: null,
    targetSeconds: 900,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    ...overrides,
  }
}

function secondsAfterStart(seconds: number): Date {
  return new Date(STARTED_AT.getTime() + seconds * 1000)
}

describe('services/sessionTiming deriveTiming', () => {
  it('6:00 into a 15-minute block -> elapsed 360, remaining 540, deadlineReached false', () => {
    const now = secondsAfterStart(360)
    expect(deriveTiming(session({ targetSeconds: 900 }), now)).toEqual({
      elapsedSeconds: 360,
      remainingSeconds: 540,
      deadlineReached: false,
      isPaused: false,
    })
  })

  it('past the target -> remaining 0, deadlineReached true, no lifecycle key in the result', () => {
    const now = secondsAfterStart(960)
    const result = deriveTiming(session({ targetSeconds: 900 }), now)
    expect(result).toEqual({
      elapsedSeconds: 960,
      remainingSeconds: 0,
      deadlineReached: true,
      isPaused: false,
    })
    expect(Object.keys(result).sort()).toEqual([
      'deadlineReached',
      'elapsedSeconds',
      'isPaused',
      'remainingSeconds',
    ])
    expect(result).not.toHaveProperty('lifecycle')
  })

  it('a closed 240 s pause is excluded: 900 s of wall time gives elapsed 660', () => {
    const now = secondsAfterStart(900)
    const result = deriveTiming(session({ targetSeconds: 1200, pausedSeconds: 240 }), now)
    expect(result.elapsedSeconds).toBe(660)
    expect(result.isPaused).toBe(false)
  })

  it('an open pause freezes elapsed: identical results at now and now + 120 s, isPaused true', () => {
    const pauseStartedAt = secondsAfterStart(300)
    const input = session({
      targetSeconds: 1200,
      pausedSeconds: 0,
      currentPauseStartedAt: pauseStartedAt,
    })
    const now = secondsAfterStart(300)
    const later = secondsAfterStart(420)

    const atNow = deriveTiming(input, now)
    const atLater = deriveTiming(input, later)

    expect(atLater).toEqual(atNow)
    expect(atNow.isPaused).toBe(true)
  })

  it('endedAt set -> elapsed is measured to endedAt not now (early finish at 480 s)', () => {
    const endedAt = secondsAfterStart(480)
    const now = secondsAfterStart(900)
    const result = deriveTiming(session({ targetSeconds: 900, endedAt }), now)
    expect(result.elapsedSeconds).toBe(480)
    expect(result.remainingSeconds).toBe(420)
    expect(result.deadlineReached).toBe(false)
  })

  it('benchmark 1200 s at wall 1200 s with no pause -> deadlineReached true', () => {
    const now = secondsAfterStart(1200)
    const result = deriveTiming(session({ targetSeconds: 1200 }), now)
    expect(result.elapsedSeconds).toBe(1200)
    expect(result.deadlineReached).toBe(true)
  })
})
