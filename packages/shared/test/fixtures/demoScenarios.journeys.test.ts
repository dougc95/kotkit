import { describe, expect, it } from 'vitest'

import {
  DEMO_SCENARIOS,
  anchorScenario,
  attemptsOf,
  toEligibilityInput,
} from '../../src/fixtures/demoScenarios.js'
import { checkinStatus } from '../../src/domain/feed.js'
import { evaluateEligibility } from '../../src/domain/eligibility.js'
import { suggestProgression, type PracticeBlockRecord } from '../../src/domain/progression.js'
import { DEMO_SCENARIO_NAMES } from '../../src/domain/types.js'

const JOURNEY_NAMES = ['new-user', 'working-day', 'recovery', 'timing-deviation'] as const

describe('fixtures/demoScenarios: journey scenarios and the completed registry', () => {
  it('Object.keys(DEMO_SCENARIOS) equals DEMO_SCENARIO_NAMES as a set (eight, both directions)', () => {
    const keys = Object.keys(DEMO_SCENARIOS)
    expect(keys.length).toBe(8)
    expect(new Set(keys)).toEqual(new Set(DEMO_SCENARIO_NAMES))
    for (const name of DEMO_SCENARIO_NAMES) {
      expect(keys).toContain(name)
    }
  })

  it('new-user has program null, every row array empty and expected.resultState null', () => {
    const scenario = DEMO_SCENARIOS['new-user']
    expect(scenario.program).toBeNull()
    expect(scenario.revisions).toEqual([])
    expect(scenario.slots).toEqual([])
    expect(scenario.sessions).toEqual([])
    expect(scenario.events).toEqual([])
    expect(scenario.reviews).toEqual([])
    expect(scenario.amendments).toEqual([])
    expect(scenario.agentPlans).toEqual([])
    expect(scenario.checkins).toEqual([])
    expect(scenario.feedRows).toEqual([])
    expect(scenario.expected.resultState).toBeNull()
  })

  it('working-day: viewDay 4, revision 1 {effectiveDay 0, reason "initial plan"} and revision 2 {effectiveDay 4, practiceTargetSeconds 900, reason "progression accepted"}, status active, both baseline attempts eligible, pipeline → final_pending = expected', () => {
    const scenario = DEMO_SCENARIOS['working-day']
    expect(scenario.viewDay).toBe(4)
    expect(scenario.revisions[0]).toMatchObject({ effectiveDay: 0, reason: 'initial plan' })
    expect(scenario.revisions[1]).toMatchObject({
      effectiveDay: 4,
      practiceTargetSeconds: 900,
      reason: 'progression accepted',
    })
    expect(scenario.program!.status).toBe('active')

    const attempts = attemptsOf(scenario)
    const baselineAttempts = attempts.filter((a) => a.phase === 'baseline')
    expect(baselineAttempts.length).toBe(2)
    for (const attempt of baselineAttempts) {
      expect(attempt.eligible).toBe(true)
    }

    const finalAttemptsExist = attempts.some((a) => a.phase === 'final')
    expect(finalAttemptsExist).toBe(false)
    expect(scenario.expected.resultState).toBe('final_pending')
  })

  it('working-day: Days 1–3 each have two finalized practice sessions, Day 4 has one, none carries a slotKey; checkinStatus over each of Days 1–3 is complete using platform-all rows; suggestProgression on Day 4 at 900 returns null', () => {
    const scenario = DEMO_SCENARIOS['working-day']
    const practiceSessions = scenario.sessions.filter((s) => s.kind === 'practice')
    for (const day of [1, 2, 3]) {
      expect(practiceSessions.filter((s) => s.localDay === day).length).toBe(2)
    }
    expect(practiceSessions.filter((s) => s.localDay === 4).length).toBe(1)
    for (const session of practiceSessions) {
      expect(session.slotKey).toBeUndefined()
      expect(session.lifecycle).toBe('finalized')
    }

    for (const day of [1, 2, 3]) {
      const checkin = scenario.checkins.find((c) => c.checkinDay === day)!
      const rows = scenario.feedRows.filter((r) => r.checkinDay === day)
      const status = checkinStatus({ sleepMinutes: checkin.sleepMinutes }, rows)
      expect(status.status).toBe('complete')
      expect(status.missing).toEqual([])
    }

    const anchored = anchorScenario(scenario, new Date('2026-09-20T10:00:00Z'))
    const reviewsByKey = new Map(scenario.reviews.map((r) => [r.sessionKey, r]))
    const blocks: PracticeBlockRecord[] = anchored.sessions
      .filter((s) => s.kind === 'practice')
      .map((s) => {
        const review = reviewsByKey.get(s.sessionKey)!
        return {
          sessionId: s.sessionKey,
          realm: s.realm,
          kind: 'practice',
          localDate: s.localDate,
          targetSeconds: s.targetSeconds,
          completeInterval: s.completeInterval,
          outputQuality: review.outputQuality,
          episodeCount: review.episodeCount,
          finalized: s.lifecycle === 'finalized',
        }
      })
    const suggestion = suggestProgression({ day: 4, currentTargetSeconds: 900, blocks })
    expect(suggestion).toBeNull()
  })

  it('recovery: viewDay 5, exactly one session in lifecycle running, kind practice, with an agentPlans row, an all-null review row and zero events rows; pipeline → final_pending', () => {
    const scenario = DEMO_SCENARIOS['recovery']
    expect(scenario.viewDay).toBe(5)
    const running = scenario.sessions.filter((s) => s.lifecycle === 'running')
    expect(running.length).toBe(1)
    expect(running[0]!.kind).toBe('practice')
    expect(scenario.agentPlans.some((p) => p.sessionKey === running[0]!.sessionKey)).toBe(true)
    const review = scenario.reviews.find((r) => r.sessionKey === running[0]!.sessionKey)!
    expect(review.episodeCount).toBeNull()
    expect(review.countMethod).toBeNull()
    expect(review.externalCount).toBeNull()
    expect(review.unplannedAgentChecks).toBeNull()
    expect(review.mindWanderingCount).toBeNull()
    expect(review.recallScore).toBeNull()
    expect(review.finalizedAtOffsetSeconds).toBeNull()
    expect(scenario.events.filter((e) => e.sessionKey === running[0]!.sessionKey).length).toBe(0)

    const attempts = attemptsOf(scenario)
    const finalAttemptsExist = attempts.some((a) => a.phase === 'final')
    expect(finalAttemptsExist).toBe(false)
    expect(scenario.expected.resultState).toBe('final_pending')
  })

  it('timing-deviation: viewDay 0, status baseline_ready, baseline A running with startedAtOffsetSeconds −1080, timerQuality ok, exactly one clock_gap event with details {gapSeconds: 300} and no resolution key, no baseline B session; pipeline → baseline_pending', () => {
    const scenario = DEMO_SCENARIOS['timing-deviation']
    expect(scenario.viewDay).toBe(0)
    expect(scenario.program!.status).toBe('baseline_ready')
    const baselineA = scenario.sessions.find((s) => s.slotKey === 'baseline:A')!
    expect(baselineA.lifecycle).toBe('running')
    expect(baselineA.startedAtOffsetSeconds).toBe(-1080)
    expect(baselineA.timerQuality).toBe('ok')

    const gapEvents = scenario.events.filter((e) => e.type === 'clock_gap')
    expect(gapEvents.length).toBe(1)
    expect(gapEvents[0]!.details).toEqual({ gapSeconds: 300 })
    expect(Object.prototype.hasOwnProperty.call(gapEvents[0]!.details ?? {}, 'resolution')).toBe(false)

    expect(scenario.sessions.some((s) => s.slotKey === 'baseline:B')).toBe(false)

    expect(scenario.expected.resultState).toBe('baseline_pending')
  })

  it('every root row in the four scenarios has realm demo and every session row timeSource demo_clock', () => {
    for (const name of JOURNEY_NAMES) {
      const scenario = DEMO_SCENARIOS[name]
      if (scenario.program) expect(scenario.program.realm).toBe('demo')
      for (const session of scenario.sessions) {
        expect(session.realm).toBe('demo')
        expect(session.timeSource).toBe('demo_clock')
      }
      for (const checkin of scenario.checkins) {
        expect(checkin.realm).toBe('demo')
      }
    }
  })

  it('across all eight scenarios, evaluateEligibility round-trips every finalized benchmark attempt and no review row stores 0 for a field the scenario description calls blank', () => {
    for (const name of DEMO_SCENARIO_NAMES) {
      const scenario = DEMO_SCENARIOS[name]
      const slotsByKey = new Map(scenario.slots.map((slot) => [slot.slotKey, slot]))
      const sessionsByKey = new Map(scenario.sessions.map((session) => [session.sessionKey, session]))

      for (const review of scenario.reviews) {
        const session = sessionsByKey.get(review.sessionKey)!
        if (session.lifecycle !== 'finalized') {
          // D31: a review not yet finalized stays all-null — never a spurious 0.
          expect(review.episodeCount).toBeNull()
          expect(review.externalCount).toBeNull()
          expect(review.unplannedAgentChecks).toBeNull()
          expect(review.mindWanderingCount).toBeNull()
          expect(review.recallScore).toBeNull()
          expect(review.firstSwitchKind).toBeNull()
          expect(review.materiallyDisrupted).toBeNull()
          expect(review.recallLockedAtOffsetSeconds).toBeNull()
          expect(review.finalizedAtOffsetSeconds).toBeNull()
        }
      }

      for (const session of scenario.sessions) {
        if (session.kind !== 'benchmark' || session.lifecycle !== 'finalized') continue
        const slot = slotsByKey.get(session.slotKey!)!
        const review = scenario.reviews.find((r) => r.sessionKey === session.sessionKey)!
        const input = toEligibilityInput(session, review, slot, false)
        const result = evaluateEligibility(input)
        expect(result.eligible).toBe(session.eligible)
        expect(result.exclusionReasons).toEqual(session.exclusionReasons)
      }
    }
  })

  it('anchorScenario(timing-deviation, 2026-09-20T10:00:00Z) yields baselineDate 2026-09-20 and a running session startedAt 2026-09-20T09:42:00Z', () => {
    const scenario = DEMO_SCENARIOS['timing-deviation']
    const anchored = anchorScenario(scenario, new Date('2026-09-20T10:00:00Z'))
    expect(anchored.baselineDate).toBe('2026-09-20')
    const running = anchored.sessions.find((s) => s.lifecycle === 'running')!
    expect(running.startedAt).toBe('2026-09-20T09:42:00.000Z')
  })
})
