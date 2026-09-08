/**
 * `TransitionControls` — Focus's pause/resume and finish-early controls,
 * plus the shared `useTransition(sessionId)` mutation hook this module
 * exports for reuse (task 8.5.4; design.md D5, D16, D18, D19, D20, D24,
 * D29, D38; specs/practice-sessions: "Pause and resume are explicit",
 * "Pause and resume are explicit" / "Paused seconds excluded",
 * "Session review saves honest outcomes" / "Early finish"; specs/app-shell:
 * "One dominant action per screen" / "Focus screen actions", "Navigation
 * exists outside session mode only" / "Navigation hidden during practice";
 * specs/session-recovery: "Stale writes conflict instead of overwriting" /
 * "Two tabs end a session").
 *
 * Meant to be mounted into Focus (8.5.3) at the `TODO(8.5.4)` slot Focus.tsx
 * already left below `TimerDisplay` — this file does NOT edit Focus.tsx
 * itself (see this task's own `centralWiringNeeded` report); its test file
 * mounts this component (and `useTransition`) directly against a small
 * self-contained harness, never the real `Focus` screen.
 *
 * Renders `null` unless `session.lifecycle` is `running` or `paused` (Focus
 * already replaces this whole area with its own deadline-reached copy once
 * the countdown hits zero, and `awaiting_review`/`finalized`/`abandoned`
 * offer nothing here either — mirrors `AbandonSession.tsx`'s own lifecycle
 * gate). No Abandon control exists here: Abandon is the shared
 * `AbandonSession` (8.10.7), mounted once by `SessionLayout` for every
 * session route.
 *
 * 'Pause' (secondary) -> `POST /sessions/{id}/transitions
 * {expectedVersion, type:'pause'}`. 'Resume' (secondary, shown in place of
 * 'Pause' once `session.lifecycle === 'paused'`) -> `type:'resume'`. Both
 * carry no `reason` — D29 stores `reason` only on a `pause` transition and
 * this control never asks for one; the sibling `AgentPanel` (8.5.5, a later
 * wave, extending this same file) is the one caller that DOES pass
 * `reason: 'planned break'` through `useTransition`. 'Finish early'
 * (secondary trigger, Radix `AlertDialog` confirm) -> `type:'end'`, available
 * while running OR paused; on success this component navigates to
 * `/review/:sessionId` itself (mirrors Focus's own deadline-reached 'Review'
 * action, D24) — no wiring is needed elsewhere for that.
 *
 * Every transition carries `session.version` as `expectedVersion` (read
 * fresh at click time from the `session` prop, never cached in a ref — the
 * same pattern `Focus.tsx`'s own `handleReview` and `AbandonSession.tsx`
 * use). `useTransition`'s mutation:
 *  - `onMutate` (pause only): snapshots the current `['sessions', id]`
 *    cache entry and optimistically overlays `lifecycle: 'paused'`,
 *    `currentPauseStartedAt: previous.serverNow` — freezing
 *    `useRemaining`'s derived countdown for every subscriber of that query
 *    key (D5's `deriveRemaining` treats "paused since serverNow" as zero
 *    elapsed since the freeze) without needing a fresh wall-clock read (the
 *    authoritative server response overwrites this within moments anyway).
 *    A non-`pause` transition takes no optimistic branch.
 *  - `onError`, 409 `stale_version` (D18/D19): writes `details.current`
 *    into `['sessions', id]` (so any other subscriber — Focus's own query,
 *    once wired — sees the real current session too), invalidates that key,
 *    and this component renders `ActiveSessionCard` (8.2.5) with
 *    `staleNotice` — using its OWN `currentSession` state (not a re-passed
 *    prop) so it renders correctly even in complete isolation from a parent
 *    that happens not to re-subscribe. No second transition is ever sent
 *    for a stale response.
 *  - `onError`, any other rejection: rolls the optimistic freeze back to the
 *    snapshotted `previous` session and shows a message — the server's own
 *    `error.message` for a 422, or a generic "Could not save. Retry." for a
 *    network/server failure (D18: `details` never carries note text, so 422
 *    copy always comes from `message`).
 *  - `onSuccess`: writes the fresh session into `['sessions', id]` and
 *    invalidates BOTH that key and `['sessions','active']` (matches
 *    `Focus.tsx`'s own two-key invalidation).
 *
 * 'Record off-task episode' (`EventButtons`, 8.5.1) remains the single
 * primary control on this screen; every control here is `variant="secondary"`
 * in its steady (un-opened) state — the in-dialog 'Finish now' confirm is
 * primary-styled the same way `AbandonSession`'s own in-dialog confirm is,
 * since a transient confirmation dialog is not "the screen" the one-primary
 * rule is about.
 */
