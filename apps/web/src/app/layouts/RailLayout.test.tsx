import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type { MeResponseValue } from '@attention-lab/shared'

import { respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AppBootstrap } from '../AppBootstrap.js'
import { RailLayout } from './RailLayout.js'

/**
 * task 7.1.3's verify list, all 6 cases. `RailLayout` reads `useMeContext()`
 * transitively through `DemoBanner`, so — same as DemoBanner.test.tsx and
 * AppBootstrap.test.tsx — every case mounts it inside `AppBootstrap`, the
 * only place that context is ever provided, with `me.get` and
 * `sessions.active` stubbed via mockClient per the task's validation note.
 */
const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'America/Los_Angeles',
  preferences: {
    hideTimerDefault: false,
    endChime: true,
    visibilityContext: false,
    milestoneAnnouncements: false,
  },
  demoClockOffsetSeconds: 0,
}

const NAV_DESTINATIONS = ['Today', 'Progress', 'Research', 'Settings'] as const

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

// `window.matchMedia` is reset before every test to a deterministic desktop
// (min-width: 768px matches) stub, mirroring test/setup.ts's own
// Object.defineProperty pattern. The breakpoint test overrides it directly
// for the phone case. Resetting per test (rather than trusting setup.ts's
// module-load-time stub, which never re-runs between tests in one file)
// keeps this file's cases isolated from each other.
function stubMatchMedia(matchesDesktop: boolean): void {
  const impl = (query: string): MediaQueryList =>
    ({
      matches: query.includes('min-width: 768px') ? matchesDesktop : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: impl,
  })
}

beforeEach(() => {
  stubMatchMedia(true)
})

function buildRoutes(): RouteObject[] {
  return [
    {
      element: (
        <AppBootstrap>
          <RailLayout />
        </AppBootstrap>
      ),
      children: [
        { path: 'today', element: <h1>Today screen</h1> },
        { path: 'progress', element: <h1>Progress screen</h1> },
        { path: 'research', element: <h1>Research screen</h1> },
        { path: 'settings', element: <h1>Settings screen</h1> },
      ],
    },
  ]
}

function mount(route = '/today') {
  respond('sessions.active', null)
  respond('me.get', ME_LOCAL_DEMO)
  // `ui` is unused whenever `routes` is supplied (renderWithProviders.tsx);
  // the fragment is a placeholder to satisfy the required parameter.
  return renderWithProviders(<></>, { route, routes: buildRoutes() })
}

describe('RailLayout', () => {
  it('renders exactly four links named Today, Progress, Research, Settings with the design.md hrefs', async () => {
    mount()

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const links = within(nav).getAllByRole('link')

    expect(links).toHaveLength(4)
    expect(links.map((link) => link.textContent)).toEqual([...NAV_DESTINATIONS])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/today',
      '/progress',
      '/research',
      '/settings',
    ])
  })

  it('Tab from the skip link reaches all four links in order (user-event)', async () => {
    const { user } = mount()
    await screen.findByRole('navigation', { name: 'Main' })

    await user.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()

    for (const name of NAV_DESTINATIONS) {
      await user.tab()
      expect(screen.getByRole('link', { name })).toHaveFocus()
    }
  })

  it('the active route link has aria-current=page', async () => {
    mount('/progress')

    const activeLink = await screen.findByRole('link', { name: 'Progress' })
    expect(activeLink).toHaveAttribute('aria-current', 'page')

    const inactiveLink = screen.getByRole('link', { name: 'Today' })
    expect(inactiveLink).not.toHaveAttribute('aria-current')
  })

  it('matchMedia min-width 768px false -> nav data-placement=bottom; true -> rail', async () => {
    stubMatchMedia(false)
    mount()
    const bottomNav = await screen.findByRole('navigation', { name: 'Main' })
    expect(bottomNav).toHaveAttribute('data-placement', 'bottom')
    cleanup()

    stubMatchMedia(true)
    mount()
    const railNav = await screen.findByRole('navigation', { name: 'Main' })
    expect(railNav).toHaveAttribute('data-placement', 'rail')
  })

  it('DemoBanner is rendered before the nav', async () => {
    mount()

    const banner = await screen.findByLabelText('Demonstration data notice')
    const nav = screen.getByRole('navigation', { name: 'Main' })

    // eslint-disable-next-line no-bitwise -- Node.compareDocumentPosition's bitmask is the standard DOM-order check.
    expect(banner.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('exactly one main landmark with id main', async () => {
    mount()

    const mains = await screen.findAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main')
  })
})
