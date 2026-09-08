import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import {
  CreateProgramBody,
  CreateRevisionBody,
  CurrentProgramResponse,
  NextActionSchema,
  PatchProgramBody,
  PutSlotsBody,
  PutSlotsResponse,
  TodayResponse,
} from '../../src/contracts/programs.js'

const UUID_A = '123e4567-e89b-12d3-a456-426614174000'
const UUID_B = '223e4567-e89b-12d3-a456-426614174000'

function baseProgram() {
  return {
    id: UUID_A,
    realm: 'demo',
    status: 'active',
    baselineDate: '2026-09-06',
    timezone: 'Europe/Madrid',
    leisureAllowanceMinutes: 20,
    feedEstimateMinutes: null,
    currentRevisionId: UUID_B,
    version: 1,
  }
}

function baseSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_A,
    phase: 'baseline',
    label: 'A',
    materialRef: 'Chapter 3',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: '09:00',
    assignedLocalDate: '2026-09-06',
    frozenAt: null,
    attempts: [],
    ...overrides,
  }
}

describe('contracts/programs', () => {
  it('CreateProgramBody passes with feedEstimateMinutes absent and with null', () => {
    const base = { baselineDate: '2026-09-06', timezone: 'Europe/Madrid', practiceTargetSeconds: 600 }
    expect(Value.Check(CreateProgramBody, base)).toBe(true)
    expect(Value.Check(CreateProgramBody, { ...base, feedEstimateMinutes: null })).toBe(true)
    expect(Value.Check(CreateProgramBody, { ...base, feedEstimateMinutes: 30 })).toBe(true)
  })

  it('CreateProgramBody rejects practiceTargetSeconds 420 and rejects timezone ""', () => {
    expect(
      Value.Check(CreateProgramBody, {
        baselineDate: '2026-09-06',
        timezone: 'Europe/Madrid',
        practiceTargetSeconds: 420,
      }),
    ).toBe(false)
    expect(
      Value.Check(CreateProgramBody, {
        baselineDate: '2026-09-06',
        timezone: '',
        practiceTargetSeconds: 600,
      }),
    ).toBe(false)
  })

  it('CreateRevisionBody rejects reason "" and passes reason "progression accepted"; practiceTargetSeconds 1800 rejected', () => {
    const base = { effectiveDay: 4, settings: { practiceTargetSeconds: 900 }, reason: '' }
    expect(Value.Check(CreateRevisionBody, base)).toBe(false)
    expect(Value.Check(CreateRevisionBody, { ...base, reason: 'progression accepted' })).toBe(true)
    expect(
      Value.Check(CreateRevisionBody, {
        ...base,
        reason: 'progression accepted',
        settings: { practiceTargetSeconds: 1800 },
      }),
    ).toBe(false)
  })

  it('PutSlotsBody rejects plannedLocalTime "9am" and rejects a slot with an unknown key', () => {
    const goodSlot = { phase: 'baseline', label: 'A', materialRef: 'Chapter 3' }
    expect(Value.Check(PutSlotsBody, { expectedVersion: 1, slots: [goodSlot] })).toBe(true)
    expect(
      Value.Check(PutSlotsBody, {
        expectedVersion: 1,
        slots: [{ ...goodSlot, plannedLocalTime: '9am' }],
      }),
    ).toBe(false)
    expect(
      Value.Check(PutSlotsBody, {
        expectedVersion: 1,
        slots: [{ ...goodSlot, unknownKey: true }],
      }),
    ).toBe(false)
  })

  it('PatchProgramBody without expectedVersion fails; status "active" rejected, "completed" and "archived" accepted (D33)', () => {
    expect(Value.Check(PatchProgramBody, { status: 'completed' })).toBe(false)
    expect(Value.Check(PatchProgramBody, { expectedVersion: 2, status: 'active' })).toBe(false)
    expect(Value.Check(PatchProgramBody, { expectedVersion: 2, status: 'completed' })).toBe(true)
    expect(Value.Check(PatchProgramBody, { expectedVersion: 2, status: 'archived' })).toBe(true)
  })

  it('CurrentProgramResponse: the D22 no-program example validates; a slot with a finalized attempt validates; an attempt with eligible null validates', () => {
    const noProgram = {
      program: null,
      revision: null,
      slots: [],
      day: null,
      nextAction: { kind: 'setup' },
    }
    expect(Value.Check(CurrentProgramResponse, noProgram)).toBe(true)

    const withFinalizedAttempt = {
      program: baseProgram(),
      revision: null,
      slots: [
        baseSlot({
          attempts: [
            { sessionId: UUID_B, lifecycle: 'finalized', eligible: false, excludedByAmendment: true },
          ],
        }),
      ],
      day: 6,
      nextAction: { kind: 'progress' },
    }
    expect(Value.Check(CurrentProgramResponse, withFinalizedAttempt)).toBe(true)

    const withNullEligible = {
      ...withFinalizedAttempt,
      slots: [
        baseSlot({
          attempts: [
            { sessionId: UUID_B, lifecycle: 'running', eligible: null, excludedByAmendment: false },
          ],
        }),
      ],
    }
    expect(Value.Check(CurrentProgramResponse, withNullEligible)).toBe(true)
  })

  it('PutSlotsResponse with missing [{phase final, label B, fields [materialRef]}] validates', () => {
    const response = {
      program: baseProgram(),
      slots: [baseSlot()],
      missing: [{ phase: 'final', label: 'B', fields: ['materialRef'] }],
    }
    expect(Value.Check(PutSlotsResponse, response)).toBe(true)
  })

  it('TodayResponse rejects a third block and an unknown block status; accepts a suggestion with qualifiedOn; checkin.values with all three null validates and a checkin without values fails (D22)', () => {
    const block1 = { index: 1, status: 'completed', targetSeconds: 600, sessionId: UUID_B }
    const block2 = { index: 2, status: 'not_started', targetSeconds: 600, sessionId: null }
    const checkin = {
      status: 'not_reported',
      missing: ['sleep', 'feed'],
      values: { sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null },
    }
    const base = {
      day: 4,
      localDate: '2026-09-10',
      blocks: [block1, block2],
      checkin,
      nextAction: { kind: 'practice', block: 2 },
    }
    expect(Value.Check(TodayResponse, base)).toBe(true)

    expect(Value.Check(TodayResponse, { ...base, blocks: [block1, block2, block1] })).toBe(false)
    expect(
      Value.Check(TodayResponse, { ...base, blocks: [{ ...block1, status: 'unknown_status' }, block2] }),
    ).toBe(false)

    expect(
      Value.Check(TodayResponse, {
        ...base,
        suggestion: { suggestedTargetSeconds: 900, qualifiedOn: ['2026-09-08', '2026-09-09'] },
      }),
    ).toBe(true)

    const { values, ...checkinWithoutValues } = checkin
    void values
    expect(Value.Check(TodayResponse, { ...base, checkin: checkinWithoutValues })).toBe(false)
  })

  it('NextActionSchema: a final action with only kind and slotId validates; a benchmark action without slotId fails; extra slot fields on a final action fail (client reads them from slots[] instead)', () => {
    expect(Value.Check(NextActionSchema, { kind: 'final', slotId: UUID_A })).toBe(true)
    expect(Value.Check(NextActionSchema, { kind: 'benchmark' })).toBe(false)
    expect(
      Value.Check(NextActionSchema, {
        kind: 'final',
        slotId: UUID_A,
        phase: 'final',
        label: 'A',
        assignedLocalDate: '2026-09-20',
        plannedLocalTime: null,
      }),
    ).toBe(false)
  })
})
