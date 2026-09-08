/**
 * The click surface for `useSessionEvents` (task 8.5.1; design.md D11;
 * specs/practice-sessions: "Interruption events with undo and subtypes";
 * specs/benchmark-assessment: "Interruption recording during the
 * benchmark"). Purely presentational — every click calls the `onRecord`/
 * `onUndo` callbacks a screen (Focus 8.5.3, Benchmark Running 8.3.3) wires
 * to its own `useSessionEvents(sessionId, session)` instance; this
 * component never calls the hook itself.
 *
 * `variant: 'practice'` renders 'Record off-task episode' (the single
 * primary control, app-shell: "One dominant action per screen"), 'External
 * interruption', 'Agent check' and 'Undo' (all secondary). `variant:
 * 'benchmark'` renders the same set MINUS 'Agent check' — a benchmark
 * attempt has no agent-waiting concept.
 *
 * 'Agent check' opens `AgentCheckConfirm` inline (not a modal) in its own
 * place; confirming calls `onRecord('agent_check', { alsoOffTask })` and
 * closes it, cancelling closes it without recording anything — "one click =
 * one event" holds for the confirm button too (a cancelled confirm never
 * calls `onRecord`).
 */
import { useId, useState } from 'react'
import { Button } from '../../ui/Button.js'

export type EventButtonsVariant = 'practice' | 'benchmark'

export interface AgentCheckDetails {
  readonly alsoOffTask: boolean
}

export interface AgentCheckConfirmProps {
  onConfirm(alsoOffTask: boolean): void
  onCancel(): void
}

/** The inline confirm `EventButtons` opens for its 'Agent check' control. */
export function AgentCheckConfirm({ onConfirm, onCancel }: AgentCheckConfirmProps) {
  const checkboxId = useId()
  const [alsoOffTask, setAlsoOffTask] = useState(false)

  return (
    <div role="group" aria-label="Confirm agent check" className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
      <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={alsoOffTask}
          onChange={(event) => setAlsoOffTask(event.target.checked)}
        />
        This was also an off-task episode
      </label>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => onConfirm(alsoOffTask)}>
          Log agent check
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export interface EventButtonsProps {
  /** Not rendered anywhere — accepted so a future id-scoping need (an
   * `aria-describedby` target, say) has it on hand without a signature
   * change; see `_debug`-free callers in 8.5.3/8.3.3 for how it is used. */
  readonly sessionId: string
  readonly variant: EventButtonsVariant
  onRecord(type: 'off_task' | 'external' | 'agent_check', details?: AgentCheckDetails): void
  onUndo(): void
  readonly canUndo: boolean
}

export function EventButtons({ variant, onRecord, onUndo, canUndo }: EventButtonsProps) {
  const [agentCheckOpen, setAgentCheckOpen] = useState(false)

  return (
    <div role="group" aria-label="Session events" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onRecord('off_task')}>
          Record off-task episode
        </Button>
        <Button variant="secondary" onClick={() => onRecord('external')}>
          External interruption
        </Button>
        {variant === 'practice' && !agentCheckOpen && (
          <Button variant="secondary" onClick={() => setAgentCheckOpen(true)}>
            Agent check
          </Button>
        )}
        <Button variant="secondary" onClick={onUndo} disabled={!canUndo}>
          Undo
        </Button>
      </div>
      {variant === 'practice' && agentCheckOpen && (
        <AgentCheckConfirm
          onConfirm={(alsoOffTask) => {
            onRecord('agent_check', { alsoOffTask })
            setAgentCheckOpen(false)
          }}
          onCancel={() => setAgentCheckOpen(false)}
        />
      )}
    </div>
  )
}
