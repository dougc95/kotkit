import { useRef } from 'react'
import { AlertDialog } from 'radix-ui'
import { useBlocker } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { queryKeys } from '../lib/query/keys.js'
import { isActiveLifecycle } from '../lib/query/sessionMode.js'
import { Button } from '../ui/Button.js'

/**
 * Route-leave guard (task 7.4.3; design.md D38; specs/app-shell: "Navigation
 * exists outside session mode only" / "Leaving a session by URL";
 * specs/session-recovery: "Abandon and save-incomplete are always
 * available"). Mounted once in Root.tsx, inside `SessionModeProvider`
 * (7.4.2) and above both layouts, so it can block navigation away from any
 * session route regardless of which layout is currently rendering.
 *
 * A session route is one whose pathname starts with `/benchmark/`, `/focus/`
 * or `/review/` — router.tsx's `sessionRoutes` table, read literally.
 * Blocking only when the CURRENT location is a session path (not the next
 * one) gives two things for free, with no extra state:
 *
 *  - focus -> review and recall -> scoring proceed unblocked, since both
 *    locations are session paths.
 *  - once the user has chosen "Leave anyway", the current location is no
 *    longer a session path, so no later navigation re-prompts them.
 *
 * The guard makes no API call of any kind — no transition, no abandon, no
 * event post — so the server-side session is completely unaffected by the
 * navigation; only the router's own in-memory blocked/unblocked state
 * changes. There is deliberately no `beforeunload` handler: leaving via the
 * browser itself (close tab, hard reload, back to another origin) is
 * permitted, and reload recovery is 7.3.2/7.4.2's job, not this component's.
 */
const SESSION_PATH_PREFIXES = ['/benchmark/', '/focus/', '/review/'] as const

export function isSessionPath(pathname: string): boolean {
  return SESSION_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function SessionLeaveGuard() {
  const queryClient = useQueryClient()

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Read the query cache directly, synchronously, at the exact moment
    // React Router evaluates this navigation attempt — NOT a React-rendered
    // `isActive` value from `useSessionMode()`. A caller that just called
    // `queryClient.setQueryData(queryKeys.sessions.active, ...)` in the same
    // tick as `navigate(...)` (finalize, abandon) has already updated the
    // cache by the time this predicate runs, but React's own re-render of
    // this component (which `useSessionMode()` depends on) is batched
    // asynchronously and is NOT guaranteed to have committed yet — reading
    // the cache directly sidesteps that race entirely.
    const activeSession = queryClient.getQueryData<SessionResponseValue | null>(queryKeys.sessions.active) ?? null
    const isActive = isActiveLifecycle(activeSession)
    return isActive && isSessionPath(currentLocation.pathname) && !isSessionPath(nextLocation.pathname)
  })

  const isBlocked = blocker.state === 'blocked'

  // Wraps the two actions; `onOpenAutoFocus` below focuses whichever
  // <button> is first inside it (Return to session) once the dialog mounts,
  // so Radix's focus trap (react-focus-scope) has a real element inside the
  // scope to track and restore focus to — without this, a dialog that opens
  // while focus is on the trigger the user just clicked never gets an
  // element inside the trap to fall back on, and Tab can escape it.
  const actionsRef = useRef<HTMLDivElement | null>(null)

  return (
    <AlertDialog.Root
      open={isBlocked}
      onOpenChange={(nextOpen) => {
        // The only way `onOpenChange(false)` fires here is Escape —
        // AlertDialogContent already prevents outside-pointer/interact
        // dismissal, and both buttons below call `blocker.reset()` /
        // `blocker.proceed()` directly rather than going through Radix's
        // Close/Cancel/Action primitives, so no click ever reaches this
        // handler. "Escape behaves as Return" (D38).
        if (!nextOpen && blocker.state === 'blocked') {
          blocker.reset()
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            actionsRef.current?.querySelector('button')?.focus()
          }}
        >
          <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
            A session is in progress
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
            Your session keeps running on the server. Leaving this page does not end or change it.
          </AlertDialog.Description>
          <div ref={actionsRef} className="mt-6 flex justify-end gap-3">
            <Button
              variant="primary"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.reset()
                }
              }}
            >
              Return to session
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed()
                }
              }}
            >
              Leave anyway
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
