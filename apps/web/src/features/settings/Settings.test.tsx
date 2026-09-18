import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { CurrentProgramResponseValue, MeResponseValue } from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { Settings } from './Settings.js'

// Mirrors DemoControls.test.tsx's own rationale: jsdom has no
// ResizeObserver/hasPointerCapture/setPointerCapture/releasePointerCapture/
// scrollIntoView, and Radix's Select (reached here through DemoControls ->
// ScenarioLoader in local-demo mode) needs all of them whenever it measures
// or positions itself. Keep this block identical to DemoControls.test.tsx's
// copy (C-I5/task-F1 item 12) - if one gains a stub the other needs, copy it
// here too, so a test that opens the scenario Select does not fail on a
// missing polyfill with an error that points at Radix instead of at this gap.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
if (typeof window !== 'undefined') {
  if (typeof window.HTMLElement.prototype.hasPointerCapture !== 'function') {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (typeof window.HTMLElement.prototype.setPointerCapture !== 'function') {
    window.HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (typeof window.HTMLElement.prototype.releasePointerCapture !== 'function') {
    window.HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
}

afterEach(() => {
  cleanup()
})

const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo-principal',
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

const ME_REAL: MeResponseValue = { ...ME_LOCAL_DEMO, identityMode: 'real', realm: 'pilot' }

const NO_PROGRAM: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

function activeProgramResponse(): CurrentProgramResponseValue {
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
    revision: {
      id: 'revision-1',
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    slots: [],
    day: 8,
    nextAction: { kind: 'practice', block: 1 },
  }
}

function mount(me: MeResponseValue, program: CurrentProgramResponseValue = NO_PROGRAM) {
  respond('me.get', me)
  respond('programs.current', program)
  return renderWithProviders(<Settings />)
}

describe('Settings', () => {
  it('while GET /me is pending, an aria-busy region shows the visible label Loading (guard: bare placeholder already carried both)', () => {
    mockApi.me.get.mockReturnValue(new Promise(() => {}))

    renderWithProviders(<Settings />)

    const region = screen.getByText('Loading').closest('[aria-busy="true"]')
    expect(region).not.toBeNull()
  })

  it('GET /me failure renders through the shared ErrorState: role alert, message unchanged, exactly one Retry', async () => {
    reject('me.get', { status: 500, code: 'server_error' })

    renderWithProviders(<Settings />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Settings could not be loaded')
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('renders exactly one primary action across the composed Preferences and Change practice duration sections', async () => {
    const { container } = mount(ME_REAL, activeProgramResponse())

    await screen.findByLabelText('Timezone')
    await screen.findByRole('radio', { name: '15 minutes' })

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveTextContent('Save preferences')
  })

  it('renders exactly one primary action for a local-demo principal, the only mode this repository runs', async () => {
    const { container } = mount(ME_LOCAL_DEMO, activeProgramResponse())

    await screen.findByLabelText('Timezone')
    await screen.findByRole('radio', { name: '15 minutes' })

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveTextContent('Save preferences')
  })

  it('does not render Demo controls for a real-identity principal', async () => {
    mount(ME_REAL)

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.queryByText('Demonstration controls')).not.toBeInTheDocument()
  })

  it('renders Demo controls for a local-demo principal', async () => {
    mount(ME_LOCAL_DEMO)

    expect(await screen.findByRole('heading', { name: 'Demonstration controls' })).toBeInTheDocument()
  })
})
