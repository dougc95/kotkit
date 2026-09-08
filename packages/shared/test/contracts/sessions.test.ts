import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import {
  AgentPlanResponse,
  ClockGapBody,
  CreateSessionBody,
  EventInput,
  EventResponse,
  EventsBatchBody,
  FinalizeBody,
  FinalizeResponse,
  FirstSwitchSchema,
  RecallBody,
  ReviewInputSchema,
  ReviewResponse,
  SessionResponse,
  TransitionBody,
} from '../../src/contracts/sessions.js'

const UUID_1 = '123e4567-e89b-12d3-a456-426614174000'
const UUID_2 = '223e4567-e89b-12d3-a456-426614174000'
const UUID_3 = '323e4567-e89b-12d3-a456-426614174000'
const UUID_4 = '423e4567-e89b-12d3-a456-426614174000'
const ISO_1 = '2026-09-10T09:00:00.000Z'
const ISO_2 = '2026-09-10T09:15:00.000Z'
const ISO_3 = '2026-09-10T09:15:02.000Z'

/** The D20 `SessionResponse` example: a finalized practice session. */
function sessionResponseExample() {
  return {
    id: UUID_1,
    programId: UUID_2,
    slotId: null,
    revisionId: UUID_3,
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'finalized',
    targetSeconds: 900,
    startedAt: ISO_1,
    endedAt: ISO_2,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-10',
    intendedOutput: 'Draft the outline',
    timeSource: 'measured',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 3,
    serverNow: ISO_3,
    timing: {
      elapsedSeconds: 900,
      remainingSeconds: 0,
      deadlineReached: true,
      isPaused: false,
    },
    tallies: { offTask: 1, external: 0, agentChecks: 0 },
    eventCount: 1,
    events: [
      {
        id: UUID_4,
        clientEventId: UUID_4,
        type: 'off_task',
        elapsedMs: 120000,
        occurredAt: ISO_1,
        receivedAt: ISO_1,
        details: {},
        voidedAt: null,
      },
    ],
    review: {
      sessionId: UUID_1,
      episodeCount: 1,
      countMethod: 'event',
      firstSwitch: { kind: 'known', seconds: 120 },
      firstSwitchMethod: 'event',
      externalCount: 0,
      unplannedAgentChecks: 0,
      mindWanderingCount: null,
      outputQuality: 'yes',
      outputNote: 'Finished the draft',
      reviewNote: null,
      materiallyDisrupted: null,
      disruptionNote: null,
      recallPoints: null,
      recallStartedAt: null,
      recallLockedAt: null,
      recallDelaySeconds: null,
      recallDurationSeconds: null,
      recallFlags: [],
      recallScores: null,
      recallScore: null,
      conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
      finalizedAt: ISO_2,
      version: 2,
    },
    agentPlan: null,
    amendments: [],
  }
}

