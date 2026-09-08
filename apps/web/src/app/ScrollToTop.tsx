import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Resets scroll position to the top on every client-side route change.
 *
 * React Router's `<Outlet>` swaps route content in place without a full page
 * load, so — unlike a real navigation — the browser never resets `scrollY`
 * on its own: whatever scroll position the previous screen ended at (e.g.
 * Recall, scrolled down after filling several point fields) carries straight
 * over into the next screen, silently pushing that screen's own header and
 * the demo banner off-screen above the fold (confirmed empirically:
 * `e2e/a11y/axe-session.spec.ts`'s own "demo banner in viewport" case,
 * navigating Recall -> Scoring). Mounted once in `Root.tsx`, alongside
 * `SessionLeaveGuard`, so it applies to every route without either layout
 * needing to repeat it.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
