import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { MeResponseValue } from '@attention-lab/shared'

import { expectNoIdentifiers } from '../test/expectNoIdentifiers.js'
import { respond } from '../test/mockClient.js'
import { renderWithProviders } from '../test/renderWithProviders.js'
import { AppBootstrap } from './AppBootstrap.js'
import { DemoBanner } from './DemoBanner.js'

/**
 * task 7.1.2's verify list: the four DemoBanner cases. Rendered inside
 * `AppBootstrap` (the only place `useMeContext()` is ever provided) so each
 * case exercises the real composition, not a hand-rolled context stub.
 * `sessions.active` is stubbed to resolve `null` per the task's own
 * validation note (see AppBootstrap.test.tsx's header comment).
 */
const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo-principal',
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

const ME_REAL: MeResponseValue = {
  ...ME_LOCAL_DEMO,
  identityMode: 'real',
  realm: 'pilot',
}

// `renderWithProviders` mounts a fresh tree per test but jsdom's shared
// `document` otherwise accumulates every test's DOM (this harness does not
// run with `test.globals: true`, so Testing Library's framework-detected
// auto-cleanup never activates — see router.test.tsx's manual `cleanup()`
// for the same reason).
afterEach(() => {
  cleanup()
})

function mountBanner(me: MeResponseValue) {
  respond('sessions.active', null)
  respond('me.get', me)
  return renderWithProviders(
    <AppBootstrap>
      <DemoBanner />
    </AppBootstrap>,
  )
}

describe('DemoBanner', () => {
  it('identityMode local-demo renders the banner containing "demonstration" and "not a real measurement"', async () => {
    mountBanner(ME_LOCAL_DEMO)

    const banner = await screen.findByLabelText('Demonstration data notice')
    const text = banner.textContent?.toLowerCase() ?? ''
    expect(text).toContain('demonstration')
    expect(text).toContain('not a real measurement')
  })

  it('banner has aria-label "Demonstration data notice" and no live-region role', async () => {
    mountBanner(ME_LOCAL_DEMO)

    const banner = await screen.findByLabelText('Demonstration data notice')
    expect(banner).toHaveAttribute('aria-label', 'Demonstration data notice')
    expect(banner).not.toHaveAttribute('aria-live')
    expect(banner.getAttribute('role')).not.toBe('status')
    expect(banner.getAttribute('role')).not.toBe('alert')
  })

  it('identityMode other than local-demo renders no banner', async () => {
    mountBanner(ME_REAL)

    await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument())
    expect(screen.queryByLabelText('Demonstration data notice')).not.toBeInTheDocument()
  })

  it('banner text contains neither the principalId nor the strings realm/principal', async () => {
    mountBanner(ME_LOCAL_DEMO)

    const banner = await screen.findByLabelText('Demonstration data notice')
    expectNoIdentifiers(banner)
    const text = banner.textContent?.toLowerCase() ?? ''
    expect(text).not.toContain('realm')
    expect(text).not.toContain('principal')
    expect(banner.textContent).not.toContain(ME_LOCAL_DEMO.principalId)
  })
})
