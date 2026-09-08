import { Outlet } from 'react-router'
import { DemoBanner } from '../DemoBanner.js'
import { AbandonSession } from '../../features/focus/AbandonSession.js'
import { ClockGapPrompt } from '../../features/focus/ClockGapPrompt.js'
import { useSessionMode } from '../../lib/query/sessionMode.js'

/**
 * The layout element for every session-mode route (task 7.1.4):
 * `/benchmark/:slotId`, `/benchmark/:sessionId/recall`,
 * `/benchmark/:sessionId/scoring`, `/focus/:sessionId` and
 * `/review/:sessionId` (design.md's route map — "Session layout (no nav)").
 *
 * app-shell "Navigation exists outside session mode only" / "Navigation
 * hidden during practice": in session mode the app hides top-level
 * navigation and must not surface research, preferences, progress or any
 * other prompt. This renders `<DemoBanner/>` (identity-realm: "Banner on
 * every screen" — present even in session mode) then `<main id="main">`
 * with `<Outlet/>` and NOTHING else — no `<nav>`, no links to `/today`,
 * `/progress`, `/research` or `/settings`, no research/preferences/progress
 * prompt slots.
 *
 * The only exits from a session-mode screen are the session actions the
 * screen itself provides (group 8: pause, finish early, abandon, save
 * recall, finalize, ...) or the browser (back/reload/close). Guarding
 * in-app URL navigation away from an active session ("Leaving a session by
 * URL") is 7.4.3's `SessionLeaveGuard`, not this layout.
 */
export function SessionLayout() {
  const { activeSession } = useSessionMode()

  return (
    <>
      <DemoBanner />
      <main id="main">
        <Outlet />
      </main>
      {activeSession !== null &&
      (activeSession.lifecycle === 'running' || activeSession.lifecycle === 'paused') ? (
        <ClockGapPrompt session={activeSession} />
      ) : null}
      {activeSession !== null ? <AbandonSession session={activeSession} /> : null}
    </>
  )
}
