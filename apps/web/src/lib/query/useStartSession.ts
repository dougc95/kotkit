/**
 * `useStartSession`: THE start hook (task 7.4.4; design.md D16, D18, D20-D21;
 * specs/session-recovery: "Starting a session requires the server" /
 * "Start retried after timeout", "Start while offline"). One hook, shared by
 * Today's practice form (8.2) and Benchmark ready's Start (8.3, absorbing
 * 8.10.6) — neither screen builds its own idempotency-key handling or
 * `POST /sessions` mutation.
 *
 * A logical start owns exactly one `Idempotency-Key`: minted on the first
 * `start(body)` call and reused for every retry of an UNCHANGED body — the
 * hook's own automatic retry (at most 2 further attempts on `NetworkError`,
 * 1 s apart) or the caller pressing Retry (calling `start()` again with the
 * identical body). When the body passed to a later `start()` call differs
 * (deep-equal, not reference equal — a caller typically rebuilds the object
 * every render) from the one the CURRENT key was minted for, a fresh key is
 * minted instead of replaying stale content under the old one: an edited
 * draft after a failed start is a new logical start. Every attempt of one
 * logical start sends the identical `Idempotency-Key` via
 * `api.sessions.create(body, { idempotencyKey })`.
 *
 * Outcomes:
 *  - Success: `queryClient.setQueryData(queryKeys.sessions.active, session)`
 *    (this alone flips session mode — 7.4.2's `SessionModeProvider` reads the
 *    same cache entry), invalidates `queryKeys.programs.current` and
 *    `queryKeys.programs.today(body.programId)`, clears the key, resolves
 *    the session.
 *  - `ConflictError` `active_session_exists`: reads `activeSessionId` from
 *    `error.details` (D18's error envelope — never a bespoke top-level
 *    field), exposes it as `activeSessionId` on the hook's state, and
 *    invalidates `queryKeys.sessions.active` so the caller's screen re-
 *    renders the existing session (design.md's "Second tab" flow; 8.2.5's
 *    `ActiveSessionCard` reads this state — `BlockCard`/`Ready` do no 409
 *    routing of their own).
 *  - `NetworkError` once the automatic retries are exhausted: `status`
 *    'error', `error` retained, the key retained (the content has not
 *    changed), the active-session cache untouched — the caller's screen
 *    offers Retry.
 *  - `ValidationError` (422 slot rules): `status` 'error' with
 *    `error.fieldErrors` for the caller to render beside the named field;
 *    the key retained since the content has not changed.
 *
 * Nothing here starts a clock or navigates: a timer exists only once
 * `useSessionClock` (7.2.3) receives a server session, and navigating to the
 * session route is the caller's job once `start()` resolves.
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CreateSessionBodyValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../api/client.js'
import { ApiError, ConflictError, NetworkError } from '../api/errors.js'
import { newIdempotencyKey } from '../api/newIdempotencyKey.js'
import { queryKeys } from './keys.js'

export type StartSessionStatus = 'idle' | 'pending' | 'error' | 'success'

export interface UseStartSessionResult {
  start(body: CreateSessionBodyValue): Promise<SessionResponseValue>
  status: StartSessionStatus
  error: ApiError | null
  activeSessionId: string | null
}

/** Initial attempt plus "at most 2 further attempts" (design.md D16's own wording). */
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Structural equality over the plain JSON-shaped `CreateSessionBodyValue`
 * (and its optional nested `conditions` object/`accommodations` array) —
 * never reference equality, since a caller (a controlled form) typically
 * rebuilds the body object on every render even when its values are
 * unchanged.
 */
function bodiesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((item, index) => bodiesEqual(item, b[index]))
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && bodiesEqual(aRecord[key], bRecord[key]))
}

/** `error.details.activeSessionId` (D18) — never a bespoke top-level field. */
function activeSessionIdFrom(error: ConflictError): string | null {
  const details = error.details as { activeSessionId?: unknown } | undefined
  return typeof details?.activeSessionId === 'string' ? details.activeSessionId : null
}

export function useStartSession(): UseStartSessionResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StartSessionStatus>('idle')
  const [error, setError] = useState<ApiError | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // The current logical start's key and the body it was minted for. Plain
  // refs, not state: `start()` must read and (when the body changed) update
  // these SYNCHRONOUSLY at the very top of the call, before any `await` —
  // including when a second `start()` call happens while a first one is
  // still retrying (an edited draft pre-empts the stale key immediately,
  // rather than waiting for React to re-render).
  const keyRef = useRef<string | null>(null)
  const keyBodyRef = useRef<CreateSessionBodyValue | null>(null)

  const start = useCallback(
    async (body: CreateSessionBodyValue): Promise<SessionResponseValue> => {
      const idempotencyKey =
        keyRef.current !== null && bodiesEqual(keyBodyRef.current, body) ? keyRef.current : newIdempotencyKey()
      keyRef.current = idempotencyKey
      keyBodyRef.current = body

      setStatus('pending')
      setError(null)

      let lastError: unknown = null
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop -- attempts are sequential by design (each retry waits on the previous one's outcome).
          const session = await api.sessions.create(body, { idempotencyKey })

          queryClient.setQueryData(queryKeys.sessions.active, session)
          void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
          void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(body.programId) })

          keyRef.current = null
          keyBodyRef.current = null
          setStatus('success')
          return session
        } catch (thrown) {
          lastError = thrown
          const isLastAttempt = attempt === MAX_ATTEMPTS - 1
          if (thrown instanceof NetworkError && !isLastAttempt) {
            // eslint-disable-next-line no-await-in-loop -- the 1 s spacing between automatic retries is the point.
            await delay(RETRY_DELAY_MS)
            continue
          }
          break
        }
      }

      if (lastError instanceof ConflictError && lastError.code === 'active_session_exists') {
        setActiveSessionId(activeSessionIdFrom(lastError))
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
      }

      setStatus('error')
      setError(lastError instanceof ApiError ? lastError : null)
      throw lastError
    },
    [queryClient],
  )

  return { start, status, error, activeSessionId }
}
