import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { MeResponseValue } from '@attention-lab/shared'

import { mockApi, reject, respond } from '../test/mockClient.js'
import { renderWithProviders } from '../test/renderWithProviders.js'
import { AppBootstrap } from './AppBootstrap.js'

/**
 * task 7.1.2's verify list: 'children are not rendered until /me resolves'
 * and '/me failure shows Could not reach the server and Retry refetches
 * exactly once'. `sessions.active` is stubbed to resolve `null` in every
 * case per the task's own validation note — `AppBootstrap` never calls it
 * itself, but `SessionModeProvider` (7.4.2) fetches it at the app root in
 * the real composition, so the mock stays configured here for parity.
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

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render.
afterEach(() => {
  cleanup()
})

describe('AppBootstrap', () => {
  it('children are not rendered until /me resolves', async () => {
    respond('sessions.active', null)
    let resolveMe: (value: MeResponseValue) => void = () => {}
    mockApi.me.get.mockImplementation(
      () =>
        new Promise<MeResponseValue>((resolve) => {
          resolveMe = resolve
        }),
    )

    renderWithProviders(
      <AppBootstrap>
        <div>Protected content</div>
      </AppBootstrap>,
    )

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    resolveMe(ME_LOCAL_DEMO)

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument())
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('/me failure shows Could not reach the server and Retry refetches exactly once', async () => {
    respond('sessions.active', null)
    reject('me.get', { status: 500, code: 'server_error' })

    const { user } = renderWithProviders(
      <AppBootstrap>
        <div>Protected content</div>
      </AppBootstrap>,
    )

    await waitFor(() => expect(screen.getByText('Could not reach the server')).toBeInTheDocument())
    expect(mockApi.me.get).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    respond('me.get', ME_LOCAL_DEMO)
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument())
    expect(mockApi.me.get).toHaveBeenCalledTimes(2)
  })
})
