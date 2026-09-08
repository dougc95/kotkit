/**
 * `useFinalizeSession(sessionId)` — the one hook the Scoring screen (8.4.5)
 * and PracticeReview (8.6.2) use to finalize a session or abandon it (task
 * 7.3.5; design.md D16 — absorbs 8.10.5 — D18-D21, D28; specs/session-
 * recovery: "Finalization is atomic and idempotent" / "Finalize retried",
 * "Finalization is atomic and idempotent" / "Event count mismatch",
 * "Abandon and save-incomplete are always available", "Recovery buffer is
 * bounded and purged" / "Buffer after sync"; specs/identity-realm: "Private
 * data is never written to logs or stored insecurely").
 *
 * Wraps 7.3.4's `finalizeWithSync`/`abandonWithPurge` — this hook never
 * calls `POST /sessions/{id}/finalize` or the transitions route itself, and
 * owns exactly one piece of browser storage: `sessionStorage['finalize:
 * {sessionId}']` holds the Idempotency-Key for this session's in-progress
 * finalize (D16), so a reload before success reuses it instead of minting a
 * second one — the key is read back from `sessionStorage` once, on mount,
 * if present. Nothing else is ever written to `sessionStorage` or
 * `localStorage` by this hook.
 *
 * `finalize(review)` runs a loop (`runChain` below), shared with `retry()`:
 *  1. status 'flushing'; mints (or reuses) the one key for this logical
 *     finalize and persists it before the first network call, so a reload
 *     mid-flight can recover it.
 *  2. reads `session.eventCount` off the TanStack Query cache entry for
 *     `GET /sessions/{sessionId}` (D20/D21) — a passive read of whatever the
 *     consuming screen's own `useSession(sessionId)` already populated,
 *     never a fetch of its own. `finalizeWithSync` adds the rows it itself
 *     flushes on top of this number (D21); a missing cache entry (should
 *     not happen — the screen using this hook always renders from
 *     `useSession(sessionId)` first) falls back to 0 rather than throwing.
 *  3. status 'submitting'; calls `finalizeWithSync`. 7.3.4 already performs
 *     its own flush plus one same-key retry on `event_count_mismatch`
 *     before rejecting, so a `ConflictError event_count_mismatch` reaching
 *     here means two server round trips have already failed.
 *  4. Success -> status 'success', the sessionStorage key is removed (the
 *     outbox is already purged by `finalizeWithSync`), `result` holds the
 *     server payload unchanged.
 *  5. `event_count_mismatch` -> `mismatchAttempts` increments; while it is
 *     still under 3 the loop goes straight back to step 3 (status passes
 *     through 'mismatch' then 'submitting') with the SAME key; on the 3rd
 *     consecutive mismatch the loop stops without a 4th call, status
 *     becomes 'unsaved_entries' ("Some entries are still unsaved. Retry."),
 *     and the caller's `retry()` is the only way forward — it re-enters
 *     this exact same loop WITHOUT resetting the counter, so a retry that
 *     mismatches yet again goes straight back to 'unsaved_entries' after
 *     just one more attempt rather than looping twice more.
 *  6. Any other rejection (NetworkError, ServerError, a non-mismatch 409)
 *     -> status 'error'; the key and `mismatchAttempts` are both retained
 *     so `retry()` can try again with identical content.
 *
 * `abandon(expectedVersion, reason?)` calls `abandonWithPurge`. 7.3.4's
 * `AbandonWithPurgeParams` does not declare a `reason` field (its own
 * header comment: "no reason — D29 stores reason only on pause events"), so
 * `reason` is forwarded as a harmless extra property via a non-literal
 * argument (structurally assignable, sidesteps TypeScript's excess-property
 * check on object literals) rather than dropped — a caller that does
 * collect one is not silently discarded, while `abandonWithPurge`'s own
 * destructuring (`{ sessionId, expectedVersion, api }`) ignores it exactly
 * as D29 says the server itself does for an abandon transition. Success
 * removes the sessionStorage key and sets status 'success' with
 * `result: null` (an abandon has no review payload); failure sets status
 * 'error' and purges nothing.
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { FinalizeResponseValue, ReviewInputValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../api/client.js'
import { ConflictError } from '../api/errors.js'
import { newIdempotencyKey } from '../api/newIdempotencyKey.js'
import { queryKeys } from '../query/keys.js'
import { abandonWithPurge, finalizeWithSync } from './finalize.js'

/** On the 3rd consecutive `event_count_mismatch`, stop retrying automatically (D16). */
const MAX_MISMATCH_ATTEMPTS = 3

export type FinalizeSessionStatus =
  | 'idle'
  | 'flushing'
  | 'submitting'
  | 'mismatch'
  | 'unsaved_entries'
  | 'error'
  | 'success'

export interface FinalizeMismatch {
  readonly expected: number
  readonly stored: number
}

export interface UseFinalizeSessionResult {
  finalize(review: ReviewInputValue): Promise<void>
  abandon(expectedVersion: number, reason?: string): Promise<void>
  status: FinalizeSessionStatus
  mismatch: FinalizeMismatch | null
  mismatchAttempts: number
  retry(): Promise<void>
  result: FinalizeResponseValue | null
}

function storageKey(sessionId: string): string {
  return `finalize:${sessionId}`
}