describe('contracts/sessions', () => {
  it('CreateSessionBody: intendedOutput "" rejected, 201 chars rejected, 200 accepted', () => {
    const base = { programId: UUID_1, kind: 'practice' as const }
    expect(Value.Check(CreateSessionBody, { ...base, intendedOutput: '' })).toBe(false)
    expect(Value.Check(CreateSessionBody, { ...base, intendedOutput: 'x'.repeat(201) })).toBe(
      false,
    )
    expect(Value.Check(CreateSessionBody, { ...base, intendedOutput: 'x'.repeat(200) })).toBe(
      true,
    )
  })

  it('CreateSessionBody.targetSeconds: 420 rejected, 1800 rejected, 300 and 1500 accepted (D30)', () => {
    const base = { programId: UUID_1, kind: 'practice' as const }
    expect(Value.Check(CreateSessionBody, { ...base, targetSeconds: 420 })).toBe(false)
    expect(Value.Check(CreateSessionBody, { ...base, targetSeconds: 1800 })).toBe(false)
    expect(Value.Check(CreateSessionBody, { ...base, targetSeconds: 300 })).toBe(true)
    expect(Value.Check(CreateSessionBody, { ...base, targetSeconds: 1500 })).toBe(true)
  })

  it('EventsBatchBody: 101 events rejected, 100 accepted, 0 rejected', () => {
    const event = {
      clientEventId: UUID_1,
      type: 'off_task',
      elapsedMs: 0,
      occurredAt: ISO_1,
    }
    expect(Value.Check(EventsBatchBody, { events: Array(101).fill(event) })).toBe(false)
    expect(Value.Check(EventsBatchBody, { events: Array(100).fill(event) })).toBe(true)
    expect(Value.Check(EventsBatchBody, { events: [] })).toBe(false)
  })

  it('clock_gap event: details {gapSeconds: 300} without resolution valid; with resolution "continued" valid; resolution "ignored" invalid; gapSeconds schema-optional (domain-required, task 5.3.1); off_task with details {alsoOffTask: true} valid (D26)', () => {
    const clockGapEvent = (details: unknown) => ({
      clientEventId: UUID_1,
      type: 'clock_gap',
      elapsedMs: 0,
      occurredAt: ISO_1,
      details,
    })
    expect(Value.Check(EventInput, clockGapEvent({ gapSeconds: 300 }))).toBe(true)
    expect(
      Value.Check(EventInput, clockGapEvent({ gapSeconds: 300, resolution: 'continued' })),
    ).toBe(true)
    expect(
      Value.Check(EventInput, clockGapEvent({ gapSeconds: 300, resolution: 'ignored' })),
    ).toBe(false)
    // `gapSeconds` is schema-OPTIONAL here (task 5.3.1): whether a `clock_gap`
    // event must actually carry one is a domain rule the events route
    // enforces as a 422 naming the clientEventId, the same way
    // `alsoOffTask` stays schema-optional below while `agent_check` requires
    // it as a domain check, not a JSON-shape one.
    expect(Value.Check(EventInput, clockGapEvent({}))).toBe(true)
    expect(
      Value.Check(EventInput, {
        clientEventId: UUID_1,
        type: 'off_task',
        elapsedMs: 0,
        occurredAt: ISO_1,
        details: { alsoOffTask: true },
      }),
    ).toBe(true)
  })

  it('FinalizeBody review: episodeCount null accepted, absent accepted, "4" rejected, -1 rejected; reviewNote null and 2000 chars accepted, 2001 rejected (D31)', () => {
    const finalize = (review: Record<string, unknown>) => ({ expectedEventCount: 0, review })
    expect(Value.Check(FinalizeBody, finalize({ episodeCount: null }))).toBe(true)
    expect(Value.Check(FinalizeBody, finalize({}))).toBe(true)
    expect(Value.Check(FinalizeBody, finalize({ episodeCount: '4' }))).toBe(false)
    expect(Value.Check(FinalizeBody, finalize({ episodeCount: -1 }))).toBe(false)
    expect(Value.Check(FinalizeBody, finalize({ reviewNote: null }))).toBe(true)
    expect(Value.Check(FinalizeBody, finalize({ reviewNote: 'x'.repeat(2000) }))).toBe(true)
    expect(Value.Check(FinalizeBody, finalize({ reviewNote: 'x'.repeat(2001) }))).toBe(false)
  })

  it('FinalizeBody rejects `eligible`, `exclusionReasons`, `recallScore` and `points` keys (server-derived or locked)', () => {
    const finalize = (review: Record<string, unknown>) => ({ expectedEventCount: 0, review })
    expect(Value.Check(FinalizeBody, finalize({ eligible: true }))).toBe(false)
    expect(Value.Check(FinalizeBody, finalize({ exclusionReasons: [] }))).toBe(false)
    expect(Value.Check(FinalizeBody, finalize({ recallScore: 3 }))).toBe(false)
    expect(Value.Check(FinalizeBody, finalize({ points: ['a', 'b', 'c', 'd', 'e'] }))).toBe(false)
    expect(Value.Check(ReviewInputSchema, {})).toBe(true)
  })

  it('recallScores: [1,1,null,0,1] accepted; 4 entries rejected; a value of 2 rejected', () => {
    expect(Value.Check(ReviewInputSchema, { recallScores: [1, 1, null, 0, 1] })).toBe(true)
    expect(Value.Check(ReviewInputSchema, { recallScores: [1, 1, 0, 1] })).toBe(false)
    expect(Value.Check(ReviewInputSchema, { recallScores: [1, 1, 2, 0, 1] })).toBe(false)
  })

  it('RecallBody with 4 points rejected, 5 with two blanks accepted', () => {
    const base = { startedAt: ISO_1, durationSeconds: 30 }
    expect(Value.Check(RecallBody, { ...base, points: ['a', 'b', 'c', 'd'] })).toBe(false)
    expect(Value.Check(RecallBody, { ...base, points: ['a', 'b', '', 'd', ''] })).toBe(true)
  })

  it('TransitionBody: reason absent accepted, "planned_break" accepted, type "finalize" rejected (D29)', () => {
    expect(Value.Check(TransitionBody, { expectedVersion: 1, type: 'pause' })).toBe(true)
    expect(
      Value.Check(TransitionBody, { expectedVersion: 1, type: 'pause', reason: 'planned_break' }),
    ).toBe(true)
    expect(Value.Check(TransitionBody, { expectedVersion: 1, type: 'finalize' })).toBe(false)
  })

  it('ClockGapBody resolution "ignored" rejected, gapSeconds -1 rejected', () => {
    expect(Value.Check(ClockGapBody, { gapSeconds: 60, resolution: 'ignored' })).toBe(false)
    expect(Value.Check(ClockGapBody, { gapSeconds: -1, resolution: 'continued' })).toBe(false)
    expect(Value.Check(ClockGapBody, { gapSeconds: 60, resolution: 'continued' })).toBe(true)
  })

  it('FirstSwitchSchema: {kind:"unknown"} valid, {kind:"known"} without seconds invalid, {kind:"none_capped", seconds: 5} invalid; ReviewResponse.firstSwitch null valid', () => {
    expect(Value.Check(FirstSwitchSchema, { kind: 'unknown' })).toBe(true)
    expect(Value.Check(FirstSwitchSchema, { kind: 'known' })).toBe(false)
    expect(Value.Check(FirstSwitchSchema, { kind: 'none_capped', seconds: 5 })).toBe(false)
    const review = { ...sessionResponseExample().review, firstSwitch: null }
    expect(Value.Check(ReviewResponse, review)).toBe(true)
  })

  it('SessionResponse: the D20 example validates; tallies rejects an extra `total` key; timing without deadlineReached rejected; events entry with voidedAt null valid; agentPlan null valid; FinalizeResponse.eligible null valid', () => {
    const example = sessionResponseExample()
    expect(Value.Check(SessionResponse, example)).toBe(true)

    expect(
      Value.Check(SessionResponse, {
        ...example,
        tallies: { ...example.tallies, total: 1 },
      }),
    ).toBe(false)

    const timingWithoutDeadlineReached: Record<string, unknown> = { ...example.timing }
    delete timingWithoutDeadlineReached['deadlineReached']
    expect(
      Value.Check(SessionResponse, { ...example, timing: timingWithoutDeadlineReached }),
    ).toBe(false)

    expect(Value.Check(EventResponse, example.events[0])).toBe(true)
    expect(example.events[0]?.voidedAt).toBeNull()

    expect(Value.Check(AgentPlanResponse, example.agentPlan)).toBe(false) // null is not an AgentPlanResponse itself
    expect(example.agentPlan).toBeNull()
    expect(Value.Check(SessionResponse, { ...example, agentPlan: null })).toBe(true)

    expect(
      Value.Check(FinalizeResponse, {
        session: example,
        review: example.review,
        eligible: null,
        exclusionReasons: [],
      }),
    ).toBe(true)
  })
})
