/**
 * The app's one `QueryClient` factory (task 7.4.2; design.md D15). The
 * session-aware refetch policy lives entirely in these default options —
 * no query or mutation overrides `refetchOnWindowFocus`/`refetchOnReconnect`
 * itself:
 *
 *  - `refetchOnWindowFocus`/`refetchOnReconnect` read `modeRef.isActive()`
 *    (`sessionMode.ts`) SYNCHRONOUSLY at the moment TanStack Query's focus/
 *    online manager considers refetching, so a session in progress never
 *    triggers a refetch storm or any visibility side effect (D15) — the tab
 *    can be revisited freely without the app doing anything.
 *  - `refetchInterval: false` — nothing polls; the session clock is driven
 *    by `useSessionClock` (7.2.3), never by query refetching.
 *  - `staleTime: 30_000` — a moderate default so ordinary navigation between
 *    screens does not re-fetch on every mount.
 *  - `retry` only retries a `NetworkError` (offline, timeout), at most
 *    twice; every other `ApiError` subclass (validation, conflict, not
 *    found, server) is left to the caller — retrying a 409 or 422
 *    automatically would just repeat the same conflict.
 *  - `mutations.retry: false` — a mutation's own hook (`useStartSession`
 *    7.4.4, `useFinalizeSession` 7.3.5) owns its idempotency-keyed retry
 *    logic explicitly; the query client never retries a write on its own.
 */
import { QueryClient } from '@tanstack/react-query'

import { NetworkError } from '../api/errors.js'
import type { SessionModeRef } from './sessionMode.js'

export function createQueryClient(modeRef: SessionModeRef): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: () => !modeRef.isActive(),
        refetchOnReconnect: () => !modeRef.isActive(),
        refetchInterval: false,
        staleTime: 30_000,
        retry: (failureCount, error) => error instanceof NetworkError && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
