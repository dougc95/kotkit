import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { CurrentProgramResponseValue, MeResponseValue } from '@attention-lab/shared'

import { respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { Settings } from './Settings.js'

// Mirrors DemoControls.test.tsx's own rationale: jsdom has no
// ResizeObserver/hasPointerCapture/scrollIntoView, and Radix's Select
// (reached here through DemoControls -> ScenarioLoader in local-demo mode)
// needs all three whenever it measures itself.
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
  it('renders exactly one primary action across the composed Preferences and Change practice duration sections', async () => {
    const { container } = mount(ME_REAL, activeProgramResponse())

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
