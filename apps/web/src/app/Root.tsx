import { Outlet } from 'react-router'
import { LiveRegion } from '../ui/LiveRegion.js'
import { AppBootstrap } from './AppBootstrap.js'
import { ScrollToTop } from './ScrollToTop.js'
import { SessionLeaveGuard } from './SessionLeaveGuard.js'

/**
 * The root route element. `SessionModeProvider` (7.4.2) wraps `RouterProvider`
 * one level up in `providers.tsx`, so this element — and everything below it
 * — is already inside that provider's tree without needing to repeat it here.
 * Nesting order below: `LiveRegion` (outermost, so `useAnnouncer()` is
 * available to every route) > `AppBootstrap` (gates rendering on `GET /me`)
 * > `ScrollToTop`/`SessionLeaveGuard` (both siblings of `Outlet`, not
 * descendants of either layout, so both apply regardless of which layout is
 * current).
 */
export function Root() {
  return (
    <LiveRegion>
      <AppBootstrap>
        <ScrollToTop />
        <SessionLeaveGuard />
        <Outlet />
      </AppBootstrap>
    </LiveRegion>
  )
}