import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AlertDialog } from 'radix-ui'
import type { SessionResponseValue, TransitionBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'

const GENERIC_ERROR_MESSAGE = 'Could not save. Retry.'

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors Focus.tsx/Recall.tsx/AbandonSession.tsx: the
// real `api` client throws typed `ApiError` subclasses, but `mockClient.ts`'s
// `reject()` (every component test in this codebase) only builds a plain
// `Error` with the same shape, which `instanceof` would miss.
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

/** Minimal duck-typed check that `details.current` (D18) looks like a `SessionResponseValue` before trusting it. */
function extractCurrentSession(details: Record<string, unknown> | undefined): SessionResponseValue | null {
  const current = details?.['current']
  if (typeof current !== 'object' || current === null) {
    return null
  }
  const record = current as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.lifecycle !== 'string' || typeof record.version !== 'number') {
    return null
  }
  return current as SessionResponseValue
}

// ---------------------------------------------------------------------------
// useTransition — shared by TransitionControls and (8.5.5, a later wave)
// AgentPanel's 'Take a screen-free break'.
// ---------------------------------------------------------------------------

export type TransitionStatus = 'idle' | 'pending' | 'success' | 'stale' | 'error'

export interface TransitionSuccessCallbacks {
  onSuccess?: (session: SessionResponseValue) => void
}

export interface UseTransitionResult {
  readonly status: TransitionStatus
  /** The server's 422 message, or a generic retry message for any other non-stale failure. `null` outside `status === 'error'`. */
  readonly message: string | null
  /** Populated only once `status === 'stale'`, from the 409's `details.current` (D18) — the session to hand `ActiveSessionCard`. */
  readonly currentSession: SessionResponseValue | null
  transition(body: TransitionBodyValue, callbacks?: TransitionSuccessCallbacks): void
}

interface MutationContext {
  readonly previous: SessionResponseValue | undefined
}

export function useTransition(sessionId: string): UseTransitionResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<TransitionStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [currentSession, setCurrentSession] = useState<SessionResponseValue | null>(null)

  const key = queryKeys.sessions.byId(sessionId)

  const mutation = useMutation<SessionResponseValue, unknown, TransitionBodyValue, MutationContext>({
    mutationFn: (body) => api.sessions.transition(sessionId, body),
    onMutate: async (body) => {
      setStatus('pending')
      setMessage(null)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<SessionResponseValue>(key)
      if (body.type === 'pause' && previous !== undefined && previous.lifecycle === 'running') {
        // D5: freezing at "paused since the last known server instant" needs
        // no fresh wall-clock read — the authoritative response overwrites
        // this within moments regardless.
        queryClient.setQueryData<SessionResponseValue>(key, {
          ...previous,
          lifecycle: 'paused',
          currentPauseStartedAt: previous.serverNow,
        })
      }
      return { previous }
    },
    onSuccess: (session) => {
      queryClient.setQueryData(key, session)
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
      setStatus('success')
    },
    onError: (error, _body, context) => {
      const known = asKnownApiError(error)

      if (known !== null && known.status === 409 && known.code === 'stale_version') {
        const current = extractCurrentSession(known.details)
        if (current !== null) {
          queryClient.setQueryData(key, current)
          setCurrentSession(current)
        }
        void queryClient.invalidateQueries({ queryKey: key })
        setStatus('stale')
        return
      }

      // Roll back the optimistic pause freeze (a no-op if no optimistic
      // write happened for this transition).
      if (context !== undefined && context.previous !== undefined) {
        queryClient.setQueryData(key, context.previous)
      }

      setMessage(known !== null && known.status === 422 ? known.message : GENERIC_ERROR_MESSAGE)
      setStatus('error')
    },
  })

  const transition = useCallback(
    (body: TransitionBodyValue, callbacks?: TransitionSuccessCallbacks): void => {
      mutation.mutate(body, callbacks?.onSuccess !== undefined ? { onSuccess: callbacks.onSuccess } : undefined)
    },
    [mutation],
  )

  return { status, message, currentSession, transition }
}

