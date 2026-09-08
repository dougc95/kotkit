/**
 * Test-only fixture builder for a full D20 `SessionResponseValue` — used by
 * this unit's own tests (policy/hooks/sessionMode) so each one only spells
 * out the field(s) it actually varies (usually just `lifecycle`/`id`).
 * Not part of the 7.1.1 shared harness (`src/test/*`): scoped to `lib/query`
 * because no other unit needs a full session fixture at this layer.
 */
import type { SessionResponseValue } from '@attention-lab/shared'

export function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return {
    id: 'session-1',
    programId: 'program-1',
    slotId: null,
    revisionId: 'revision-1',
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds: 900,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-08',
    intendedOutput: null,
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: '2026-09-08T09:00:00.000Z',
    timing: {
      elapsedSeconds: 0,
      remainingSeconds: 900,
      deadlineReached: false,
      isPaused: false,
    },
    tallies: {
      offTask: 0,
      external: 0,
      agentChecks: 0,
    },
    eventCount: 0,
    events: [],
    review: {
      sessionId: 'session-1',
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
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
      conditions: {
        deviceFormat: null,
        language: null,
        materialLevel: null,
        accommodations: [],
      },
      finalizedAt: null,
      version: 1,
    },
    agentPlan: null,
    amendments: [],
    ...overrides,
  }
}
