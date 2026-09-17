import { Link } from 'react-router'
import type { NextActionValue, SlotResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'

export interface NextActionProps {
  readonly nextAction: NextActionValue
  /**
   * Accepted for parity with the other Today slots (BlockCard, CheckinCard)
   * and for a future caller that needs to scope a link or an analytics call
   * to the program — no branch below needs it today since every href is
   * either fixed or already carries the slot id it needs.
   */
  readonly programId: string
  readonly slots: readonly SlotResponseValue[]
  /**
   * practice-sessions: "Today shows one next action and two blocks" — a
   * `practice` next action does not navigate anywhere; it focuses the next
   * block's own start form (BlockCard, task 8.2.2) so the returning-user
   * path stays "type, Start" (two actions, task 8.2.2's brief) rather than
   * a click-through. Today (this task) is the only caller and owns turning
   * this into an actual DOM focus.
   */
  readonly onFocusBlock: (block: 1 | 2) => void
}

function slotLabel(slots: readonly SlotResponseValue[], slotId: string): string {
  return slots.find((slot) => slot.id === slotId)?.label ?? ''
}

/**
 * Today's single next action (task 8.2.1; practice-sessions spec, "Today
 * shows one next action and two blocks"). Exactly one primary control is
 * rendered per `nextAction.kind` — never more than one, and never zero for
 * a known kind (`noFallthroughCasesInSwitch` plus the exhaustive switch
 * below is what enforces that at compile time).
 *
 * `benchmark` and `final` share the same destination shape
 * (`/benchmark/:slotId`) but different copy: the fixed "Start with your
 * baseline" for every baseline slot (design.md's Setup flow / the
 * practice-sessions "empty state" requirement use this exact string) versus
 * "Final benchmark {label}" for a final slot, where `{label}` (`A`/`B`)
 * comes from `slots` — `nextAction` itself carries only `{ kind, slotId }`
 * (D22's decomposition note), never the label.
 */
export function NextAction({ nextAction, slots, onFocusBlock }: NextActionProps) {
  switch (nextAction.kind) {
    case 'setup':
      return (
        <Button asChild variant="primary">
          <Link to="/setup">Set up your program</Link>
        </Button>
      )

    case 'readiness':
      return (
        <Button asChild variant="primary">
          <Link to="/setup/readiness">Finish readiness</Link>
        </Button>
      )

    case 'benchmark':
      return (
        <Button asChild variant="primary">
          <Link to={`/benchmark/${nextAction.slotId}`}>Start with your baseline</Link>
        </Button>
      )

    case 'practice':
      return (
        <Button
          variant="quiet"
          className="self-start"
          onClick={() => {
            onFocusBlock(nextAction.block)
          }}
        >
          {`Block ${nextAction.block} is next`}
        </Button>
      )

    case 'final':
      return (
        <Button asChild variant="primary">
          <Link to={`/benchmark/${nextAction.slotId}`}>{`Final benchmark ${slotLabel(slots, nextAction.slotId)}`}</Link>
        </Button>
      )

    case 'progress':
      return (
        <Button asChild variant="primary">
          <Link to="/progress">View your progress</Link>
        </Button>
      )
  }
}
