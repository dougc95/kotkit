import { useMeContext } from './AppBootstrap.js'

/**
 * Persistent synthetic-data notice (task 7.1.2; identity-realm: "Demo mode
 * is permanently and unmistakably labeled" / "Banner on every screen").
 * Renders nothing outside `local-demo` mode. Both `RailLayout` (7.1.3) and
 * `SessionLayout` (7.1.4) mount this as their first child so it is present
 * on every screen, including session mode, without scrolling — `sticky
 * top-0` keeps it pinned above the layout underneath it.
 *
 * Deliberately NOT a live region: no `role="status"`/`"alert"`, no
 * `aria-live`. It never changes after mount (identity mode does not flip
 * mid-session) and the app's one `aria-live="polite"` region
 * (`LiveRegion.tsx`) is reserved for opt-in milestone announcements, not an
 * ambient notice a screen reader user would hear repeated on every route
 * change. Never prints the raw `realm`, `principalId` or `identityMode`
 * values as labels (identity-realm: implementation details are not
 * user-facing) — the copy below is fixed text, not interpolated.
 */
export function DemoBanner() {
  const { identityMode } = useMeContext()

  if (identityMode !== 'local-demo') {
    return null
  }

  return (
    <aside
      aria-label="Demonstration data notice"
      className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center text-sm text-[var(--color-text)]"
    >
      This is synthetic demonstration data — not a real measurement.
    </aside>
  )
}
