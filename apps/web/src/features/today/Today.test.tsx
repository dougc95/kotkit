import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type {
  CurrentProgramResponseValue,
  MeResponseValue,
  NextActionValue,
  SlotResponseValue,
  TodayResponseValue,
} from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { RailLayout } from '../../app/layouts/RailLayout.js'
import { NextAction } from './NextAction.js'
import { Today } from './Today.js'

/**
 * task 8.2.1's verify list, all 8 cases. `Today` and `NextAction` are
 * exercised in one file per the brief. Every full-`Today` case stubs
 * `programs.current`/`programs.today` via mockClient (7.1.1); the
 * table-driven case exercises `NextAction` directly with plain props,
 * needing no API stub at all.
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

const SLOT_BASELINE_A: SlotResponseValue = {
  id: 'slot-baseline-a',
  phase: 'baseline',
  label: 'A',
  materialRef: 'Article A',
  language: null,
  deviceFormat: null,
  materialLevel: null,
  plannedLocalTime: null,
  assignedLocalDate: '2026-09-01',
  frozenAt: null,
  attempts: [],
}
const SLOT_BASELINE_B: SlotResponseValue = { ...SLOT_BASELINE_A, id: 'slot-baseline-b', label: 'B' }
const SLOT_FINAL_A: SlotResponseValue = {
  ...SLOT_BASELINE_A,
  id: 'slot-final-a',
  phase: 'final',
  label: 'A',
  assignedLocalDate: '2026-09-14',
}
const SLOT_FINAL_B: SlotResponseValue = { ...SLOT_FINAL_A, id: 'slot-final-b', label: 'B' }
const ALL_SLOTS: SlotResponseValue[] = [SLOT_BASELINE_A, SLOT_BASELINE_B, SLOT_FINAL_A, SLOT_FINAL_B]

function currentFixture(
  nextAction: NextActionValue,
  overrides: Partial<CurrentProgramResponseValue> = {},
): CurrentProgramResponseValue {
  return {
    program: {
      id: 'program-1',
      realm: 'demo',
      status: 'baseline_ready',
      baselineDate: '2026-09-01',
      timezone: 'America/Los_Angeles',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'rev-1',
      version: 1,
    },
    revision: {
      id: 'rev-1',
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial plan',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    slots: ALL_SLOTS,
    day: 0,
    nextAction,
    ...overrides,
  }
}

function todayFixture(nextAction: NextActionValue, overrides: Partial<TodayResponseValue> = {}): TodayResponseValue {
  return {
    day: 0,
    localDate: '2026-09-01',
    blocks: [
      { index: 1, status: 'not_started', targetSeconds: 900, sessionId: null },
      { index: 2, status: 'not_started', targetSeconds: 900, sessionId: null },
    ],
    checkin: {
      status: 'not_reported',
      missing: ['sleep', 'feed'],
      values: { sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null },
    },
    nextAction,
    ...overrides,
  }
}

function basicRoutes(): RouteObject[] {
  return [
    { path: 'today', element: <Today /> },
    { path: 'setup', element: <h1>Setup screen</h1> },
  ]
}

function mountToday(route = '/today') {
  return renderWithProviders(<></>, { route, routes: basicRoutes() })
}

function navRoutes(): RouteObject[] {
  return [
    {
      element: (
        <AppBootstrap>
          <RailLayout />
        </AppBootstrap>
      ),
      children: [
        { path: 'today', element: <Today /> },
        { path: 'progress', element: <h1>Progress screen</h1> },
        { path: 'research', element: <h1>Research screen</h1> },
        { path: 'settings', element: <h1>Settings screen</h1> },
      ],
    },
  ]
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render.
afterEach(() => {
  cleanup()
})

describe('NextAction', () => {
  it('renders exactly one primary control with the right href for each nextAction value (setup, readiness, benchmark, practice, final, progress)', async () => {
    const cases: Array<{ nextAction: NextActionValue; role: 'link' | 'button'; name: string; href?: string }> = [
      { nextAction: { kind: 'setup' }, role: 'link', name: 'Set up your program', href: '/setup' },
      { nextAction: { kind: 'readiness' }, role: 'link', name: 'Finish readiness', href: '/setup/readiness' },
      {
        nextAction: { kind: 'benchmark', slotId: 'slot-baseline-a' },
        role: 'link',
        name: 'Start with your baseline',
        href: '/benchmark/slot-baseline-a',
      },
      { nextAction: { kind: 'practice', block: 1 }, role: 'button', name: 'Block 1 is next' },
      {
        nextAction: { kind: 'final', slotId: 'slot-final-a' },
        role: 'link',
        name: 'Final benchmark A',
        href: '/benchmark/slot-final-a',
      },
      { nextAction: { kind: 'progress' }, role: 'link', name: 'View your progress', href: '/progress' },
    ]

    for (const testCase of cases) {
      const onFocusBlock = vi.fn()
      const { user } = renderWithProviders(
        <NextAction
          nextAction={testCase.nextAction}
          programId="program-1"
          slots={ALL_SLOTS}
          onFocusBlock={onFocusBlock}
        />,
      )

      if (testCase.role === 'link') {
        const link = screen.getByRole('link', { name: testCase.name })
        expect(link).toHaveAttribute('href', testCase.href)
        expect(screen.queryAllByRole('link')).toHaveLength(1)
        expect(screen.queryAllByRole('button')).toHaveLength(0)
      } else {
        const button = screen.getByRole('button', { name: testCase.name })
        expect(screen.queryAllByRole('button')).toHaveLength(1)
        expect(screen.queryAllByRole('link')).toHaveLength(0)
        await user.click(button)
        expect(onFocusBlock).toHaveBeenCalledWith(1)
      }

      cleanup()
    }
  })
})

describe('Today', () => {
  it('new user shows Start with your baseline and no element matching /%|improv|attention \\+/', async () => {
    respond('programs.current', currentFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))
    respond('programs.today', todayFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))

    mountToday()

    await screen.findByRole('link', { name: 'Start with your baseline' })
    expect(document.body.textContent ?? '').not.toMatch(/%|improv|attention \+/i)
  })

  it('Day 6 after a missed Day 5 renders block 1 as next with no /streak|lost|broken|restart|behind/i text', async () => {
    respond('programs.current', currentFixture({ kind: 'practice', block: 1 }))
    respond('programs.today', todayFixture({ kind: 'practice', block: 1 }, { day: 6 }))

    mountToday()

    await screen.findByRole('button', { name: 'Block 1 is next' })
    expect(document.body.textContent ?? '').not.toMatch(/streak|lost|broken|restart|behind/i)
  })

  it('Day 14 renders final A as the next action and still renders two block cards', async () => {
    respond('programs.current', currentFixture({ kind: 'final', slotId: 'slot-final-a' }))
    respond('programs.today', todayFixture({ kind: 'final', slotId: 'slot-final-a' }, { day: 14 }))

    mountToday()

    await screen.findByRole('link', { name: 'Final benchmark A' })
    expect(screen.getAllByTestId('block-card-slot')).toHaveLength(2)
  })

  it('Day N of 14 uses the server day field even when the browser date differs', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:00.000Z'))

    respond('programs.current', currentFixture({ kind: 'progress' }))
    respond('programs.today', todayFixture({ kind: 'progress' }, { day: 9 }))

    mountToday()

    await screen.findByRole('heading', { name: 'Day 9 of 14' })

    dateNowSpy.mockRestore()
  })

  it('nav exposes four destinations Today/Progress/Research/Settings reachable by Tab', async () => {
    respond('me.get', ME_LOCAL_DEMO)
    respond('programs.current', currentFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))
    respond('programs.today', todayFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))

    const { user } = renderWithProviders(<></>, { route: '/today', routes: navRoutes() })

    await screen.findByRole('link', { name: 'Start with your baseline' })

    await user.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()

    for (const name of ['Today', 'Progress', 'Research', 'Settings']) {
      await user.tab()
      expect(screen.getByRole('link', { name })).toHaveFocus()
    }
  })

  it('nextAction setup or 404 redirects to /setup', async () => {
    respond(
      'programs.current',
      currentFixture({ kind: 'setup' }, { program: null, revision: null, slots: [], day: null }),
    )

    mountToday()
    await screen.findByRole('heading', { name: 'Setup screen' })
    cleanup()

    reject('programs.current', { status: 404, code: 'not_found' })

    mountToday()
    await screen.findByRole('heading', { name: 'Setup screen' })
  })

  it('fetch failure renders Retry and refetches on click', async () => {
    reject('programs.current', { status: 500, code: 'server_error' })

    const { user } = mountToday()

    await screen.findByText('Today could not be loaded')
    expect(mockApi.programs.current).toHaveBeenCalledTimes(1)

    respond('programs.current', currentFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))
    respond('programs.today', todayFixture({ kind: 'benchmark', slotId: 'slot-baseline-a' }))

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByRole('link', { name: 'Start with your baseline' })
    expect(mockApi.programs.current).toHaveBeenCalledTimes(2)
  })
})
