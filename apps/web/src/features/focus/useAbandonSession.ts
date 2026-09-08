/**
 * `useAbandonSession(sessionId)` — the small mutation hook `AbandonSession`
 * (task 8.10.7; design.md D38; specs/session-recovery: "Abandon and save-
 * incomplete are always available", "Recovery buffer is bounded and
 * purged", "Stale writes conflict instead of overwriting" / "Two tabs end a
 * session") drives its confirm action with.
 *
 * Wraps 7.3.4's `abandonWithPurge` directly — NOT 7.3.5's
 * `useFinalizeSession` (this task's own "After" list omits 7.3.5): this
 * control is mounted once per session route regardless of which screen
 * (Focus, benchmark running, recall, scoring, review) is currently showing,
 * so it owns its own small piece of state rather than depending on a
 * finalize-flow hook instance scoped to one particular screen's own review
 * form. `abandonWithPurge` itself owns the transition call and the outbox
 * purge (7.3.4); this hook adds only status tracking and the stale-conflict
 * refetch. Clearing `sessionStorage['finalize:{sessionId}']` (owned by
 * 7.3.5) is `AbandonSession.tsx`'s own job on success, not this hook's.
 *
 * `abandon(expectedVersion, reason?)`:
 *  1. status 'pending'.
 *  2. calls `abandonWithPurge({ sessionId, expectedVersion, api, ...reason })`
 *     — `reason` is forwarded as a harmless extra property the same way
 *     7.3.5's own `useFinalizeSession.abandon()` does (a non-literal
 *     argument is structurally assignable to `AbandonWithPurgeParams`
 *     without tripping TypeScript's excess-property check, which only
 *     fires on a literal assigned directly to a typed binding): the
 *     interface declares no `reason` field (D29 — "no reason" is 7.3.4's
 *     own deliberate choice) and its destructuring drops it before it ever
 *     reaches `api.sessions.transition`, exactly as the server's own schema
 *     comment says it would for an `abandon` transition even if it did
 *     arrive ("accepted and silently ignored for `end` and `abandon`",
 *     contracts/sessions.ts). Sent only when `reason` is non-empty after
 *     trimming.
 *  3. Success -> status 'success'. The caller (`AbandonSession`) reacts to
 *     this by clearing the sessionStorage key, invalidating queries and
 *     navigating away.
 *  4. `409 stale_version` (an already-ended-elsewhere conflict, per D19) ->
 *     invalidates `['sessions','active']` and `['sessions', sessionId]` so
 *     every observer (this session's own screen included) re-renders from
 *     the current server state, status 'stale', and sends no second
 *     transition — the caller decides whether the user tries again.
 *  5. Any other rejection (network failure, a non-stale 409, ...) -> status
 *     'error' ("Could not abandon. Retry."); nothing is cleared or
 *     invalidated.
 *
 * Errors are duck-typed (`status`/`code` fields), not narrowed with
 * `instanceof ConflictError`: mirrors `ReadinessForm.tsx`'s own
 * `asKnownApiError` — the real `api` client throws typed `ApiError`
 * subclasses, but `mockClient.ts`'s `reject()` (this file's own future
 * tests, and every other component test in this codebase) only builds a
 * plain `Error` with the same shape, which `instanceof` would miss.
 */
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { abandonWithPurge } from '../../lib/outbox/finalize.js'
import { queryKeys } from '../../lib/query/keys.js'

export type AbandonSessionStatus = 'idle' | 'pending' | 'success' | 'stale' | 'error'

export interface UseAbandonSessionResult {
  abandon(expectedVersion: number, reason?: string): Promise<void>
  status: AbandonSessionStatus
}

interface KnownApiError {
  status: number
  code: string
}

function asKnownApiError(error: unknown): KnownApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const record = error as Record<string, unknown>
  if (typeof record.status !== 'number' || typeof record.code !== 'string') {
    return null
  }
  return record as unknown as KnownApiError
}

export function useAbandonSession(sessionId: string): UseAbandonSessionResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AbandonSessionStatus>('idle')

  const abandon = useCallback(
    async (expectedVersion: number, reason?: string): Promise<void> => {
      setStatus('pending')

      const trimmedReason = reason?.trim()
      // No explicit type annotation here (see the module comment): keeping
      // `params`'s type inferred, rather than declared as
      // `AbandonWithPurgeParams`, is what lets the extra `reason` property
      // through TypeScript's excess-property check.
      const params = {
        sessionId,
        expectedVersion,
        api,
        ...(trimmedReason !== undefined && trimmedReason.length > 0 ? { reason: trimmedReason } : {}),
      }

      try {
        await abandonWithPurge(params)
        setStatus('success')
      } catch (error) {
        const known = asKnownApiError(error)
        if (known !== null && known.status === 409 && known.code === 'stale_version') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId) })
          setStatus('stale')
          return
        }
        setStatus('error')
      }
    },
    [sessionId, queryClient],
  )

  return { abandon, status }
}
