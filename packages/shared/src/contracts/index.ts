/**
 * Contract barrel: every route-group schema and `Static<>` type in one
 * place, plus `REQUEST_BODY_SCHEMAS` — a registry of every request body
 * this change defines, one valid example each.
 *
 * `REQUEST_BODY_SCHEMAS` exists so `test/contracts/realm.test.ts` (2.7.6)
 * can prove two invariants no individual schema file proves on its own:
 *   - no request body accepts a caller-supplied `realm` or `userId` at any
 *     depth (identity-realm: "Every user-owned record carries a realm" /
 *     "Client cannot choose the realm" — the realm is always stamped by the
 *     API from the identity plugin, never read from the wire);
 *   - every object schema reachable from a request body, and from every
 *     response schema, is closed (`additionalProperties: false`) — the
 *     single exception, by design, is `ErrorResponse.details` (D18).
 *
 * `POST /demo/scenarios/{name}/load` takes no body (D22: the UI confirms
 * before calling it), so it has no entry here.
 *
 * See design.md D18–D22.
 */
import type { TSchema } from '@sinclair/typebox'

export * from './common.js'
export * from './me.js'
export * from './demo.js'
export * from './programs.js'
export * from './sessions.js'
export * from './days.js'
export * from './report.js'
export * from './research.js'

import { PutDayBody } from './days.js'
import { DemoClockBody } from './demo.js'
import { PatchPreferencesBody } from './me.js'
import { CreateProgramBody, CreateRevisionBody, PatchProgramBody, PutSlotsBody } from './programs.js'
import {
  AgentPlanBody,
  AmendmentBody,
  ClockGapBody,
  CreateSessionBody,
  EventsBatchBody,
  FinalizeBody,
  RecallBody,
  TransitionBody,
} from './sessions.js'

/** One request-body schema plus a value that passes it, for realm.test.ts's walk. */
export interface RequestBodySchemaEntry {
  readonly schema: TSchema
  readonly example: unknown
}

const UUID_EXAMPLE = '123e4567-e89b-12d3-a456-426614174000'
const ISO_EXAMPLE = '2026-09-10T09:00:00.000Z'

/**
 * Every request body this change defines (15 entries — scenario load has no
 * body per D22). Each example is a value the paired schema accepts as-is;
 * `test/contracts/realm.test.ts` checks the example still passes, and that
 * the example plus a `realm` or `userId` key does not.
 */
export const REQUEST_BODY_SCHEMAS: Record<string, RequestBodySchemaEntry> = {
  PatchPreferences: {
    schema: PatchPreferencesBody,
    example: {
      timezone: 'Europe/Madrid',
      hideTimerDefault: false,
      endChime: true,
      visibilityContext: false,
      milestoneAnnouncements: false,
    },
  },
  DemoClock: {
    schema: DemoClockBody,
    example: { offsetSeconds: 0 },
  },
  CreateProgram: {
    schema: CreateProgramBody,
    example: {
      baselineDate: '2026-09-06',
      timezone: 'Europe/Madrid',
      practiceTargetSeconds: 600,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
  },
  PatchProgram: {
    schema: PatchProgramBody,
    example: { expectedVersion: 1, status: 'completed' },
  },
  PutSlots: {
    schema: PutSlotsBody,
    example: {
      expectedVersion: 1,
      slots: [
        { phase: 'baseline', label: 'A', materialRef: 'Chapter 3', plannedLocalTime: '09:00' },
      ],
    },
  },
  CreateRevision: {
    schema: CreateRevisionBody,
    example: {
      effectiveDay: 4,
      settings: { practiceTargetSeconds: 900 },
      reason: 'progression accepted',
    },
  },
  CreateSession: {
    schema: CreateSessionBody,
    example: { programId: UUID_EXAMPLE, kind: 'practice', intendedOutput: 'Draft the outline' },
  },
  EventsBatch: {
    schema: EventsBatchBody,
    example: {
      events: [
        { clientEventId: UUID_EXAMPLE, type: 'off_task', elapsedMs: 1000, occurredAt: ISO_EXAMPLE },
      ],
    },
  },
  Transition: {
    schema: TransitionBody,
    example: { expectedVersion: 1, type: 'pause', reason: 'planned_break' },
  },
  ClockGap: {
    schema: ClockGapBody,
    example: { gapSeconds: 300, resolution: 'continued' },
  },
  AgentPlan: {
    schema: AgentPlanBody,
    example: {
      // 0: `agent_plans` has no row until this first PUT creates one
      // (task 5.6.1; same "0 means create" convention as `PutDay`'s own
      // example above).
      expectedVersion: 0,
      workstream: 'Write the report',
      waitingTask: 'Agent PR review',
      reviewCheckpoint: 'end_of_block',
      resumeNote: 'Pick up at section 3',
    },
  },
  Recall: {
    schema: RecallBody,
    example: {
      points: ['point one', 'point two', '', 'point four', ''],
      startedAt: ISO_EXAMPLE,
      durationSeconds: 90,
    },
  },
  Finalize: {
    schema: FinalizeBody,
    example: {
      expectedEventCount: 1,
      review: { episodeCount: 2, countMethod: 'event', materiallyDisrupted: false },
    },
  },
  Amendment: {
    schema: AmendmentBody,
    example: { reason: 'Forgot to log an interruption', excludeFromReport: false },
  },
  PutDay: {
    schema: PutDayBody,
    example: {
      expectedVersion: 0,
      sleepMinutes: 420,
      feed: [
        { device: 'phone', platform: 'all', minutes: 15, measurementScope: 'feed', source: 'estimate' },
      ],
    },
  },
}
