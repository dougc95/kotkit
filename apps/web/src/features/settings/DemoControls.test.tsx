import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/keys.js` and this file's own
// `DemoControls.js`): `vi.mock('@/lib/api/client', ...)` inside this module
// only intercepts imports of that module requested AFTER it runs, mirroring
// AbandonSession.test.tsx/DemoBanner.test.tsx's own import ordering.
import { mockApi, respond } from '../../test/mockClient.js'

import type { CurrentProgramResponseValue, MeResponseValue, SlotResponseValue } from '@attention-lab/shared'
import { enqueue, listUnsent } from '../../lib/outbox/store.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { DemoControls } from './DemoControls.js'

/**
 * task 8.9.3's verify list, all 8 named cases.
 *
 * jsdom has no `ResizeObserver` (a real browser always does); Radix's
 * `Select` content measures itself via `@radix-ui/react-use-size`/
 * `react-popper` whenever it opens (`PracticeReview.test.tsx`'s own
 * rationale for the same stub, scoped to this file rather than the shared,
 * off-limits `src/test/setup.ts`). jsdom also has no `hasPointerCapture`/
 * `releasePointerCapture`/`scrollIntoView` — Radix's `SelectTrigger`
 * unconditionally calls `target.hasPointerCapture(...)` on pointerdown and
 * `SelectContent` calls `scrollIntoView` while positioning the open list —
 * so both are stubbed as plain functions (not `vi.fn()`, so `setup.ts`'s
 * global `vi.resetAllMocks()` afterEach never wipes them, mirroring
 * `setup.ts`'s own `matchMedia` stub).
 */
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

// Mirrors AbandonSession.test.tsx's own choice of `fake-indexeddb` (not
// `src/test/fakeOutbox.ts`'s in-memory stand-in) so `ResetPanel`'s real
// `purgeOtherSessions` (7.3.1), reached through the mounted component and
// never mocked here, purges a real (fake) IndexedDB while only `api.*`
// (`mockClient.ts`) is stubbed.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// `test.globals: true` is not set (vitest.config.ts) — Testing Library's
// framework-detected auto-cleanup never activates, so every component test
// file here calls `cleanup()` itself (DemoBanner.test.tsx's pattern).
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo-principal',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'UTC',
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

function makeFinalSlotA(overrides: Partial<SlotResponseValue> = {}): SlotResponseValue {
  return {
    id: 'slot-final-a',
    phase: 'final',
    label: 'A',
    materialRef: 'Final A — assigned reading',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: '09:00',
    assignedLocalDate: '2026-09-15',
    frozenAt: null,
    attempts: [],
    ...overrides,
  }
}

function programResponse(slots: SlotResponseValue[]): CurrentProgramResponseValue {
  return {
    program: {
      id: 'program-1',
      realm: 'demo',
      status: 'active',
      baselineDate: '2026-09-01',
      timezone: 'UTC',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'revision-1',
      version: 1,
    },
    revision: null,
    slots,
    day: 4,
    nextAction: { kind: 'progress' },
  }
}

async function selectScenario(user: ReturnType<typeof renderWithProviders>['user'], optionName: string) {
  await user.click(screen.getByRole('combobox', { name: 'Demonstration scenario' }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('DemoControls', () => {
  it('not rendered when identityMode is not local-demo', () => {
    renderWithProviders(<DemoControls me={ME_REAL} />)

    expect(screen.queryByText('Demonstration controls')).not.toBeInTheDocument()
    expect(mockApi.programs.current).not.toHaveBeenCalled()
  })

  it("Skip to Day 14 posts the offset mapping now to the final date at final slot A's planned_local_time in the program timezone", async () => {
    respond('programs.current', programResponse([makeFinalSlotA({ plannedLocalTime: '09:00' })]))
    respond('demo.clock', { demoClockOffsetSeconds: 637_200 })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00.000Z'))

    const { user } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)
    await screen.findByRole('button', { name: 'Skip to Day 14' })

    await user.click(screen.getByRole('button', { name: 'Skip to Day 14' }))

    // baselineDate 2026-09-01 + 14 days = final date 2026-09-15; 09:00 UTC
    // on that date minus the frozen "now" (2026-09-08T00:00:00.000Z) is
    // 7 days and 9 hours: 7*86400 + 9*3600 = 637200 seconds.
    await waitFor(() => expect(mockApi.demo.clock).toHaveBeenCalledWith({ offsetSeconds: 637_200 }))
  })

  it('Skip to Day 14 falls back to 00:00 when planned_local_time is not set', async () => {
    respond('programs.current', programResponse([makeFinalSlotA({ plannedLocalTime: null })]))
    respond('demo.clock', { demoClockOffsetSeconds: 604_800 })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-08T00:00:00.000Z'))

    const { user } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)
    await screen.findByRole('button', { name: 'Skip to Day 14' })

    await user.click(screen.getByRole('button', { name: 'Skip to Day 14' }))

    // Same final date (2026-09-15) but at 00:00 UTC: 7*86400 = 604800 seconds.
    await waitFor(() => expect(mockApi.demo.clock).toHaveBeenCalledWith({ offsetSeconds: 604_800 }))
  })

  it('Reset clock posts offsetSeconds 0', async () => {
    respond('programs.current', NO_PROGRAM)
    respond('demo.clock', { demoClockOffsetSeconds: 0 })

    const { user } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)
    await user.click(screen.getByRole('button', { name: 'Reset clock' }))

    await waitFor(() => expect(mockApi.demo.clock).toHaveBeenCalledWith({ offsetSeconds: 0 }))
  })

  it('Load without confirmation posts nothing', async () => {
    respond('programs.current', NO_PROGRAM)

    const { user } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)
    await user.click(screen.getByRole('button', { name: 'Load scenario' }))
    await screen.findByRole('alertdialog')

    expect(mockApi.demo.loadScenario).not.toHaveBeenCalled()
  })

  it('confirmed Load posts to /demo/scenarios/{name}/load with no body, clears the cache and navigates to /progress', async () => {
    respond('programs.current', NO_PROGRAM)
    respond('demo.loadScenario', { programId: 'program-loaded' })

    const { user, router, queryClient } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />, {
      route: '/settings',
      routes: [
        { path: '/settings', element: <DemoControls me={ME_LOCAL_DEMO} /> },
        { path: '/progress', element: <div>Progress screen</div> },
      ],
    })
    const clearSpy = vi.spyOn(queryClient, 'clear')

    await selectScenario(user, 'Working Day')
    await user.click(screen.getByRole('button', { name: 'Load scenario' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(mockApi.demo.loadScenario).toHaveBeenCalledWith('working-day'))
    expect(mockApi.demo.loadScenario).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(clearSpy).toHaveBeenCalled())
    await waitFor(() => expect(router.state.location.pathname).toBe('/progress'))
    await screen.findByText('Progress screen')
  })

  it('confirmed Reset posts /demo/reset, clears the cache, purges the outbox and every finalize:{sessionId} sessionStorage key, and navigates to /today', async () => {
    respond('programs.current', NO_PROGRAM)
    respond('demo.reset', undefined)

    sessionStorage.setItem('finalize:session-a', 'key-a')
    sessionStorage.setItem('finalize:session-b', 'key-b')
    await enqueue('session-a', { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T09:01:00.000Z' })
    await enqueue('session-b', { type: 'external', elapsedMs: 2000, occurredAt: '2026-09-08T09:02:00.000Z' })

    const { user, router, queryClient } = renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />, {
      route: '/settings',
      routes: [
        { path: '/settings', element: <DemoControls me={ME_LOCAL_DEMO} /> },
        { path: '/today', element: <div>Today screen</div> },
      ],
    })
    const clearSpy = vi.spyOn(queryClient, 'clear')

    await user.click(screen.getByRole('button', { name: 'Reset demo data' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(mockApi.demo.reset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(clearSpy).toHaveBeenCalled())
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    await screen.findByText('Today screen')

    expect(sessionStorage.getItem('finalize:session-a')).toBeNull()
    expect(sessionStorage.getItem('finalize:session-b')).toBeNull()
    expect(await listUnsent('session-a')).toHaveLength(0)
    expect(await listUnsent('session-b')).toHaveLength(0)
  })

  it('the demo label is present on the panel', async () => {
    respond('programs.current', NO_PROGRAM)

    renderWithProviders(<DemoControls me={ME_LOCAL_DEMO} />)

    const heading = await screen.findByRole('heading', { name: 'Demonstration controls' })
    expect(heading.textContent?.toLowerCase()).toContain('demo')
  })
})
