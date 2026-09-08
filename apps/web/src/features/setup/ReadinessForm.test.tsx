import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type {
  BenchmarkPhase,
  CurrentProgramResponseValue,
  ProgramResponseValue,
  PutSlotsResponseValue,
  SlotLabel,
  SlotResponseValue,
} from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { ReadinessForm } from './ReadinessForm.js'

/**
 * task 8.1.3's verify list, all 9 named cases. `ReadinessForm` mounted
 * directly (no `AppBootstrap` — it reads no `useMeContext()`), with a real
 * route table so navigation to `/today` can be asserted (RailLayout.test.tsx's
 * "ui is unused whenever routes is supplied" pattern).
 */

function buildRoutes(): RouteObject[] {
  return [
    { path: '/setup/readiness', element: <ReadinessForm /> },
    { path: '/setup', element: <h1>Setup screen</h1> },
    { path: '/today', element: <h1>Today screen</h1> },
  ]
}

function mount(current: CurrentProgramResponseValue) {
  respond('programs.current', current)
  // `ui` is unused whenever `routes` is supplied (renderWithProviders.tsx).
  return renderWithProviders(<></>, { route: '/setup/readiness', routes: buildRoutes() })
}

function makeProgram(overrides: Partial<ProgramResponseValue> = {}): ProgramResponseValue {
  return {
    id: 'prog-1',
    realm: 'demo',
    status: 'draft',
    baselineDate: '2026-09-06',
    timezone: 'America/Los_Angeles',
    leisureAllowanceMinutes: 30,
    feedEstimateMinutes: null,
    currentRevisionId: 'rev-1',
    version: 1,
    ...overrides,
  }
}

function makeSlot(
  phase: BenchmarkPhase,
  label: SlotLabel,
  overrides: Partial<SlotResponseValue> = {},
): SlotResponseValue {
  return {
    id: `slot-${phase}-${label}`,
    phase,
    label,
    materialRef: '',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: null,
    assignedLocalDate: phase === 'final' ? '2026-09-20' : '2026-09-06',
    frozenAt: null,
    attempts: [],
    ...overrides,
  }
}

function fourBlankSlots(): SlotResponseValue[] {
  return [makeSlot('baseline', 'A'), makeSlot('baseline', 'B'), makeSlot('final', 'A'), makeSlot('final', 'B')]
}

function makeCurrent(program: ProgramResponseValue, slots: SlotResponseValue[]): CurrentProgramResponseValue {
  return { program, revision: null, slots, day: 0, nextAction: { kind: 'readiness' } }
}

async function fillMaterialRef(
  user: ReturnType<typeof renderWithProviders>['user'],
  title: string,
  value: string,
): Promise<void> {
  const group = screen.getByRole('group', { name: title })
  const input = within(group).getByLabelText('Material reference')
  await user.clear(input)
  await user.type(input, value)
}

async function fillTime(
  user: ReturnType<typeof renderWithProviders>['user'],
  title: string,
  value: string,
): Promise<void> {
  const input = screen.getByLabelText(`${title} planned time`)
  await user.clear(input)
  await user.type(input, value)
}