// ---------------------------------------------------------------------------
// TransitionControls
// ---------------------------------------------------------------------------

export interface TransitionControlsProps {
  readonly session: SessionResponseValue
  /**
   * Optional: called with the fresh session after any successful transition
   * this control posts. The shared query cache (`useTransition`'s own
   * `onSuccess`) already keeps every `['sessions', id]` subscriber in sync
   * — Focus's own `session` prop updates on its own once wired — so most
   * callers can omit this.
   */
  readonly onTransition?: (session: SessionResponseValue) => void
}

const DIALOG_OVERLAY_CLASSES = 'fixed inset-0 z-50 bg-black/40'
const DIALOG_CONTENT_CLASSES =
  'fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg'

export function TransitionControls({ session, onTransition }: TransitionControlsProps) {
  const navigate = useNavigate()
  const { status, message, currentSession, transition } = useTransition(session.id)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Radix's `AlertDialog.Content` is documented to auto-focus its first
  // tabbable child on open, but does not do so here in practice (confirmed
  // empirically against the real, built app: the dialog's own DOM — both
  // buttons present, neither disabled — is correct, yet keyboard focus
  // simply stays on the "Finish early" trigger indefinitely; a manual
  // `.focus()` call on "Keep going" works immediately once called). A
  // `useEffect` keyed on `confirmOpen` is NOT the right tool here either
  // (confirmed empirically, a second real bug): `AlertDialog.Content`
  // portals its children, so on the render where `confirmOpen` first flips
  // true, the effect can run before "Keep going"'s own DOM node exists —
  // `keepGoingRef.current` reads `null` right when the effect fires. A
  // callback ref sidesteps both problems: React calls it exactly when the
  // node attaches (mount) or detaches (unmount), never early, regardless of
  // portal timing or Radix's own (non-firing) auto-focus — and a stable
  // (`useCallback`, no deps) identity means it is NOT re-invoked on every
  // unrelated re-render while the dialog stays open, so it never steals
  // focus back from wherever the user has since tabbed to.
  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])

  if (status === 'stale') {
    return <ActiveSessionCard session={currentSession ?? session} staleNotice />
  }

  if (session.lifecycle !== 'running' && session.lifecycle !== 'paused') {
    return null
  }

  const isPending = status === 'pending'

  function handlePause(): void {
    transition(
      { expectedVersion: session.version, type: 'pause' },
      { onSuccess: (fresh) => onTransition?.(fresh) },
    )
  }

  function handleResume(): void {
    transition(
      { expectedVersion: session.version, type: 'resume' },
      { onSuccess: (fresh) => onTransition?.(fresh) },
    )
  }

  function handleDialogOpenChange(open: boolean): void {
    if (isPending) {
      return
    }
    setConfirmOpen(open)
  }

  function handleFinishConfirm(): void {
    transition(
      { expectedVersion: session.version, type: 'end' },
      {
        onSuccess: (fresh) => {
          setConfirmOpen(false)
          onTransition?.(fresh)
          navigate(`/review/${fresh.id}`)
        },
      },
    )
  }

  return (
    <div role="group" aria-label="Pause and finish controls" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {session.lifecycle === 'paused' ? (
          <>
            <p role="status" className="text-sm text-[var(--color-text-muted)]">
              Paused
            </p>
            <Button variant="secondary" disabled={isPending} onClick={handleResume}>
              Resume
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={isPending} onClick={handlePause}>
            Pause
          </Button>
        )}

        <AlertDialog.Root open={confirmOpen} onOpenChange={handleDialogOpenChange}>
          <AlertDialog.Trigger asChild>
            <Button variant="secondary" disabled={isPending}>
              Finish early
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className={DIALOG_OVERLAY_CLASSES} />
            <AlertDialog.Content className={DIALOG_CONTENT_CLASSES}>
              <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
                Finish this block early?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
                Your recorded time and events stay saved; you&apos;ll review what you completed next.
              </AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  ref={focusOnMount}
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Keep going
                </Button>
                <Button variant="primary" disabled={isPending} onClick={handleFinishConfirm}>
                  Finish now
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>

      {message !== null ? (
        <p role="alert" className="text-sm text-[var(--color-text-muted)]">
          {message}
        </p>
      ) : null}
    </div>
  )
}
