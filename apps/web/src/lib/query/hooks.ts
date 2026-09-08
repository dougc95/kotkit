/**
 * The small, general-purpose query hooks every screen shares (task 7.4.2).
 * Each is a thin `useQuery` wrapper over `keys.ts` + `api` — no bespoke
 * fetching logic, no visibility listener (D15: visibility is never wired to
 * a query or a mutation here).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { MeResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../api/client.js'
import { queryKeys } from './keys.js'

export function useMe(): UseQueryResult<MeResponseValue> {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me.get })
}

/**
 * Reads the SAME cache entry `SessionModeProvider` (mounted once at the
 * app root) populates via `GET /sessions/active` — this hook never issues
 * its own fetch beyond what TanStack Query's cache sharing already gives
 * it for an identical `queryKey`. A 204 (no active session) resolves `null`
 * (`client.ts`'s `send()`), never `undefined`-as-absent.
 */
export function useActiveSession(): UseQueryResult<SessionResponseValue | null> {
  return useQuery({ queryKey: queryKeys.sessions.active, queryFn: api.sessions.active })
}

export function useSession(id: string): UseQueryResult<SessionResponseValue> {
  return useQuery({ queryKey: queryKeys.sessions.byId(id), queryFn: () => api.sessions.get(id) })
}