/**
 * Best-effort sessionStorage read/write/remove: storage being unavailable
 * (a hardened browser profile, a full quota) never breaks the finalize
 * flow itself — it only means a reload cannot recover the same key, so a
 * fresh one would be minted next time, which is exactly the "no receipt
 * yet" case `finalizeWithSync`/the server's idempotency table already
 * handle safely.
 */
function readStoredKey(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(sessionId))
  } catch {
    return null
  }
}

function writeStoredKey(sessionId: string, key: string): void {
  try {
    sessionStorage.setItem(storageKey(sessionId), key)
  } catch {
    // Storage unavailable: the key still lives in keyRef for this page life.
  }
}

function clearStoredKey(sessionId: string): void {
  try {
    sessionStorage.removeItem(storageKey(sessionId))
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

/**
 * `error.details` narrowed to `{ expected, stored }` only for a genuine
 * `event_count_mismatch`; `undefined` for anything else. Mirrors
 * `finalize.ts`'s own private `mismatchDetails` (not exported, so this is a
 * deliberate, small duplication rather than reaching into a sibling
 * module's internals).
 */
function extractMismatch(error: unknown): FinalizeMismatch | undefined {
  if (!(error instanceof ConflictError) || error.code !== 'event_count_mismatch') {
    return undefined
  }
  const details = error.details as { expected?: unknown; stored?: unknown } | undefined
  if (typeof details?.expected !== 'number' || typeof details?.stored !== 'number') {
    return undefined
  }
  return { expected: details.expected, stored: details.stored }
}

export function useFinalizeSession(sessionId: string): UseFinalizeSessionResult {
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<FinalizeSessionStatus>('idle')
  const [mismatch, setMismatch] = useState<FinalizeMismatch | null>(null)
  const [mismatchAttempts, setMismatchAttempts] = useState(0)
  const [result, setResult] = useState<FinalizeResponseValue | null>(null)

  // Authoritative for control flow — read synchronously inside the async
  // loop below, where a `useState` value could be stale across awaits.
  // Mirrored into the `mismatchAttempts` state above for the caller to read.
  const mismatchAttemptsRef = useRef(0)
  // The last review body `finalize()` was called with, so `retry()` (which
  // takes no arguments) can resubmit identical content.
  const reviewRef = useRef<ReviewInputValue | null>(null)

  // Lazy, once-only read on mount: a reload before success picks the key
  // back up from sessionStorage instead of minting a new one (D16).
  const [initialKey] = useState<string | null>(() => readStoredKey(sessionId))
  const keyRef = useRef<string | null>(initialKey)

  const runChain = useCallback(
    async (review: ReviewInputValue): Promise<void> => {
      reviewRef.current = review

      if (keyRef.current === null) {
        keyRef.current = newIdempotencyKey()
        writeStoredKey(sessionId, keyRef.current)
      }
      const idempotencyKey = keyRef.current

      // Only the very first attempt of THIS call shows 'flushing'; every
      // automatic mismatch-driven retry inside the loop shows 'mismatch'
      // instead (step 5 above) — both transition to 'submitting' just
      // before the actual `finalizeWithSync` call.
      let firstAttemptOfThisCall = true
      for (;;) {
        setStatus(firstAttemptOfThisCall ? 'flushing' : 'mismatch')
        firstAttemptOfThisCall = false

        const cachedSession = queryClient.getQueryData<SessionResponseValue>(queryKeys.sessions.byId(sessionId))
        const knownServerEventCount = cachedSession?.eventCount ?? 0

        setStatus('submitting')

        try {
          const response = await finalizeWithSync({
            sessionId,
            idempotencyKey,
            knownServerEventCount,
            review,
            api,
          })
          keyRef.current = null
          clearStoredKey(sessionId)
          setMismatch(null)
          setResult(response)
          setStatus('success')
          return
        } catch (error) {
          const details = extractMismatch(error)
          if (details === undefined) {
            // NetworkError, ServerError, a non-mismatch 409, ... — the key
            // and mismatchAttempts stay exactly as they are for retry().
            setStatus('error')
            return
          }

          setMismatch(details)
          mismatchAttemptsRef.current += 1
          setMismatchAttempts(mismatchAttemptsRef.current)

          if (mismatchAttemptsRef.current >= MAX_MISMATCH_ATTEMPTS) {
            setStatus('unsaved_entries')
            return
          }
          // Still under the cap: loop back and call finalizeWithSync again
          // with the identical key — no 4th (or later) call happens until
          // the caller invokes retry().
        }
      }
    },
    [sessionId, queryClient],
  )

  const finalize = useCallback((review: ReviewInputValue): Promise<void> => runChain(review), [runChain])

  const retry = useCallback((): Promise<void> => {
    // Nothing to retry if finalize() was never called for this hook
    // instance — a no-op rather than throwing.
    if (reviewRef.current === null) {
      return Promise.resolve()
    }
    return runChain(reviewRef.current)
  }, [runChain])

  const abandon = useCallback(
    async (expectedVersion: number, reason?: string): Promise<void> => {
      const params = { sessionId, expectedVersion, api, ...(reason !== undefined ? { reason } : {}) }
      try {
        await abandonWithPurge(params)
        keyRef.current = null
        clearStoredKey(sessionId)
        setMismatch(null)
        setResult(null)
        setStatus('success')
      } catch {
        setStatus('error')
      }
    },
    [sessionId],
  )

  return { finalize, abandon, status, mismatch, mismatchAttempts, retry, result }
}
