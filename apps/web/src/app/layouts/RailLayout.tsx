import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'

import { useMediaQuery } from '../../lib/a11y/useMediaQuery.js'
import { DemoBanner } from '../DemoBanner.js'

/**
 * The four top-level destinations outside session mode (app-shell spec,
 * "Navigation exists outside session mode only" — "the app SHALL offer
 * exactly four top-level destinations: Today, Progress, Research,
 * Settings"). `/setup`, `/setup/readiness` and `/checkin/:date` are 'rail'
 * routes too (router.tsx) but are reached from Today, not from this nav.
 */
const DESTINATIONS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/today', label: 'Today' },
  { to: '/progress', label: 'Progress' },
  { to: '/research', label: 'Research' },
  { to: '/settings', label: 'Settings' },
]

/** Tailwind's `md` breakpoint — the tablet cutover design.md's Responsive layout requirement uses. */
const DESKTOP_QUERY = '(min-width: 768px)'

export interface NavItemProps {
  readonly to: string
  readonly label: string
  /** Decorative only; the accessible name always comes from `label`. */
  readonly icon?: ReactNode
}

/**
 * One navigation destination. `NavLink` sets `aria-current="page"` on the
 * active link itself (react-router's default), so no extra bookkeeping is
 * needed here. `min-h-11 min-w-11` (44px) meets the 44px touch-target size
 * this task calls for, a stricter number than the WCAG 2.2 AA 24px minimum
 * D40 records for touch targets elsewhere in the app.
 */
export function NavItem({ to, label, icon }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1',
          'rounded-md px-2 py-1 text-sm font-medium',
          'md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3',
          isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
        ].join(' ')
      }
    >
      {icon !== undefined ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </NavLink>
  )
}

/**
 * The navigation frame for every screen outside session mode (task 7.1.3).
 * Registered as the 'rail' layout route's element in router.tsx, replacing
 * the bare `<Outlet/>` 7.1.1 left there.
 *
 * Order matters here: `DemoBanner` renders first (identity-realm spec,
 * "Banner on every screen") but has no focusable content, so the
 * "Skip to content" link — right after it — is still the first *focusable*
 * element, ahead of the nav's four links, as this task's brief requires.
 * Below `768px` the nav becomes a fixed bottom bar instead of a left rail;
 * `<main>`'s `pb-24` in that mode keeps content clear of it. No other
 * prompt or slot lives in this layout.
 */
export function RailLayout() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const placement = isDesktop ? 'rail' : 'bottom'

  return (
    <div className="min-h-dvh md:flex">
      <DemoBanner />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--color-bg)] focus:px-4 focus:py-2 focus:text-[var(--color-text)] focus:shadow"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        data-placement={placement}
        className={
          placement === 'rail'
            ? 'sticky top-0 flex h-dvh w-56 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3'
            : 'fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1'
        }
      >
        {DESTINATIONS.map((destination) => (
          <NavItem key={destination.to} to={destination.to} label={destination.label} />
        ))}
      </nav>

      <main
        id="main"
        className={`mx-auto w-full max-w-3xl flex-1 px-4 py-6 ${placement === 'bottom' ? 'pb-24' : ''}`}
      >
        <Outlet />
      </main>
    </div>
  )
}
