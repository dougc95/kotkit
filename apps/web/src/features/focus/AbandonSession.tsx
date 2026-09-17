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
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
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
  const reasonField = useField({ name: 'abandon-reason' })

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
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="quiet" className="fixed bottom-4 right-4 z-40 border border-rule bg-paper">
          Abandon session
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Abandon this session?</AlertDialogTitle>
        <AlertDialogDescription>
          Unsent entries on this device will be discarded; the attempt stays in your record as abandoned.
        </AlertDialogDescription>

        <div className="mt-4 space-y-1">
          <Label {...reasonField.labelProps}>Reason (optional)</Label>
          <Input
            {...reasonField.controlProps}
            type="text"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            disabled={isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {status === 'stale' ? (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            This session was updated in another tab
          </p>
        ) : null}
        {status === 'error' ? (
          <p role="alert" className="mt-3 text-sm text-attention">
            Could not abandon. Retry.
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={isPending} onClick={() => handleOpenChange(false)}>
            Keep session
          </Button>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={handleConfirm}
            className="border-destructive text-destructive hover:bg-destructive/10"
          >
            Abandon
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
