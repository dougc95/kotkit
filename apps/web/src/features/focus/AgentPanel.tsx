/**
 * AgentPanel — the collapsed "Waiting on an agent?" plan editor and the
 * screen-free break control on Focus (task 8.5.5; design.md D16, D18, D19,
 * D20, D29; specs/practice-sessions: "Optional agent waiting plan" / "Save a
 * plan mid-session", "Stale plan write"; "Pause and resume are explicit" /
 * "Planned break"; "Practice requires a short intended output";
 * specs/session-recovery: "Stale writes conflict instead of overwriting").
 *
 * Mounted from Focus.tsx (8.5.3, an earlier wave) as a sibling to
 * TransitionControls (8.5.4) below TimerDisplay — see this task's own
 * `centralWiringNeeded` report for the exact slot edit; this file does NOT
 * edit Focus.tsx itself. Its own test file mounts AgentPanel directly, and
 * for the screen-free-break case alongside TransitionControls sharing the
 * SAME `useSession` query the real Focus.tsx will — never the real Focus
 * screen (the file-ownership rule this task's own brief repeats).
 *
 * Radix `Collapsible`, closed by default behind a "Waiting on an agent?"
 * trigger — `Collapsible.Content` (and every field/action inside it) is not
 * present in the DOM at all until opened, mirroring CheckinForm's own "More
 * detail" (8.7.1). `PlanFields` (workstream, "Useful task while waiting", a
 * review-checkpoint `Select` defaulting to — and, per the 2.7 contract,
 * currently the only possible value — 'end_of_block', and a resume note) are
 * all optional, each capped at exactly the `AgentPlanBody` (2.7) contract's
 * own per-field `maxLength` via the native HTML `maxLength` attribute
 * (workstream/waitingTask 200, resumeNote 500) — never a looser or tighter
 * client limit than the API already enforces. No field here is ever named or
 * labelled with credentials, agent outputs or logs (specs/practice-sessions:
 * "no agent credentials, outputs or logs").
 *
 * 'Save plan' -> `PUT /sessions/{id}/agent-plan {expectedVersion, workstream,
 * waitingTask, reviewCheckpoint, resumeNote}`. `expectedVersion` is read from
 * this component's OWN "last known plan" state — seeded from the `plan` prop
 * on mount, then advanced by every successful or stale response its own
 * mutation receives — never a stale closed-over prop, so a second Save after
 * a first succeeds carries the version that write just returned.
 * `agent_plans` has no row until the first PUT creates it, so a session with
 * no plan yet sends `expectedVersion: 0` (2.7's "0 means create" contract,
 * the same one `PutDayBody` already establishes for its own lazily-created
 * row).
 *
 * 409 `stale_version` (D18: `details.current` is the OTHER tab's now-current
 * plan, or `null` when no row exists at all) replaces the draft with THAT
 * plan's values, shows "Another tab saved a newer plan", and disables the
 * fields until "Reload" is clicked — unlike CheckinForm's own stale handling
 * (8.7.1's "Re-apply my values"), this panel never offers a way to re-assert
 * the user's own conflicting edit over the plan that already won: the first
 * write is what's kept, and no second write is ever sent to overwrite it
 * silently. Any other rejection shows "Could not save. Retry." and keeps the
 * typed draft (a 422 `practice_only` is never reachable here — this panel is
 * never mounted from Benchmark Running).
 *
 * 'Return to my task' just collapses the panel (`Collapsible.Root`'s own
 * `open` state) — no request, no navigation, no transition.
 *
 * 'Take a screen-free break' calls the SAME shared `useTransition(sessionId)`
 * hook `TransitionControls` (8.5.4) exports, with `{ expectedVersion:
 * sessionVersion, type: 'pause', reason: 'planned break' }` (D29: `reason`
 * is stored only on a `pause` transition). That hook's own `onSuccess`
 * writes the fresh session straight into the shared `['sessions', id]` query
 * cache and invalidates it — the SAME cache entry Focus.tsx's `useQuery`
 * (and any sibling `TransitionControls`) reads, so "Focus shows Paused and
 * Resume" is a consequence of that shared cache, not anything this
 * component renders itself; this component renders no Paused/Resume label
 * of its own. Only offered while `lifecycle === 'running'` (pausing an
 * already-paused session is meaningless and TransitionControls already owns
 * Resume for that state).
 *
 * Renders nothing once the session has ended (`finalized`/`abandoned`): the
 * plan is "editable during the session" (practice-sessions spec) only.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Collapsible, Select } from 'radix-ui'
import type { AgentPlanBodyValue, AgentPlanResponseValue, SessionLifecycle } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useTransition } from './TransitionControls.js'

const GENERIC_ERROR_MESSAGE = 'Could not save. Retry.'
const STALE_MESSAGE = 'Another tab saved a newer plan'

const WORKSTREAM_MAX_LENGTH = 200
const WAITING_TASK_MAX_LENGTH = 200
const RESUME_NOTE_MAX_LENGTH = 500

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors TransitionControls.tsx/Focus.tsx/Recall.tsx/
// AbandonSession.tsx: the real `api` client throws typed `ApiError`
// subclasses, but `mockClient.ts`'s `reject()` (every component test in this
// codebase) only builds a plain `Error` with the same shape, which
// `instanceof` would miss.
// ---------------------------------------------------------------------------

interface KnownApiError {
  readonly status: number
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

function asKnownApiError(error: unknown): KnownApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const record = error as Record<string, unknown>
  if (typeof record.status !== 'number' || typeof record.code !== 'string' || typeof record.message !== 'string') {
    return null
  }
  return record as unknown as KnownApiError
}

/**
 * Minimal duck-typed check that `details.current` (D18) looks like an
 * `AgentPlanResponseValue` before trusting it. Returns `null` for both "no
 * row exists" (the service's own explicit `current: null`, task 5.6.1's
 * `decideAgentPlanWrite`) and a malformed/absent envelope — either way there
 * is no known prior plan to show.
 */
