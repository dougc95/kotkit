/**
 * Session mode: the one flag that says "a running/paused/awaiting-review
 * session owns the screen right now" (task 7.4.2; design.md D15, D17;
 * specs/app-shell: "Navigation exists outside session mode only";
 * specs/session-recovery: "Reload recovers the active session", "Starting a
 * session requires the server", "Recovery buffer is bounded and purged" /
 * "Buffer after sync").
 *
 * Two surfaces, deliberately different shapes, both backed by the SAME
 * `GET /sessions/active` query:
 *
 *  - `SessionModeRef` (`createSessionModeRef()`): a plain mutable object
 *    whose `isActive()` can be called SYNCHRONOUSLY from outside React — the
 *    `QueryClient`'s `refetchOnWindowFocus`/`refetchOnReconnect` option
 *    functions (`client.ts`) and the route-leave guard's `useBlocker`
 *    predicate (7.4.3) both need this, and neither runs inside a React
 *    render where a hook could be called. It is created once in
 *    `providers.tsx`, before the `QueryClient` itself (`createQueryClient`
 *    reads it), so both the client and the provider below share the exact
 *    same instance.
 *  - `useSessionMode()`: the reactive, in-React read of the same state, for
 *    a component that needs to re-render when session mode flips.
 *
 * `SessionModeProvider` is the single place that runs
 * `useQuery({ queryKey: queryKeys.sessions.active, queryFn: api.sessions.active })`
 * for the whole app (every other read — `useActiveSession()`, `hooks.ts` —
 * shares this same cache entry rather than issuing its own fetch). Two
 * effects, deliberately separate:
 *
 *  1. Runs on EVERY resolution of the query: writes the latest session (or
 *     `null`) into `modeRef` and into the reactive context value, so a later
 *     `queryClient.setQueryData(queryKeys.sessions.active, session)` (e.g.
 *     `useStartSession`, 7.4.4) flips `isActive()` immediately.
 *  2. Runs exactly ONCE, on the FIRST successful resolution after app boot
 *     (D17, guarded by a ref — never re-armed by a later `setQueryData` or
 *     refetch): replays the active session's outbox (`replayOnLoad`, 7.3.2)
 *     then purges every other session's rows (`purgeOtherSessions`, 7.3.1);
 *     with no active session, purges the whole outbox (D6: the buffer holds
 *     only an active session's rows, and none is active). No navigation
 *     happens here — screens alone decide what to render.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionResponseValue } from '@attention-lab/shared'

import { api } from '../api/client.js'
import { replayOnLoad } from '../outbox/flush.js'
import { purgeOtherSessions } from '../outbox/store.js'
import { queryKeys } from './keys.js'

/** The three lifecycles that mean "a session owns the screen" (D17/D20). */
const ACTIVE_LIFECYCLES: ReadonlySet<SessionResponseValue['lifecycle']> = new Set([
  'running',
  'paused',
  'awaiting_review',
])

/**
 * Exported (not just used internally) so a consumer that must read this
 * synchronously outside a React render — `SessionLeaveGuard`'s
 * `useBlocker` predicate, specifically — can apply the exact same rule
 * against a direct `queryClient.getQueryData(queryKeys.sessions.active)`
 * read (D16: one owner for "which lifecycles count as active"), rather than
 * a React-rendered `isActive` value whose update after a same-tick
 * `queryClient.setQueryData(...)` + `navigate(...)` pair is not guaranteed
 * to have committed before the navigation's blocker check runs.
 */
export function isActiveLifecycle(session: SessionResponseValue | null): boolean {
  return session !== null && ACTIVE_LIFECYCLES.has(session.lifecycle)
}

/**
 * A plain (non-React) mutable box: `isActive()` reads synchronously from
 * whatever `set()` last stored. Safe to call from anywhere — a `QueryClient`
 * option function, a router blocker predicate — that runs outside React's
 * render cycle.
 */
export interface SessionModeRef {
  isActive(): boolean
  set(session: SessionResponseValue | null): void
}

export function createSessionModeRef(): SessionModeRef {
  let current: SessionResponseValue | null = null
  return {
    isActive: () => isActiveLifecycle(current),
    set: (session) => {
      current = session
    },
  }
}

export interface SessionModeContextValue {
  readonly isActive: boolean
  readonly activeSession: SessionResponseValue | null
}

const SessionModeContext = createContext<SessionModeContextValue | null>(null)

export interface SessionModeProviderProps {
  readonly modeRef: SessionModeRef
  readonly children: ReactNode
}

export function SessionModeProvider({ modeRef, children }: SessionModeProviderProps) {
  const { data, isSuccess } = useQuery({
    queryKey: queryKeys.sessions.active,
    queryFn: api.sessions.active,
  })
  const activeSession = data ?? null

  // (1) Keep the ref (and the reactive context value below) in sync with
  // every resolution of this query — the initial load, a background
  // refetch, or a mutation's `setQueryData`/`invalidateQueries`.
  useEffect(() => {
    modeRef.set(activeSession)
  }, [modeRef, activeSession])

  // (2) D17: boot-time replay + purge, exactly once per app boot. Guarded by
  // a ref rather than component state so a later data change can never
  // re-trigger this block — only the very first successful resolution does.
  const bootHandledRef = useRef(false)
  useEffect(() => {
    if (!isSuccess || bootHandledRef.current) {
      return
    }
    bootHandledRef.current = true

    if (activeSession !== null) {
      void replayOnLoad(activeSession.id, api).then(() => purgeOtherSessions(activeSession.id))
    } else {
      void purgeOtherSessions(null)
    }
    // `activeSession`/`isSuccess` are read once, guarded above by the ref —
    // listed as deps only so lint rules are satisfied, never causing a
    // second run.
  }, [isSuccess, activeSession])

  const value: SessionModeContextValue = {
    isActive: isActiveLifecycle(activeSession),
    activeSession,
  }

  return <SessionModeContext.Provider value={value}>{children}</SessionModeContext.Provider>
}

/** The reactive read of session mode — re-renders the caller when it flips. */
export function useSessionMode(): SessionModeContextValue {
  const value = useContext(SessionModeContext)
  if (value === null) {
    throw new Error('useSessionMode must be used within a SessionModeProvider')
  }
  return value
}
