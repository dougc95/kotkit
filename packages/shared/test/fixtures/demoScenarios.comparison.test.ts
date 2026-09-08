import { describe, expect, it } from 'vitest'

import {
  DEMO_SCENARIOS,
  anchorScenario,
  attemptsOf,
  toEligibilityInput,
  type DemoScenario,
} from '../../src/fixtures/demoScenarios.js'
import { computeComparison, resolveResultState, selectSlotCandidates, sampleCounts } from '../../src/domain/comparison.js'
import { evaluateEligibility } from '../../src/domain/eligibility.js'

const FOUR_SCENARIOS: readonly DemoScenario[] = [
  DEMO_SCENARIOS['comparable-change']!,
  DEMO_SCENARIOS['mixed-result']!,
  DEMO_SCENARIOS['missing-final']!,
  DEMO_SCENARIOS['zero-baseline']!,
]

describe('fixtures/demoScenarios: comparison scenarios', () => {
  it('every program/session/checkin row in the four scenarios has realm demo and every session row timeSource demo_clock (D34)', () => {
    for (const scenario of FOUR_SCENARIOS) {
      expect(scenario.program).not.toBeNull()
      expect(scenario.program!.realm).toBe('demo')
      for (const session of scenario.sessions) {
        expect(session.realm).toBe('demo')
        expect(session.timeSource).toBe('demo_clock')
      }
      for (const checkin of scenario.checkins) {
        expect(checkin.realm).toBe('demo')
      }
    }
  })

  it('for each finalized benchmark attempt, evaluateEligibility over its stored fields returns exactly the stored eligible/exclusionReasons', () => {
    for (const scenario of FOUR_SCENARIOS) {
      const slotsByKey = new Map(scenario.slots.map((slot) => [slot.slotKey, slot]))
      const reviewsByKey = new Map(scenario.reviews.map((review) => [review.sessionKey, review]))
      for (const session of scenario.sessions) {
        if (session.kind !== 'benchmark' || session.lifecycle !== 'finalized') continue
        const slot = slotsByKey.get(session.slotKey!)!
        const review = reviewsByKey.get(session.sessionKey)!
        const input = toEligibilityInput(session, review, slot, false)
        const result = evaluateEligibility(input)
        expect(result.eligible).toBe(session.eligible)
        expect(result.exclusionReasons).toEqual(session.exclusionReasons)
      }
    }
  })

  it('anchorScenario with loadInstant 2026-09-20T10:00:00Z and viewDay 15 yields baselineDate 2026-09-05, baseline slots on Day 0 and final slots on Day 14 of that date (D35)', () => {
    const scenario = DEMO_SCENARIOS['comparable-change']!
    const anchored = anchorScenario(scenario, new Date('2026-09-20T10:00:00Z'))
    expect(anchored.baselineDate).toBe('2026-09-05')
    const baselineA = anchored.slots.find((slot) => slot.slotKey === 'baseline:A')!
    const finalA = anchored.slots.find((slot) => slot.slotKey === 'final:A')!
    expect(baselineA.assignedLocalDate).toBe('2026-09-05')
    expect(finalA.assignedLocalDate).toBe('2026-09-19')
  })

  it('comparable-change: attemptsOf → selectSlotCandidates → computeComparison → resolveResultState yields improvement_maintained_recall = expected.resultState, s0 5, s14 3, percentageReduction 40, recall means 4 → 4', () => {
    const scenario = DEMO_SCENARIOS['comparable-change']!
    const attempts = attemptsOf(scenario)
    const candidates = selectSlotCandidates(attempts)
    const comparison = computeComparison(attempts)
    expect(comparison).not.toBeNull()
    expect(comparison!.s0).toBe(5)
    expect(comparison!.s14).toBe(3)
    expect(comparison!.percentageReduction).toBe(40)
    expect(comparison!.recallBaselineMean).toBe(4)
    expect(comparison!.recallFinalMean).toBe(4)
    const { baselineEligible, finalEligible } = sampleCounts(candidates)
    const state = resolveResultState({
      baselineEligible,
      finalEligible,
      finalAttemptsExist: attempts.some((a) => a.phase === 'final'),
      day14Finished: scenario.viewDay > 14,
      comparison,
    })
    expect(state).toBe('improvement_maintained_recall')
    expect(state).toBe(scenario.expected.resultState)
  })

  it('mixed-result: yields fewer_switches_lower_recall with recall means 4 → 2', () => {
    const scenario = DEMO_SCENARIOS['mixed-result']!
    const attempts = attemptsOf(scenario)
    const comparison = computeComparison(attempts)
    expect(comparison).not.toBeNull()
    expect(comparison!.recallBaselineMean).toBe(4)
    expect(comparison!.recallFinalMean).toBe(2)
    const candidates = selectSlotCandidates(attempts)
    const { baselineEligible, finalEligible } = sampleCounts(candidates)
    const state = resolveResultState({
      baselineEligible,
      finalEligible,
      finalAttemptsExist: attempts.some((a) => a.phase === 'final'),
      day14Finished: scenario.viewDay > 14,
      comparison,
    })
    expect(state).toBe('fewer_switches_lower_recall')
    expect(state).toBe(scenario.expected.resultState)
  })

  it('missing-final: computeComparison null, insufficient_samples, sampleCounts {2,1}, final B episodeCount null (not 0) with [interval_incomplete, count_unknown] and firstSwitch null', () => {
    const scenario = DEMO_SCENARIOS['missing-final']!
    const attempts = attemptsOf(scenario)
    const comparison = computeComparison(attempts)
    expect(comparison).toBeNull()
    const candidates = selectSlotCandidates(attempts)
    const { baselineEligible, finalEligible } = sampleCounts(candidates)
    expect(baselineEligible).toBe(2)
    expect(finalEligible).toBe(1)
    const state = resolveResultState({
      baselineEligible,
      finalEligible,
      finalAttemptsExist: attempts.some((a) => a.phase === 'final'),
      day14Finished: scenario.viewDay > 14,
      comparison,
    })
    expect(state).toBe('insufficient_samples')
    expect(state).toBe(scenario.expected.resultState)

    const finalB = attempts.find((a) => a.phase === 'final' && a.label === 'B')!
    expect(finalB.episodeCount).toBeNull()
    expect(finalB.episodeCount).not.toBe(0)
    expect(finalB.eligible).toBe(false)
    expect(finalB.exclusionReasons).toEqual(['interval_incomplete', 'count_unknown'])
    expect(finalB.firstSwitch).toBeNull()
  })

  it('zero-baseline: zero_baseline, percentageReduction null, absoluteChange 0', () => {
    const scenario = DEMO_SCENARIOS['zero-baseline']!
    const attempts = attemptsOf(scenario)
    const comparison = computeComparison(attempts)
    expect(comparison).not.toBeNull()
    expect(comparison!.percentageReduction).toBeNull()
    expect(comparison!.absoluteChange).toBe(0)
    const candidates = selectSlotCandidates(attempts)
    const { baselineEligible, finalEligible } = sampleCounts(candidates)
    const state = resolveResultState({
      baselineEligible,
      finalEligible,
      finalAttemptsExist: attempts.some((a) => a.phase === 'final'),
      day14Finished: scenario.viewDay > 14,
      comparison,
    })
    expect(state).toBe('zero_baseline')
    expect(state).toBe(scenario.expected.resultState)
  })

  it('every benchmark session row carries a slotKey, every session row has exactly one review row (D31), and every finalized session has finalizedAtOffsetSeconds set', () => {
    for (const scenario of FOUR_SCENARIOS) {
      const reviewKeys = scenario.reviews.map((review) => review.sessionKey)
      for (const session of scenario.sessions) {
        if (session.kind === 'benchmark') {
          expect(session.slotKey).toBeDefined()
        }
        const matching = scenario.reviews.filter((review) => review.sessionKey === session.sessionKey)
        expect(matching.length).toBe(1)
        if (session.lifecycle === 'finalized') {
          expect(matching[0]!.finalizedAtOffsetSeconds).not.toBeNull()
        }
      }
      expect(new Set(reviewKeys).size).toBe(reviewKeys.length)
    }
  })
})
