import { useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { purgeOtherSessions } from '../../lib/outbox/store.js'
import { Button } from '../../ui/Button.js'

const FINALIZE_KEY_PREFIX = 'finalize:'

/**
 * Best-effort removal of every `finalize:{sessionId}` sessionStorage key
 * (the key format `useFinalizeSession.ts`/7.3.5 owns) — not just the active
 * session's, every one a prior page life may have left behind. Storage
 * being unavailable never blocks the reset itself, mirroring
 * `AbandonSession.tsx`'s own `clearFinalizeKey`.
 */
function clearAllFinalizeKeys(): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key !== null && key.startsWith(FINALIZE_KEY_PREFIX)) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      sessionStorage.removeItem(key)
    }
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

/**
 * The reset section of `DemoControls` (task 8.9.3; identity-realm's "Reset
 * demo data": "all `demo` records for the principal are removed and Today
 * shows the new-user empty state"). `POST /demo/reset` (204) is followed by:
 * clearing the whole query cache (this task's own "State" note, so Today
 * really does refetch into the new-user empty state), purging EVERY
 * session's outbox rows (`purgeOtherSessions(null)`, 7.3.1 — unlike
 * `AbandonSession`'s single-session `purgeSession`, a reset invalidates
 * every session this device might have buffered, not just one), clearing
 * every `finalize:{sessionId}` sessionStorage key, then navigating to
 * `/today`.
 */
export function ResetPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const resetMutation = useMutation({
    mutationFn: () => api.demo.reset(),
    onSuccess: async () => {
      queryClient.clear()
      await purgeOtherSessions(null)
      clearAllFinalizeKeys()
      setOpen(false)
      navigate('/today')
    },
  })

  function handleOpenChange(next: boolean) {
    if (resetMutation.isPending) {
      return
    }
    setOpen(next)
  }

  function handleConfirm() {
    resetMutation.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Reset demo data</h3>

      <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
        <AlertDialog.Trigger asChild>
          <Button variant="secondary">Reset demo data</Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
            <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
              Reset all demonstration data?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
              This replaces all demonstration data for this profile
            </AlertDialog.Description>

            {resetMutation.isError ? (
              <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
                Could not reset. Retry.
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" disabled={resetMutation.isPending} onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={resetMutation.isPending} onClick={handleConfirm}>
                Reset
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
