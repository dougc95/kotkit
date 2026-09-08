/**
 * Task 4.2.2 — deriving Today's single `nextAction` from program state. Pure:
 * no database import, no route registration. `getCurrentProgram` /
 * `loadProgramSnapshot` (4.2.3) assembles this function's inputs from the
 * loaded program, its benchmark slots and `deriveBlocks`'s (4.2.1) output,
 * and uses the result directly as the response's `nextAction` field.
 *
 * `NextAction` here is the minimal shape this pure function can produce from
 * its inputs: for `benchmark` and `final` it carries only `slotId` — the
 * caller already has every slot's phase, label, assigned date and planned
 * time in `slots[]` (2.7.3's `SlotResponse`), so there is nothing this
 * function needs to duplicate onto the action itself; a `SlotState` here
 * carries only what deciding *which* slot is next requires (`phase`,
 * `label`, `hasFinalizedAttempt`), not the display fields a resolved slot
 * lookup already has.
 *
 * Rules, in order (design.md D23; `practice-sessions`: "Today shows one next
 * action and two blocks"; `program-setup`: "Readiness step assigns materials
 * and benchmark times"; `benchmark-assessment`: "Benchmark ready state" /
 * "Final benchmarks on Day 14" / "Eligibility is derived server-side with
 * explicit reasons"):
 *  1. `program` is `null`, or its status is `completed` | `archived` ->
 *     `{ kind: 'setup' }`.
 *  2. status `draft` -> `{ kind: 'readiness' }`.
 *  3. `day <= 13` and a pending baseline slot exists (no finalized attempt;
 *     an abandoned, running or awaiting-review attempt still leaves it
 *     pending) -> `{ kind: 'benchmark', slotId }`, A before B. This also
 *     holds before Day 0 — a slot before its assigned date is still the next
 *     action; start availability itself is a separate `before_slot_date`
 *     rule the Ready screen enforces (5.1.2), not this function. Program
 *     status never overrides slot state: an `active` program with a pending
 *     baseline still routes here.
 *  4. `day >= 14` and a pending final slot exists -> `{ kind: 'final',
 *     slotId }`, A before B (D23: a late final stays reachable from Today
 *     after Day 14).
 *  5. `day >= 14` otherwise -> `{ kind: 'progress' }`. A baseline still
 *     pending after Day 14 no longer drives the next action once every final
 *     slot has a finalized attempt.
 *  6. Otherwise (Day 0 with both baselines finalized; Days 1-13 with both
 *     baselines finalized) -> `{ kind: 'practice', block }`, `block` from
 *     `nextPracticeBlock`.
 *
 * A `midpoint` slot is never returned by any rule above — this function only
 * ever inspects `baseline` and `final` phases.
 */
import type { Block } from './blocks.js'
import type { BenchmarkPhase, ProgramStatus, SlotLabel } from '@attention-lab/shared'

/** The subset of a benchmark slot this function needs to pick the next one. */
export interface SlotState {
  readonly id: string
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly hasFinalizedAttempt: boolean
}

export type NextAction =
  | { readonly kind: 'setup' }
  | { readonly kind: 'readiness' }
  | { readonly kind: 'benchmark'; readonly slotId: string }
  | { readonly kind: 'practice'; readonly block: 1 | 2 }
  | { readonly kind: 'final'; readonly slotId: string }
  | { readonly kind: 'progress' }

export interface DeriveNextActionInput {
  readonly program: { readonly status: ProgramStatus } | null
  readonly day: number
  readonly slots: readonly SlotState[]
  readonly blocks: readonly [Block, Block]
}

const LABEL_ORDER: Record<SlotLabel, number> = { A: 0, B: 1 }

/**
 * The earliest (A before B) slot of `phase` with no finalized attempt, or
 * `undefined` when every slot of that phase already has one (or none exist).
 */
function pendingSlotForPhase(
  slots: readonly SlotState[],
  phase: BenchmarkPhase,
): SlotState | undefined {
  return slots
    .filter((slot) => slot.phase === phase && !slot.hasFinalizedAttempt)
    .slice()
    .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label])[0]
}

/**
 * Which practice block Today should point at: the first `in_progress` block,
 * else the first `not_started` block, else `2` — once both blocks are
 * finalized (`completed` or `partial`) there is no "next" block, and 2 is the
 * fixed fallback (Today shows both done).
 */
export function nextPracticeBlock(blocks: readonly [Block, Block]): 1 | 2 {
  const inProgress = blocks.find((block) => block.status === 'in_progress')
  if (inProgress !== undefined) return inProgress.index

  const notStarted = blocks.find((block) => block.status === 'not_started')
  if (notStarted !== undefined) return notStarted.index

  return 2
}

/** Pure: derives Today's single `nextAction` from program status, day and slot/block state. */
export function deriveNextAction(input: DeriveNextActionInput): NextAction {
  const { program, day, slots, blocks } = input

  if (program === null || program.status === 'completed' || program.status === 'archived') {
    return { kind: 'setup' }
  }
  if (program.status === 'draft') {
    return { kind: 'readiness' }
  }

  if (day <= 13) {
    const pendingBaseline = pendingSlotForPhase(slots, 'baseline')
    if (pendingBaseline !== undefined) {
      return { kind: 'benchmark', slotId: pendingBaseline.id }
    }
  }

  if (day >= 14) {
    const pendingFinal = pendingSlotForPhase(slots, 'final')
    if (pendingFinal !== undefined) {
      return { kind: 'final', slotId: pendingFinal.id }
    }
    return { kind: 'progress' }
  }

  return { kind: 'practice', block: nextPracticeBlock(blocks) }
}
