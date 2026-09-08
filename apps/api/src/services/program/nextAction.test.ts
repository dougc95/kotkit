/**
 * 4.2.2 — unit tests for `deriveNextAction`: Today's single `nextAction`
 * from program status, program day and benchmark-slot/practice-block state.
 * Pure — no database. Covered by API integration in 4.2.3 and 4.5.3 (this
 * task has no integration suite of its own).
 */
import { describe, expect, it } from 'vitest'
import type { ProgramStatus } from '@attention-lab/shared'

import type { Block } from './blocks.js'
import { deriveNextAction, type DeriveNextActionInput, type SlotState } from './nextAction.js'

function program(status: ProgramStatus): DeriveNextActionInput['program'] {
  return { status }
}

function slot(overrides: Partial<SlotState> & Pick<SlotState, 'id' | 'phase' | 'label'>): SlotState {
  return { hasFinalizedAttempt: false, ...overrides }
}

function block(index: 1 | 2, status: Block['status'], sessionId: string | null = null): Block {
  return { index, status, targetSeconds: 600, sessionId }
}

const NOT_STARTED_BLOCKS: [Block, Block] = [block(1, 'not_started'), block(2, 'not_started')]

const baselineA = (overrides: Partial<SlotState> = {}) =>
  slot({ id: 'slot-baseline-a', phase: 'baseline', label: 'A', ...overrides })
const baselineB = (overrides: Partial<SlotState> = {}) =>
  slot({ id: 'slot-baseline-b', phase: 'baseline', label: 'B', ...overrides })
const finalA = (overrides: Partial<SlotState> = {}) =>
  slot({ id: 'slot-final-a', phase: 'final', label: 'A', ...overrides })
const finalB = (overrides: Partial<SlotState> = {}) =>
  slot({ id: 'slot-final-b', phase: 'final', label: 'B', ...overrides })
const midpoint = (overrides: Partial<SlotState> = {}) =>
  slot({ id: 'slot-midpoint-a', phase: 'midpoint', label: 'A', ...overrides })

const bothBaselinesFinalized = [
  baselineA({ hasFinalizedAttempt: true }),
  baselineB({ hasFinalizedAttempt: true }),
]
const bothFinalsFinalized = [finalA({ hasFinalizedAttempt: true }), finalB({ hasFinalizedAttempt: true })]

