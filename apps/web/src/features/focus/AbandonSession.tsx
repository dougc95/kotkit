/**
 * The shared "Abandon session" control (task 8.10.7; design.md D38;
 * specs/session-recovery: "Abandon and save-incomplete are always
 * available", "Recovery buffer is bounded and purged", "Stale writes
 * conflict instead of overwriting" / "Two tabs end a session";
 * specs/app-shell: "One dominant action per screen").
 *
 * Mounted once by SessionLayout (7.1.4) for every session-mode route —
 * `/benchmark/:slotId`, `/benchmark/:sessionId/recall`,
 * `/benchmark/:sessionId/scoring`, `/focus/:sessionId`, `/review/:sessionId`
 * — so Focus, a running benchmark, recall, scoring and review all get this
 * control without any of those screens importing or rendering it
 * themselves. SessionLayout is on this task's never-edit list, so the exact
 * mounting edit (reading `['sessions','active']` via `useActiveSession` and
 * passing it down) is reported as a centralWiringNeeded item rather than
 * applied here.
 *
 * Renders nothing (`null`) unless `session.lifecycle` is one a user can
 * still abandon — `running`, `paused`, `awaiting_review`, the exact set
 * `GET /sessions/active` itself returns (apps/api's `ACTIVE_LIFECYCLES`) —
 * so a `finalized` or `abandoned` session (should one ever reach this
 * component, e.g. a stale prop mid-transition) offers nothing here. A
 * visually subordinate `quiet`-variant trigger: this is never the one
 * dominant action a session screen offers.
 */
import { useEffect, useId, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useAbandonSession } from './useAbandonSession.js'

const ABANDONABLE_LIFECYCLES: ReadonlySet<SessionResponseValue['lifecycle']> = new Set([
  'running',
  'paused',
  'awaiting_review',
])

const REASON_MAX_LENGTH = 100

/** Best-effort removal, mirroring 7.3.5's own `clearStoredKey`: storage being unavailable never blocks navigating away. */
function clearFinalizeKey(sessionId: string): void {
  try {
    sessionStorage.removeItem(`finalize:${sessionId}`)
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

export interface AbandonSessionProps {
  readonly session: SessionResponseValue
}

export function AbandonSession({ session }: AbandonSessionProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { abandon, status } = useAbandonSession(session.id)
  const reasonInputId = useId()

  const isPending = status === 'pending'
  const { id: sessionId, programId, version: expectedVersion } = session

  // Success side effects run once per successful abandon, not inline during
  // render (D38 / D16: navigation and cache invalidation are effects, not
  // render output). Once this fires, `/today` replaces the session route,
  // which unmounts this component along with every in-memory form draft the
  // session route was holding.
  useEffect(() => {
    if (status !== 'success') {
      return
    }
    clearFinalizeKey(sessionId)
    // Written synchronously, before navigating: `SessionLeaveGuard`'s
    // `useBlocker` predicate reads `isActive` from this same query
    // (`useSessionMode`) at the exact instant `navigate()` below runs. A
    // fire-and-forget `invalidateQueries` alone leaves the STALE
    // (still-abandonable) session in that cache until its async refetch
    // resolves, so the guard's "A session is in progress" dialog would
    // intercept this very navigation — mirrors `useStartSession`'s own
    // `setQueryData(queryKeys.sessions.active, ...)` precedent.
    queryClient.setQueryData(queryKeys.sessions.active, null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
    void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(programId) })
    navigate('/today', { state: { notice: 'Session abandoned.' } })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session is not needed as a whole; its stable id/programId fields are already listed.
  }, [status, sessionId, programId, queryClient, navigate])

  if (!ABANDONABLE_LIFECYCLES.has(session.lifecycle)) {
    return null
  }

  function handleOpenChange(nextOpen: boolean) {
    // Ignore an attempted close while a request is in flight (mirrors
    // SessionLeaveGuard's own controlled-dialog pattern).
    if (isPending) {
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setReason('')
    }
  }

  async function handleConfirm() {
    await abandon(expectedVersion, reason)
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Trigger className="fixed bottom-4 right-4 z-40 inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-xs font-medium text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-[var(--color-surface)]">
        Abandon session
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
          <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
            Abandon this session?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
            Unsent entries on this device will be discarded; the attempt stays in your record as abandoned.
          </AlertDialog.Description>

          <div className="mt-4 space-y-1">
            <label htmlFor={reasonInputId} className="block text-sm font-medium text-[var(--color-text)]">
              Reason (optional)
            </label>
            <input
              id={reasonInputId}
              type="text"
              value={reason}
              maxLength={REASON_MAX_LENGTH}
              disabled={isPending}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {status === 'stale' ? (
            <p role="status" className="mt-3 text-sm text-[var(--color-text-muted)]">
              This session was updated in another tab
            </p>
          ) : null}
          {status === 'error' ? (
            <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
              Could not abandon. Retry.
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" disabled={isPending} onClick={() => handleOpenChange(false)}>
              Keep session
            </Button>
            <Button variant="primary" disabled={isPending} onClick={handleConfirm}>
              Abandon
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