/** Fills every one of the four rows with valid, mutually-consistent data (baseline A/B two hours apart). */
async function fillAllRowsComplete(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await fillMaterialRef(user, 'Baseline A', 'Chapter 3, pages 1-10')
  await fillTime(user, 'Baseline A', '09:00')
  await fillMaterialRef(user, 'Baseline B', 'Chapter 4, pages 1-10')
  await fillTime(user, 'Baseline B', '18:00')
  await fillMaterialRef(user, 'Final A', 'Chapter 9, pages 1-10')
  await fillMaterialRef(user, 'Final B', 'Chapter 10, pages 1-10')
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

describe('ReadinessForm', () => {
  it('two blank references -> stays on page and lists exactly baseline B and final B as missing', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user, router } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    await fillMaterialRef(user, 'Baseline A', 'Chapter 3, pages 1-10')
    await fillTime(user, 'Baseline A', '09:00')
    await fillMaterialRef(user, 'Final A', 'Chapter 9, pages 1-10')
    // Baseline B and Final B stay blank.

    const response: PutSlotsResponseValue = {
      program: { ...current.program!, status: 'draft', version: 2 },
      slots: current.slots,
      missing: [
        { phase: 'baseline', label: 'B', fields: ['materialRef', 'plannedLocalTime'] },
        { phase: 'final', label: 'B', fields: ['materialRef'] },
      ],
    }
    respond('programs.putSlots', response)

    await user.click(screen.getByRole('button', { name: /save/i }))

    const missingList = await screen.findByRole('list', { name: 'Missing slots' })
    expect(within(missingList).getByText('Baseline B')).toBeInTheDocument()
    expect(within(missingList).getByText('Final B')).toBeInTheDocument()
    expect(within(missingList).queryByText('Baseline A')).not.toBeInTheDocument()
    expect(within(missingList).queryByText('Final A')).not.toBeInTheDocument()

    expect(router.state.location.pathname).toBe('/setup/readiness')
    expect(mockApi.programs.putSlots).toHaveBeenCalledTimes(1)
    const [, body] = mockApi.programs.putSlots.mock.calls[0] as [string, { slots: unknown[] }]
    expect(body.slots).toHaveLength(2)
  })

  it('baseline times 30 min apart -> one-hour message and no request', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    await fillMaterialRef(user, 'Baseline A', 'Ref A')
    await fillTime(user, 'Baseline A', '09:00')
    await fillMaterialRef(user, 'Baseline B', 'Ref B')
    await fillTime(user, 'Baseline B', '09:30')

    await user.click(screen.getByRole('button', { name: /save/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/at least one hour apart/i)
    expect(mockApi.programs.putSlots).not.toHaveBeenCalled()
  })

  it('final times prefilled from baseline and follow baseline edits until touched', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    const baselineATime = screen.getByLabelText('Baseline A planned time')
    const finalATime = screen.getByLabelText('Final A planned time')

    await user.type(baselineATime, '09:00')
    expect(finalATime).toHaveValue('09:00')

    await user.clear(baselineATime)
    await user.type(baselineATime, '10:00')
    expect(finalATime).toHaveValue('10:00')

    await user.clear(finalATime)
    await user.type(finalATime, '11:00')
    expect(finalATime).toHaveValue('11:00')

    await user.clear(baselineATime)
    await user.type(baselineATime, '12:00')
    expect(finalATime).toHaveValue('11:00')
  })

  it('response status baseline_ready -> navigates to /today and POST /sessions never called', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user, router } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    await fillAllRowsComplete(user)

    const response: PutSlotsResponseValue = {
      program: { ...current.program!, status: 'baseline_ready', version: 2 },
      slots: current.slots,
      missing: [],
    }
    respond('programs.putSlots', response)

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(mockApi.sessions.create).not.toHaveBeenCalled()
  })

  it('frozen slot renders read-only with the frozen explanation', async () => {
    const current = makeCurrent(makeProgram({ status: 'active' }), [
      makeSlot('baseline', 'A', {
        materialRef: 'Ref A',
        plannedLocalTime: '09:00',
        frozenAt: '2026-09-06T09:00:00.000Z',
      }),
      makeSlot('baseline', 'B'),
      makeSlot('final', 'A'),
      makeSlot('final', 'B'),
    ])
    mount(current)

    const group = await screen.findByRole('group', { name: 'Baseline A' })
    expect(within(group).getByText('This slot is frozen because it already has an attempt.')).toBeInTheDocument()
    expect(within(group).getByLabelText('Material reference')).toBeDisabled()
    expect(within(group).getByLabelText('Baseline A planned time')).toBeDisabled()
  })

  it('server 409 frozen renders the same explanation and keeps the form', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user, router } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    await fillAllRowsComplete(user)

    reject('programs.putSlots', {
      status: 409,
      code: 'slot_frozen',
      message: 'This benchmark slot has an attempt and can no longer be changed.',
      details: { phase: 'baseline', label: 'A' },
    })

    await user.click(screen.getByRole('button', { name: /save/i }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('This slot is frozen because it already has an attempt.')
    expect(router.state.location.pathname).toBe('/setup/readiness')
    expect(screen.getByLabelText('Baseline A planned time')).toHaveValue('09:00')
    expect(screen.getByLabelText('Baseline A planned time')).toBeDisabled()
  })

  it('active program: unfrozen final B time change is in the PUT body and status active returns to /today', async () => {
    const program = makeProgram({ status: 'active', version: 5 })
    const current = makeCurrent(program, [
      makeSlot('baseline', 'A', {
        materialRef: 'Ref A',
        plannedLocalTime: '09:00',
        frozenAt: '2026-09-06T09:00:00.000Z',
      }),
      makeSlot('baseline', 'B', {
        materialRef: 'Ref B',
        plannedLocalTime: '18:00',
        frozenAt: '2026-09-06T18:00:00.000Z',
      }),
      makeSlot('final', 'A', { materialRef: 'Ref FA', plannedLocalTime: '09:00' }),
      makeSlot('final', 'B', { materialRef: 'Ref FB', plannedLocalTime: '18:00' }),
    ])
    const { user, router } = mount(current)
    await screen.findByRole('group', { name: 'Final B' })

    await fillTime(user, 'Final B', '15:45')

    const response: PutSlotsResponseValue = {
      program: { ...program, status: 'active', version: 6 },
      slots: current.slots,
      missing: [],
    }
    respond('programs.putSlots', response)

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.programs.putSlots).toHaveBeenCalledTimes(1))
    const [, body] = mockApi.programs.putSlots.mock.calls[0] as [
      string,
      { slots: { phase: string; label: string; plannedLocalTime?: string }[] },
    ]
    expect(body.slots).toHaveLength(4)
    const finalB = body.slots.find((slot) => slot.phase === 'final' && slot.label === 'B')
    expect(finalB?.plannedLocalTime).toBe('15:45')

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('409 stale version refetches and shows the notice', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    const { user } = mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    await fillAllRowsComplete(user)

    reject('programs.putSlots', {
      status: 409,
      code: 'stale_version',
      message: 'The program has changed since it was last loaded.',
      details: { current: { ...current.program, version: 2 } },
    })

    await user.click(screen.getByRole('button', { name: /save/i }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('The program changed in another tab')
    await waitFor(() => expect(mockApi.programs.current).toHaveBeenCalledTimes(2))
  })

  it('instruction copy mentions reading elsewhere and paper tally', async () => {
    const current = makeCurrent(makeProgram(), fourBlankSlots())
    mount(current)
    await screen.findByRole('group', { name: 'Baseline A' })

    expect(screen.getByText(/reading elsewhere is allowed/i)).toBeInTheDocument()
    expect(screen.getByText(/tallying on paper is fine/i)).toBeInTheDocument()
  })
})