function extractStalePlan(details: Record<string, unknown> | undefined): AgentPlanResponseValue | null {
  const current = details?.['current']
  if (typeof current !== 'object' || current === null) {
    return null
  }
  const record = current as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || typeof record.version !== 'number') {
    return null
  }
  return current as AgentPlanResponseValue
}

// ---------------------------------------------------------------------------
// PlanFields — the four plan inputs, fully controlled.
// ---------------------------------------------------------------------------

export interface PlanDraftValue {
  readonly workstream: string
  readonly waitingTask: string
  readonly reviewCheckpoint: 'end_of_block'
  readonly resumeNote: string
}

/** A blank draft reflects `plan === null`; the checkpoint always defaults to `end_of_block` — the only value the 2.7 contract currently accepts. */
export function draftFromPlan(plan: AgentPlanResponseValue | null): PlanDraftValue {
  return {
    workstream: plan?.workstream ?? '',
    waitingTask: plan?.waitingTask ?? '',
    reviewCheckpoint: plan?.reviewCheckpoint ?? 'end_of_block',
    resumeNote: plan?.resumeNote ?? '',
  }
}

export interface PlanFieldsProps {
  readonly value: PlanDraftValue
  readonly onChange: (value: PlanDraftValue) => void
  readonly disabled?: boolean
}

export function PlanFields({ value, onChange, disabled = false }: PlanFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="agent-plan-workstream" className="text-sm font-medium text-[var(--color-text)]">
          Workstream
        </label>
        <input
          id="agent-plan-workstream"
          type="text"
          value={value.workstream}
          maxLength={WORKSTREAM_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, workstream: event.target.value })}
          className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)] disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text-muted)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="agent-plan-waiting-task" className="text-sm font-medium text-[var(--color-text)]">
          Useful task while waiting
        </label>
        <input
          id="agent-plan-waiting-task"
          type="text"
          value={value.waitingTask}
          maxLength={WAITING_TASK_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, waitingTask: event.target.value })}
          className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)] disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text-muted)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="agent-plan-checkpoint" className="text-sm font-medium text-[var(--color-text)]">
          Next review checkpoint
        </label>
        <Select.Root
          value={value.reviewCheckpoint}
          onValueChange={(next) => onChange({ ...value, reviewCheckpoint: next as 'end_of_block' })}
          disabled={disabled}
        >
          <Select.Trigger
            id="agent-plan-checkpoint"
            className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text-muted)]"
          >
            <Select.Value />
            <Select.Icon aria-hidden="true">▾</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] shadow-lg"
            >
              <Select.Viewport className="p-1">
                <Select.Item
                  value="end_of_block"
                  className="cursor-pointer rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface)]"
                >
                  <Select.ItemText>End of this block</Select.ItemText>
                </Select.Item>
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="agent-plan-resume-note" className="text-sm font-medium text-[var(--color-text)]">
          Resume note
        </label>
        <textarea
          id="agent-plan-resume-note"
          value={value.resumeNote}
          maxLength={RESUME_NOTE_MAX_LENGTH}
          rows={3}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, resumeNote: event.target.value })}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text-muted)]"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AgentPanel
