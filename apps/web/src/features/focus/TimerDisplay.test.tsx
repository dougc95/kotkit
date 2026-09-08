import { act, cleanup, render, renderHook, screen, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MeResponseValue } from '@attention-lab/shared'

// `respond` (mockClient.js) is imported BEFORE `AppBootstrap`/`LiveRegion`/
// `TimerDisplay` deliberately (matching RailLayout.test.tsx): mockClient.js
// is the file that calls `vi.mock('@/lib/api/client', ...)`, and ES module
// imports evaluate in declaration order — importing AppBootstrap first would
// let its dependency chain (lib/query/hooks.ts -> lib/api/client.ts) bind to
// the REAL client before the mock is registered, so `useMe()` would call
// through to an unmocked fetch and every case below would see AppBootstrap's
// error branch instead of the stubbed `me.get` value.
import { respond } from '../../test/mockClient.js'
import { setPrefersReducedMotion } from '../../test/setup.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { LiveRegion } from '../../ui/LiveRegion.js'
import { TimerDisplay, type TimerDisplayProps } from './TimerDisplay.js'
import { useRemaining, type RemainingSessionInput } from './useRemaining.js'

/**
 * 8.3.2's verify list, all 8 cases: 6 exercise the `TimerDisplay` component
 * (mounted inside `AppBootstrap` + `LiveRegion`, same pattern as
 * RailLayout.test.tsx/DemoBanner.test.tsx — this is the only place
 * `preferences` is ever read from), and 2 exercise `useRemaining` directly
 * with `renderHook` (same fake-timer + `performance.now` stub pattern as
 * `lib/clock/useSessionClock.test.tsx`, since it wraps that same hook).
 *
 * This file does not use `renderWithProviders` (the shared harness): that
 * helper bakes `ui` into a route table at mount time, which has no path for
 * a later prop-driven `rerender` — every case here needs to move
 * `remainingSeconds` (and the reduced-motion stub) after the initial mount,
 * so a plain `render`/`rerender` pair (holding one `QueryClient` across
 * both calls, exactly `useMilestoneAnnouncements`'s own `milestones.test.tsx`
 * precedent) is used instead.
 */

afterEach(() => {
  cleanup()
  setPrefersReducedMotion(false)
  vi.unstubAllGlobals()
})

function meFixture(overrides: Partial<MeResponseValue['preferences']> = {}): MeResponseValue {
  return {
    principalId: 'local-demo',
    identityMode: 'local-demo',
    realm: 'demo',
    timezone: 'America/Los_Angeles',
    preferences: {
      hideTimerDefault: false,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: false,
      ...overrides,
    },
    demoClockOffsetSeconds: 0,
  }
}

function tree(client: QueryClient, props: TimerDisplayProps) {
  return (
    <QueryClientProvider client={client}>
      <AppBootstrap>
        <LiveRegion>
          <TimerDisplay {...props} />
        </LiveRegion>
      </AppBootstrap>
    </QueryClientProvider>
  )
}

interface MountResult extends RenderResult {
  readonly queryClient: QueryClient
}

function mount(props: TimerDisplayProps, me: MeResponseValue = meFixture()): MountResult {
  respond('me.get', me)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(tree(queryClient, props))
  return { ...utils, queryClient }
}

/** Re-renders the SAME client (so cached state, e.g. the resolved `me.get`
 * entry, survives) with new props — the whole reason this file builds its
 * own mount helper instead of `renderWithProviders` (see the header comment). */
function rerenderWith(utils: MountResult, props: TimerDisplayProps): void {
  utils.rerender(tree(utils.queryClient, props))
}