describe('deriveNextAction', () => {
  it('(1) null program -> setup', () => {
    expect(
      deriveNextAction({ program: null, day: 0, slots: [], blocks: NOT_STARTED_BLOCKS }),
    ).toEqual({ kind: 'setup' })
  })

  it('(2) archived -> setup', () => {
    expect(
      deriveNextAction({
        program: program('archived'),
        day: 5,
        slots: [baselineA(), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'setup' })
  })

  it('(3) completed -> setup', () => {
    expect(
      deriveNextAction({
        program: program('completed'),
        day: 20,
        slots: [...bothBaselinesFinalized, ...bothFinalsFinalized],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'setup' })
  })

  it('(4) draft -> readiness', () => {
    expect(
      deriveNextAction({
        program: program('draft'),
        day: 0,
        slots: [],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'readiness' })
  })

  it("(5) baseline_ready day 0, both baselines pending -> benchmark with slot A's id", () => {
    expect(
      deriveNextAction({
        program: program('baseline_ready'),
        day: 0,
        slots: [baselineA(), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-a' })
  })

  it('(6) A finalized -> benchmark B', () => {
    expect(
      deriveNextAction({
        program: program('baseline_ready'),
        day: 0,
        slots: [baselineA({ hasFinalizedAttempt: true }), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-b' })
  })

  it('(7) A abandoned only -> benchmark A (no finalized attempt)', () => {
    expect(
      deriveNextAction({
        program: program('baseline_ready'),
        day: 0,
        // An abandoned attempt never sets hasFinalizedAttempt: A is still pending.
        slots: [baselineA({ hasFinalizedAttempt: false }), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-a' })
  })

  it('(8) day -2 -> benchmark A (a slot before its date is still the next action)', () => {
    expect(
      deriveNextAction({
        program: program('baseline_ready'),
        day: -2,
        slots: [baselineA(), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-a' })
  })

  it('(9) day 0 both baselines finalized -> practice block 1', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 0,
        slots: bothBaselinesFinalized,
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'practice', block: 1 })
  })

  it('(10) day 4 blocks [completed, not_started] -> practice 2', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 4,
        slots: bothBaselinesFinalized,
        blocks: [block(1, 'completed', 's1'), block(2, 'not_started')],
      }),
    ).toEqual({ kind: 'practice', block: 2 })
  })

  it('(11) day 4 [in_progress, not_started] -> practice 1', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 4,
        slots: bothBaselinesFinalized,
        blocks: [block(1, 'in_progress', 's1'), block(2, 'not_started')],
      }),
    ).toEqual({ kind: 'practice', block: 1 })
  })

  it('(12) day 4 [partial, not_started] -> practice 2 (the next block remains available after an early finish)', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 4,
        slots: bothBaselinesFinalized,
        blocks: [block(1, 'partial', 's1'), block(2, 'not_started')],
      }),
    ).toEqual({ kind: 'practice', block: 2 })
  })

  it('(13) day 6 no sessions -> practice 1', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 6,
        slots: bothBaselinesFinalized,
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'practice', block: 1 })
  })

  it('(14) day 1 with baseline B pending -> benchmark B', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 1,
        slots: [baselineA({ hasFinalizedAttempt: true }), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-b' })
  })

  it('(15) day 13 with baseline B pending -> benchmark B', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 13,
        slots: [baselineA({ hasFinalizedAttempt: true }), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-b' })
  })

  it('(16) day 14 baselines done, finals pending -> final A', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 14,
        slots: [...bothBaselinesFinalized, finalA(), finalB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'final', slotId: 'slot-final-a' })
  })

  it('(17) day 14 final A finalized -> final B', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 14,
        slots: [...bothBaselinesFinalized, finalA({ hasFinalizedAttempt: true }), finalB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'final', slotId: 'slot-final-b' })
  })

  it('(18) day 14 both finals finalized -> progress', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 14,
        slots: [...bothBaselinesFinalized, ...bothFinalsFinalized],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'progress' })
  })

  it('(19) day 15 with final B pending -> final B (D23)', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 15,
        slots: [...bothBaselinesFinalized, finalA({ hasFinalizedAttempt: true }), finalB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'final', slotId: 'slot-final-b' })
  })

  it('(20) pending midpoint on day 7 -> practice, never a midpoint action', () => {
    const result = deriveNextAction({
      program: program('active'),
      day: 7,
      slots: [...bothBaselinesFinalized, midpoint({ hasFinalizedAttempt: false })],
      blocks: NOT_STARTED_BLOCKS,
    })
    expect(result.kind).toBe('practice')
    expect(result).toEqual({ kind: 'practice', block: 1 })
  })

  it('(21) day 14 with baseline B AND finals pending -> final A (finals govern Day 14 and after)', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 14,
        slots: [baselineA({ hasFinalizedAttempt: true }), baselineB(), finalA(), finalB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'final', slotId: 'slot-final-a' })
  })

  it('(22) day 4 [completed, completed] -> practice 2', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 4,
        slots: bothBaselinesFinalized,
        blocks: [block(1, 'completed', 's1'), block(2, 'completed', 's2')],
      }),
    ).toEqual({ kind: 'practice', block: 2 })
  })

  it("(23) status 'active' with both baselines pending on day 3 -> benchmark A (status does not override slot state)", () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 3,
        slots: [baselineA(), baselineB()],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'benchmark', slotId: 'slot-baseline-a' })
  })

  it('(24) day 20 both finals finalized, baseline B pending -> progress', () => {
    expect(
      deriveNextAction({
        program: program('active'),
        day: 20,
        slots: [baselineA({ hasFinalizedAttempt: true }), baselineB(), ...bothFinalsFinalized],
        blocks: NOT_STARTED_BLOCKS,
      }),
    ).toEqual({ kind: 'progress' })
  })

  it('(25) a benchmark or final result has exactly the keys kind and slotId', () => {
    const benchmarkResult = deriveNextAction({
      program: program('baseline_ready'),
      day: 0,
      slots: [baselineA(), baselineB()],
      blocks: NOT_STARTED_BLOCKS,
    })
    expect(Object.keys(benchmarkResult).sort()).toEqual(['kind', 'slotId'])

    const finalResult = deriveNextAction({
      program: program('active'),
      day: 14,
      slots: [...bothBaselinesFinalized, finalA(), finalB()],
      blocks: NOT_STARTED_BLOCKS,
    })
    expect(Object.keys(finalResult).sort()).toEqual(['kind', 'slotId'])
  })
})
