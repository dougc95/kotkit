/**
 * TanStack Query cache keys (task 7.4.2). One tree, imported everywhere a
 * query or mutation needs to read or invalidate the cache — no call site
 * ever spells out a raw key array itself (design.md's Architecture: `lib/
 * query/` owns "query keys, session-aware refetch policy").
 *
 * Every leaf is `as const` so its key array is a readonly tuple TanStack
 * Query can use for both `queryKey` and `invalidateQueries`/`setQueryData`
 * targeting. Parameterized leaves are functions returning such a tuple,
 * following TanStack Query's documented "query key factory" shape.
 */

export const queryKeys = {
  me: ['me'] as const,
  programs: {
    current: ['programs', 'current'] as const,
    today: (programId: string) => ['programs', programId, 'today'] as const,
  },
  sessions: {
    active: ['sessions', 'active'] as const,
    byId: (id: string) => ['sessions', id] as const,
  },
  days: (programId: string, date: string) => ['programs', programId, 'days', date] as const,
  report: (programId: string) => ['programs', programId, 'report'] as const,
  research: {
    cards: ['research', 'cards'] as const,
  },
} as const
