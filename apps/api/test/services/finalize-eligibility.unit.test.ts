/**
 * 5.8.4 — unit tests for the pure benchmark eligibility / first-switch
 * derivation `finalizeSession`'s benchmark branch calls
 * (`deriveBenchmarkFinalizeEligibility`, `services/review.ts`): the D26
 * clock-gap force, the D11/D15 first-switch event filtering (via the shared
 * `deriveFirstSwitch`), the D7.1 null-never-zero count handling, and the
 * D23 slot-date comparison. No database import — covered end to end by API
 * integration in `test/sessions/finalize-eligibility.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { deriveBenchmarkFinalizeEligibility, type BenchmarkFinalizeDerivationInput } from '../../src/services/review.js'
import type { SessionEventRow } from '../../src/services/sessionSerializer.js'

function baseInput(
  overrides: Partial<BenchmarkFinalizeDerivationInput> = {},
): BenchmarkFinalizeDerivationInput {
  return {
    events: [],
    episodeCount: 0,
    countMethod: 'event',
    firstSwitchEstimateSeconds: null,
    completeInterval: true,
    recallLockedAt: new Date('2026-09-06T09:25:00.000Z'),
    recallScores: [1, 1, 1, 1, 1],
    materiallyDisrupted: false,
    storedTimerQuality: 'ok',
    sessionLocalDate: '2026-09-06',
    slotAssignedLocalDate: '2026-09-06',
    realm: 'demo',
    timeSource: 'measured',
    ...overrides,
  }
}

function baseEvent(overrides: Partial<SessionEventRow> = {}): SessionEventRow {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    clientEventId: 'client-event-1',
    type: 'off_task',
    occurredAt: new Date('2026-09-06T09:05:00.000Z'),
    elapsedMs: 60_000,
    receivedAt: new Date('2026-09-06T09:05:01.000Z'),
    details: {},
    voidedAt: null,
    ...overrides,
  } as SessionEventRow
}

describe('deriveBenchmarkFinalizeEligibility (5.8.4)', () => {
  it('null episodeCount is passed as unreported, not 0', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({ episodeCount: null, countMethod: null }),
    )

    expect(result.firstSwitch).toEqual({
      first_switch_kind: null,
      first_switch_seconds: null,
      first_switch_method: null,
    })
    expect(result.exclusionReasons).toContain('count_unknown')
    expect(result.eligible).toBe(false)
  })

  it('voided off_task events are excluded from first-switch input', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        episodeCount: 1,
        countMethod: 'event',
        events: [baseEvent({ elapsedMs: 60_000, voidedAt: new Date('2026-09-06T09:06:00.000Z') })],
      }),
    )

    // No non-voided episode event exists and no estimate was supplied, so
    // the derivation falls through to 'unknown' rather than reading the
    // voided event's elapsedMs.
    expect(result.firstSwitch.first_switch_kind).toBe('unknown')
    expect(result.firstSwitch.first_switch_seconds).toBeNull()
  })

  it('visibility events are excluded from first-switch input', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        episodeCount: 1,
        countMethod: 'event',
        events: [
          baseEvent({ clientEventId: 'c1', type: 'visibility', elapsedMs: 1_000 }),
          baseEvent({ clientEventId: 'c2', type: 'off_task', elapsedMs: 50_000 }),
        ],
      }),
    )

    // The visibility row's earlier elapsedMs must never win — if it were
    // treated as an episode event, this would read 'known' at 1 s instead.
    expect(result.firstSwitch).toEqual({
      first_switch_kind: 'known',
      first_switch_seconds: 50,
      first_switch_method: 'event',
    })
  })

  it('agent_check alsoOffTask counts as off-task for first switch', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        episodeCount: 1,
        countMethod: 'event',
        events: [
          baseEvent({ type: 'agent_check', elapsedMs: 45_000, details: { alsoOffTask: true } }),
        ],
      }),
    )

    expect(result.firstSwitch).toEqual({
      first_switch_kind: 'known',
      first_switch_seconds: 45,
      first_switch_method: 'event',
    })
  })

  it('agent_check without alsoOffTask does not', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        episodeCount: 1,
        countMethod: 'event',
        events: [baseEvent({ type: 'agent_check', elapsedMs: 45_000, details: {} })],
      }),
    )

    expect(result.firstSwitch.first_switch_kind).toBe('unknown')
  })

  it('slot date compared to focus_sessions.local_date', () => {
    const deviated = deriveBenchmarkFinalizeEligibility(
      baseInput({ sessionLocalDate: '2026-09-07', slotAssignedLocalDate: '2026-09-06' }),
    )
    expect(deviated.exclusionReasons).toContain('timing_deviation')
    expect(deviated.eligible).toBe(false)

    const onDate = deriveBenchmarkFinalizeEligibility(
      baseInput({ sessionLocalDate: '2026-09-06', slotAssignedLocalDate: '2026-09-06' }),
    )
    expect(onDate.exclusionReasons).not.toContain('timing_deviation')
  })

  it('demo realm never produces simulated_time', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({ realm: 'demo', timeSource: 'demo_clock' }),
    )

    expect(result.exclusionReasons).not.toContain('simulated_time')
  })

  it('excludedByAmendment is false at finalize', () => {
    const result = deriveBenchmarkFinalizeEligibility(baseInput())

    expect(result.exclusionReasons).not.toContain('excluded_by_amendment')
    expect(result.eligible).toBe(true)
    expect(result.exclusionReasons).toEqual([])
  })

  it('an unresolved clock_gap event forces timer_quality to uncertain before evaluateEligibility is called', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        storedTimerQuality: 'ok',
        events: [baseEvent({ type: 'clock_gap', elapsedMs: 30_000, details: { gapSeconds: 300 } })],
      }),
    )

    expect(result.timerQuality).toBe('uncertain')
    expect(result.exclusionReasons).toContain('timer_uncertain')
    expect(result.eligible).toBe(false)
  })

  it('a clock_gap event with details.resolution set does not force timer_quality', () => {
    const result = deriveBenchmarkFinalizeEligibility(
      baseInput({
        storedTimerQuality: 'ok',
        events: [
          baseEvent({
            type: 'clock_gap',
            elapsedMs: 30_000,
            details: { gapSeconds: 300, resolution: 'continued' },
          }),
        ],
      }),
    )

    expect(result.timerQuality).toBe('ok')
    expect(result.exclusionReasons).not.toContain('timer_uncertain')
  })
})