// ---------------------------------------------------------------------------

const NON_EDITABLE_LIFECYCLES: readonly SessionLifecycle[] = ['finalized', 'abandoned']

export interface AgentPanelProps {
  readonly sessionId: string
  readonly sessionVersion: number
  readonly plan: AgentPlanResponseValue | null
  readonly lifecycle: SessionLifecycle
}

export function AgentPanel({ sessionId, sessionVersion, plan, lifecycle }: AgentPanelProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [knownPlan, setKnownPlan] = useState<AgentPlanResponseValue | null>(plan)
  const [draft, setDraft] = useState<PlanDraftValue>(() => draftFromPlan(plan))
  const [staleNotice, setStaleNotice] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const { status: breakStatus, message: breakMessage, transition } = useTransition(sessionId)

  const saveMutation = useMutation<AgentPlanResponseValue, unknown, AgentPlanBodyValue>({
    mutationFn: (body) => api.sessions.putAgentPlan(sessionId, body),
    onSuccess: (savedPlan) => {
      setKnownPlan(savedPlan)
      setDraft(draftFromPlan(savedPlan))
      setStaleNotice(false)
      setSaveMessage(null)
      // The 8.5.3/8.5.4 own `['sessions', id]` cache entry also carries
      // `agentPlan` (D20) — refreshing it keeps any other subscriber (a
      // second open tab's own Focus) showing the plan this write just saved.
      // Never disturbs D5's own derivation: none of `useRemaining`'s inputs
      // (startedAt/targetSeconds/pausedSeconds/currentPauseStartedAt/
      // lifecycle/serverNow) are touched by this route (5.6.1's own header
      // comment: "the focus_sessions row itself is never written here").
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId) })
    },
    onError: (error) => {
      const known = asKnownApiError(error)

      if (known !== null && known.status === 409 && known.code === 'stale_version') {
        // Keep the write that already won — never resend on top of it.
        const current = extractStalePlan(known.details)
        setKnownPlan(current)
        setDraft(draftFromPlan(current))
        setStaleNotice(true)
        setSaveMessage(null)
        return
      }

      setSaveMessage(known !== null && known.status === 422 ? known.message : GENERIC_ERROR_MESSAGE)
    },
  })

  if (NON_EDITABLE_LIFECYCLES.includes(lifecycle)) {
    return null
  }

  function handleSave(): void {
    setSaveMessage(null)
    saveMutation.mutate({
      expectedVersion: knownPlan?.version ?? 0,
      workstream: draft.workstream,
      waitingTask: draft.waitingTask,
      reviewCheckpoint: draft.reviewCheckpoint,
      resumeNote: draft.resumeNote,
    })
  }

  function handleReload(): void {
    // The draft/knownPlan already reflect the server's winning write (set
    // the moment the 409 arrived) — Reload only lifts the lock that keeps
    // the fields/Save disabled while the notice is up.
    setStaleNotice(false)
  }

  function handleScreenFreeBreak(): void {
    transition({ expectedVersion: sessionVersion, type: 'pause', reason: 'planned break' })
  }

  const fieldsLocked = staleNotice || saveMutation.isPending

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <Collapsible.Trigger
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-transparent px-4 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
      >
        Waiting on an agent?
      </Collapsible.Trigger>

      <Collapsible.Content className="flex flex-col gap-4 pt-1">
        <PlanFields value={draft} onChange={setDraft} disabled={fieldsLocked} />

        {staleNotice ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-[var(--color-text-muted)]">
              {STALE_MESSAGE}
            </p>
            <Button variant="secondary" onClick={handleReload}>
              Reload
            </Button>
          </div>
        ) : null}

        {saveMessage !== null ? (
          <p role="alert" className="text-sm text-[var(--color-text-muted)]">
            {saveMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={fieldsLocked} onClick={handleSave}>
            Save plan
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Return to my task
          </Button>
          {lifecycle === 'running' ? (
            <Button variant="secondary" disabled={breakStatus === 'pending'} onClick={handleScreenFreeBreak}>
              Take a screen-free break
            </Button>
          ) : null}
        </div>

        {breakMessage !== null ? (
          <p role="alert" className="text-sm text-[var(--color-text-muted)]">
            {breakMessage}
          </p>
        ) : null}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
