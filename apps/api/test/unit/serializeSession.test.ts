/**
 * 5.2.2 — unit tests for `serializeSession` (5.1.1, design.md D20). Pure — no
 * database, no Fastify. Builds minimal `FocusSessionRow` / `SessionReviewRow`
 * / `SessionEventRow` / `SessionAmendmentRow` fixtures directly rather than
 * inserting through drizzle, since `serializeSession` only ever reads plain
 * fields off whatever row shape it is handed. Covered end to end by API
 * integration in `test/sessions/read.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { SESSION_LIFECYCLES } from '@attention-lab/shared'

import {
  serializeSession,
  type FocusSessionRow,
  type SessionAmendmentRow,
  type SessionEventRow,
  type SessionReviewRow,
} from '../../src/services/sessionSerializer.js'

const NOW = new Date('2026-09-06T10:20:00.000Z')

function baseSession(overrides: Partial<FocusSessionRow> = {}): FocusSessionRow {
  return {
    id: 'session-1',
    userId: 'local-demo',
    programId: 'program-1',
    revisionId: 'revision-1',
    slotId: null,
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds: 600,
    startedAt: new Date('2026-09-06T10:00:00.000Z'),
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-06',
    intendedOutput: 'Draft the outline',
    timeSource: 'measured',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    ...overrides,
  } as FocusSessionRow
}

function baseReview(overrides: Partial<SessionReviewRow> = {}): SessionReviewRow {
  return {
    sessionId: 'session-1',
    episodeCount: null,
    countMethod: null,
    firstSwitchKind: null,
    firstSwitchSeconds: null,
    firstSwitchMethod: null,
    externalCount: null,
    unplannedAgentChecks: null,
    mindWanderingCount: null,
    outputQuality: null,
    outputNote: null,
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
    observedConditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    finalizedAt: null,
    version: 1,
    ...overrides,
  } as SessionReviewRow
}

function baseEvent(overrides: Partial<SessionEventRow> = {}): SessionEventRow {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    clientEventId: 'client-event-1',
    type: 'off_task',
    occurredAt: new Date('2026-09-06T10:05:00.000Z'),
    elapsedMs: 300000,
    receivedAt: new Date('2026-09-06T10:05:01.000Z'),
    details: {},
    voidedAt: null,
    ...overrides,
  } as SessionEventRow
}

function baseAmendment(overrides: Partial<SessionAmendmentRow> = {}): SessionAmendmentRow {
  return {
    id: 'amendment-1',
    sessionId: 'session-1',
    userId: 'local-demo',
    reason: 'Forgot to log an interruption',
    excludeFromReport: false,
    createdAt: new Date('2026-09-06T11:00:00.000Z'),
    ...overrides,
  } as SessionAmendmentRow
}

describe('serializeSession (5.2.2)', () => {
  it('ReportedCount null survives serialization as null (episodeCount, externalCount, unplannedAgentChecks, mindWanderingCount, recallScore)', () => {
    const result = serializeSession(baseSession(), baseReview(), [], null, [], NOW)

    expect(result.review.episodeCount).toBeNull()
    expect(result.review.externalCount).toBeNull()
    expect(result.review.unplannedAgentChecks).toBeNull()
    expect(result.review.mindWanderingCount).toBeNull()
    expect(result.review.recallScore).toBeNull()
  })

  it('voided events keep voidedAt', () => {
    const voidedAt = new Date('2026-09-06T10:06:00.000Z')
    const events = [baseEvent({ id: 'e1', clientEventId: 'c1', voidedAt })]

    const result = serializeSession(baseSession(), baseReview(), events, null, [], NOW)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.voidedAt).toBe(voidedAt.toISOString())
  })

  it('timing and tallies are present for every lifecycle value', () => {
    for (const lifecycle of SESSION_LIFECYCLES) {
      const session = baseSession({
        lifecycle,
        endedAt: lifecycle === 'finalized' || lifecycle === 'abandoned' ? new Date('2026-09-06T10:15:00.000Z') : null,
      })
      const result = serializeSession(session, baseReview(), [], null, [], NOW)

      expect(result.timing).toEqual({
        elapsedSeconds: expect.any(Number),
        remainingSeconds: expect.any(Number),
        deadlineReached: expect.any(Boolean),
        isPaused: expect.any(Boolean),
      })
      expect(result.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
    }
  })

  it('serverNow equals now.toISOString()', () => {
    const result = serializeSession(baseSession(), baseReview(), [], null, [], NOW)
    expect(result.serverNow).toBe(NOW.toISOString())
  })

  it('eventCount counts every stored row including voided ones and differs from tallies, which exclude voided rows', () => {
    const events = [
      baseEvent({ id: 'e1', clientEventId: 'c1', type: 'off_task', elapsedMs: 1000 }),
      baseEvent({
        id: 'e2',
        clientEventId: 'c2',
        type: 'off_task',
        elapsedMs: 2000,
        voidedAt: new Date('2026-09-06T10:07:00.000Z'),
      }),
    ]

    const result = serializeSession(baseSession(), baseReview(), events, null, [], NOW)

    expect(result.eventCount).toBe(2)
    expect(result.tallies.offTask).toBe(1)
    expect(result.eventCount).not.toBe(result.tallies.offTask)
  })

  it('amendments defaults to [] and passes seeded rows through unchanged', () => {
    const empty = serializeSession(baseSession(), baseReview(), [], null, [], NOW)
    expect(empty.amendments).toEqual([])

    const amendment = baseAmendment()
    const withAmendment = serializeSession(baseSession(), baseReview(), [], null, [amendment], NOW)
    expect(withAmendment.amendments).toEqual([
      {
        id: amendment.id,
        sessionId: amendment.sessionId,
        reason: amendment.reason,
        excludeFromReport: amendment.excludeFromReport,
        createdAt: amendment.createdAt.toISOString(),
      },
    ])
  })

  it('no key of the serialized object equals offTask + agentChecks or offTask + external, and no key is named like focusedSeconds or score (no invented aggregate; elapsed is never presented as focused time)', () => {
    const events = [
      baseEvent({ id: 'e1', clientEventId: 'c1', type: 'off_task', elapsedMs: 1000 }),
      baseEvent({
        id: 'e2',
        clientEventId: 'c2',
        type: 'agent_check',
        elapsedMs: 2000,
        details: { alsoOffTask: true },
      }),
      baseEvent({ id: 'e3', clientEventId: 'c3', type: 'external', elapsedMs: 3000 }),
    ]

    const result = serializeSession(baseSession(), baseReview(), events, null, [], NOW)

    // D11/D20: tallies is exactly these three keys — offTask and agentChecks
    // overlap by design, so summing them into a combined/total field would
    // double-count and is never done.
    expect(Object.keys(result.tallies).sort()).toEqual(['agentChecks', 'external', 'offTask'])
    expect(result.tallies).toEqual({ offTask: 2, external: 1, agentChecks: 1 })

    const forbiddenExactKeys = new Set([
      'total',
      'totalInterruptions',
      'combined',
      'attentionScore',
      'focusedSeconds',
      'score',
    ])

    function assertNoForbiddenKeys(value: unknown): void {
      if (value === null || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        expect(forbiddenExactKeys.has(key)).toBe(false)
        assertNoForbiddenKeys(nested)
      }
    }
    assertNoForbiddenKeys(result)

    // `timing.elapsedSeconds` is the only elapsed-time field this shape ever
    // carries — it is never relabeled as a "focused" measure, since elapsed
    // time and off-task time are not the same thing.
    expect(Object.keys(result.timing).sort()).toEqual([
      'deadlineReached',
      'elapsedSeconds',
      'isPaused',
      'remainingSeconds',
    ])
  })
})