describe('TimerDisplay', () => {
  it('hidden renders no digits', async () => {
    mount({ remainingSeconds: 600, hidden: true })

    expect(await screen.findByText('Timer hidden')).toBeInTheDocument()
    expect(screen.queryByTestId('timer-digits')).not.toBeInTheDocument()
    expect(screen.queryByText(/\d{2}:\d{2}/)).not.toBeInTheDocument()
  })

  it('chime fires exactly once at zero while hidden', async () => {
    const constructed = stubAudioContext()

    const utils = mount({ remainingSeconds: 2, hidden: true }, meFixture({ endChime: true }))
    await screen.findByText('Timer hidden')

    rerenderWith(utils, { remainingSeconds: 1, hidden: true })
    rerenderWith(utils, { remainingSeconds: 0, hidden: true })
    rerenderWith(utils, { remainingSeconds: 0, hidden: true })

    expect(constructed).toHaveBeenCalledTimes(1)
  })

  it('no element with aria-live contains the countdown digits while running', async () => {
    mount({ remainingSeconds: 600, hidden: false })

    const digits = await screen.findByTestId('timer-digits')
    expect(digits).toHaveTextContent('10:00')
    expect(digits.closest('[aria-live]')).toBeNull()
  })

  it('milestone announcement emitted only when preferences.milestoneAnnouncements is true', async () => {
    const utils = mount({ remainingSeconds: 301 }, meFixture({ milestoneAnnouncements: true }))
    await screen.findByTestId('timer-digits')

    rerenderWith(utils, { remainingSeconds: 300 })

    const region = utils.container.querySelector('[aria-live="polite"]')
    expect(region?.textContent).toBe('5 minutes remaining')
  })

  it('milestone announcement suppressed when the preference is false or absent', async () => {
    const utils = mount({ remainingSeconds: 301 }, meFixture({ milestoneAnnouncements: false }))
    await screen.findByTestId('timer-digits')

    rerenderWith(utils, { remainingSeconds: 300 })
    rerenderWith(utils, { remainingSeconds: 0 })

    const region = utils.container.querySelector('[aria-live="polite"]')
    expect(region?.textContent).toBe('')
  })

  it('prefers-reduced-motion removes transition classes', async () => {
    setPrefersReducedMotion(true)
    const utils = mount({ remainingSeconds: 600 })
    const reduced = await screen.findByTestId('timer-digits')
    expect(reduced.className).not.toMatch(/transition/)

    setPrefersReducedMotion(false)
    rerenderWith(utils, { remainingSeconds: 600 })
    const normal = screen.getByTestId('timer-digits')
    expect(normal.className).toMatch(/transition/)
  })

  it('hideTimerDefault preference seeds hidden state', async () => {
    mount({ remainingSeconds: 600 }, meFixture({ hideTimerDefault: true }))

    expect(await screen.findByText('Timer hidden')).toBeInTheDocument()
    expect(screen.queryByTestId('timer-digits')).not.toBeInTheDocument()
  })
})

describe('useRemaining', () => {
  const START_ISO = '2026-09-08T10:00:00.000Z'
  const START_MS = Date.parse(START_ISO)

  function sessionFixture(overrides: Partial<RemainingSessionInput> = {}): RemainingSessionInput {
    return {
      startedAt: START_ISO,
      targetSeconds: 1200,
      pausedSeconds: 0,
      currentPauseStartedAt: null,
      lifecycle: 'running',
      serverNow: START_ISO,
      ...overrides,
    }
  }

  it('remaining derives from server fields: 60 s pause then 90 s advance -> remaining reflects paused seconds', () => {
    let monoMs = 0
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => monoMs)

    function advance(seconds: number): void {
      act(() => {
        for (let i = 0; i < seconds; i++) {
          monoMs += 1000
          vi.advanceTimersByTime(1000)
        }
      })
    }

    try {
      const { result, rerender } = renderHook((session: RemainingSessionInput | null) => useRemaining(session), {
        initialProps: sessionFixture() as RemainingSessionInput | null,
      })

      expect(result.current).toBe(1200)

      advance(40)
      expect(result.current).toBe(1160)

      const pauseInstantMs = START_MS + 40_000
      rerender(
        sessionFixture({
          lifecycle: 'paused',
          currentPauseStartedAt: new Date(pauseInstantMs).toISOString(),
          serverNow: new Date(pauseInstantMs).toISOString(),
        }),
      )
      expect(result.current).toBe(1160)

      // 60 s paused: remaining stays frozen.
      advance(60)
      expect(result.current).toBe(1160)

      const resumeInstantMs = START_MS + 100_000
      rerender(
        sessionFixture({
          lifecycle: 'running',
          pausedSeconds: 60,
          currentPauseStartedAt: null,
          serverNow: new Date(resumeInstantMs).toISOString(),
        }),
      )
      expect(result.current).toBe(1160)

      // 90 s more running: the 60 paused seconds stay excluded.
      advance(90)
      expect(result.current).toBe(1070)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})

/**
 * Stubs `window.AudioContext` with a spy-instrumented fake (jsdom implements
 * no Web Audio API at all) and returns a spy for the constructor call count.
 */
function stubAudioContext(): ReturnType<typeof vi.fn> {
  const constructed = vi.fn()

  class FakeAudioParam {
    value = 0
  }
  class FakeOscillatorNode {
    frequency = new FakeAudioParam()
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
    addEventListener = vi.fn()
  }
  class FakeGainNode {
    gain = new FakeAudioParam()
    connect = vi.fn()
  }
  class FakeAudioContext {
    currentTime = 0
    destination = {}
    constructor() {
      constructed()
    }
    createOscillator(): FakeOscillatorNode {
      return new FakeOscillatorNode()
    }
    createGain(): FakeGainNode {
      return new FakeGainNode()
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  return constructed
}
