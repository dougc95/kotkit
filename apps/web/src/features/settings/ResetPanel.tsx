import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { purgeOtherSessions } from '../../lib/outbox/store.js'
import { Button } from '../../ui/Button.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'

const FINALIZE_KEY_PREFIX = 'finalize:'

/** Best-effort removal of every `finalize:{sessionId}` sessionStorage key. */
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
 * The reset section of `DemoControls`. `POST /demo/reset` (204) is followed
 * by: clearing the whole query cache, purging every session's outbox rows,
 * clearing every `finalize:{sessionId}` sessionStorage key, then navigating
 * to `/today`.
 */
export function ResetPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])

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
      <h3 className="text-sm font-semibold text-ink">Reset demo data</h3>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          <Button variant="secondary">Reset demo data</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all demonstration data?</AlertDialogTitle>
            <AlertDialogDescription>This replaces all demonstration data for this profile</AlertDialogDescription>
          </AlertDialogHeader>

          {resetMutation.isError ? (
            <p role="alert" className="text-sm text-attention">
              Could not reset. Retry.
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              ref={focusOnMount}
              variant="secondary"
              disabled={resetMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={resetMutation.isPending}
              onClick={handleConfirm}
            >
              Reset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
