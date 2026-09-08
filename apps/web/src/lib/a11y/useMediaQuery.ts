import { useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query and returns whether it currently matches,
 * re-rendering the component when the match state changes (task 7.1.3 —
 * `RailLayout` uses `useMediaQuery('(min-width: 768px)')`, Tailwind's `md`
 * breakpoint, to switch between a desktop rail and a phone bottom bar).
 *
 * Built on `useSyncExternalStore` rather than `usePrefersReducedMotion`'s
 * unsubscribed read-on-render (src/lib/a11y/usePrefersReducedMotion.ts):
 * that hook only ever needs its value at the moment a component happens to
 * re-render for other reasons, while a layout switching its whole shape on
 * a breakpoint change needs to react to the change itself. Falls back to
 * `false` (the narrower, phone-style layout) when `window.matchMedia` is
 * unavailable — no DOM environment or a host that never implements it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => subscribe(query, onStoreChange),
    () => getSnapshot(query),
    () => false,
  )
}

function matchMediaSafe(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(query)
}

function getSnapshot(query: string): boolean {
  return matchMediaSafe(query)?.matches ?? false
}

function subscribe(query: string, onStoreChange: () => void): () => void {
  const mql = matchMediaSafe(query)
  if (mql === null) {
    return () => {}
  }

  // Modern browsers and jsdom implement addEventListener on MediaQueryList;
  // the older addListener/removeListener pair is kept only as a fallback
  // for a host that predates it (Safari < 14).
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onStoreChange)
    return () => mql.removeEventListener('change', onStoreChange)
  }

  type LegacyMediaQueryList = {
    addListener(listener: () => void): void
    removeListener(listener: () => void): void
  }
  const legacy = mql as unknown as LegacyMediaQueryList
  legacy.addListener(onStoreChange)
  return () => legacy.removeListener(onStoreChange)
}
