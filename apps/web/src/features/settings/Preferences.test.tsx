import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { CurrentProgramResponseValue, MeResponseValue, PatchPreferencesBodyValue } from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Preferences } from './Preferences.js'

/**
 * task 8.9.2's verify list, all 8 named cases. `Preferences` is
 * self-contained given a `me` prop (no `useMeContext()`), so every case
 * mounts it directly (ResearchCards.test.tsx's pattern) rather than through
 * `Settings.tsx` or a router table.
 *
 * jsdom has no `ResizeObserver` (a real browser always does); Radix's
 * `Switch` mounts a hidden bubble-input that measures its control via
 * `@radix-ui/react-use-size` whenever the switch sits inside a `<form>`
 * (this screen's), so this file — not the shared, off-limits
 * `src/test/setup.ts` — stubs it, scoped to this test file only.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

const BASE_ME: MeResponseValue = {
  principalId: 'local-demo',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'America/New_York',
  preferences: {
    hideTimerDefault: false,
    endChime: true,
    visibilityContext: false,
    milestoneAnnouncements: false,
  },
  demoClockOffsetSeconds: 0,
}

const NO_PROGRAM: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

function openProgramResponse(): CurrentProgramResponseValue {
  return {
    program: {
      id: 'program-1',
      realm: 'demo',
      status: 'active',
      baselineDate: '2026-09-01',
      timezone: 'America/New_York',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'revision-1',
      version: 1,
    },
    revision: null,
    slots: [],
    day: 4,
    nextAction: { kind: 'progress' },
  }
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

function mount(me: MeResponseValue = BASE_ME, program: CurrentProgramResponseValue = NO_PROGRAM) {
  respond('programs.current', program)
  return renderWithProviders(<Preferences me={me} />)
}

/** The most recent `api.me.patchPreferences(body)` call's argument. */
function lastPatchBody(): PatchPreferencesBodyValue {
  const calls = mockApi.me.patchPreferences.mock.calls
  const call = calls[calls.length - 1]
  if (call === undefined) {
    throw new Error('api.me.patchPreferences was never called')
  }
  return call[0] as PatchPreferencesBodyValue
}

describe('Preferences', () => {
  it('loads current values from /me including milestoneAnnouncements', async () => {
    const me: MeResponseValue = {
      ...BASE_ME,
      timezone: 'Europe/Berlin',
      preferences: {
        hideTimerDefault: true,
        endChime: false,
        visibilityContext: true,
        milestoneAnnouncements: true,
      },
    }
    mount(me)

    expect(await screen.findByLabelText('Timezone')).toHaveValue('Europe/Berlin')
    expect(screen.getByRole('switch', { name: 'Hide timer by default' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'End-of-block chime' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Record tab-visibility context' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Milestone timer announcements' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('Save sends only the changed fields', async () => {
    respond('me.patchPreferences', { ...BASE_ME, preferences: { ...BASE_ME.preferences, hideTimerDefault: true } })
    const { user } = mount()

    await user.click(screen.getByRole('switch', { name: 'Hide timer by default' }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => expect(mockApi.me.patchPreferences).toHaveBeenCalledTimes(1))
    expect(lastPatchBody()).toEqual({ hideTimerDefault: true })
  })

  it('visibilityContext defaults off and toggling sends visibilityContext: true', async () => {
    respond('me.patchPreferences', { ...BASE_ME, preferences: { ...BASE_ME.preferences, visibilityContext: true } })
    const { user } = mount()

    expect(screen.getByRole('switch', { name: 'Record tab-visibility context' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await user.click(screen.getByRole('switch', { name: 'Record tab-visibility context' }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => expect(mockApi.me.patchPreferences).toHaveBeenCalledTimes(1))
    expect(lastPatchBody()).toEqual({ visibilityContext: true })
  })

  it('milestoneAnnouncements toggles independently of endChime and hideTimerDefault', async () => {
    respond('me.patchPreferences', {
      ...BASE_ME,
      preferences: { ...BASE_ME.preferences, milestoneAnnouncements: true },
    })
    const { user } = mount()

    await user.click(screen.getByRole('switch', { name: 'Milestone timer announcements' }))

    expect(screen.getByRole('switch', { name: 'Milestone timer announcements' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Hide timer by default' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'End-of-block chime' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => expect(mockApi.me.patchPreferences).toHaveBeenCalledTimes(1))
    expect(lastPatchBody()).toEqual({ milestoneAnnouncements: true })
  })

  it('invalid timezone 400 shows a field error', async () => {
    reject('me.patchPreferences', {
      status: 400,
      code: 'malformed_request',
      fieldErrors: { timezone: ['Not a valid timezone.'] },
    })
    const { user } = mount()

    await user.selectOptions(screen.getByLabelText('Timezone'), 'Europe/Berlin')
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid timezone.')
  })

  it('Save is the only primary action', async () => {
    mount()

    await screen.findByLabelText('Timezone')
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Save preferences')
    expect(buttons[0]).toHaveAttribute('data-variant', 'primary')
  })

  it('the timezone helper copy says program days do not move', async () => {
    mount()

    expect(
      await screen.findByText('Changing your timezone does not move program days'),
    ).toBeInTheDocument()
  })

  it('Edit benchmark materials links to /setup/readiness and is hidden with no open program', async () => {
    mount(BASE_ME, openProgramResponse())

    const link = await screen.findByRole('link', { name: 'Edit benchmark materials' })
    expect(link).toHaveAttribute('href', '/setup/readiness')

    cleanup()

    const { queryClient } = mount(BASE_ME, NO_PROGRAM)
    // Wait for GET /programs/current to actually settle (rather than
    // asserting absence purely from the un-resolved pending state, which
    // would pass trivially) before confirming the link never appears for a
    // resolved `{ program: null }` response.
    await waitFor(() => expect(queryClient.getQueryState(queryKeys.programs.current)?.status).toBe('success'))
    expect(screen.queryByRole('link', { name: 'Edit benchmark materials' })).not.toBeInTheDocument()
  })
})
