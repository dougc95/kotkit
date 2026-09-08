const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the system currently prefers reduced motion. This is the
 * script-side signal for the rare case a component needs it in JS (e.g. to
 * skip a JS-driven animation entirely rather than shorten it) — CSS's own
 * `@media (prefers-reduced-motion: reduce)` block (src/index.css) is the
 * primary enforcement and needs no help from this function for ordinary
 * CSS transitions.
 *
 * Deliberately calls no React hook itself: it reads `matchMedia` fresh on
 * every call, so it is safe to call from a component render (recomputed
 * each render, same as any other derived value) or directly from a test,
 * with no subscription or DOM environment required beyond `window`.
 */
export function usePrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(REDUCE_MOTION_QUERY).matches
}
