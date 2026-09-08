import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type {
  CheckinField,
  CheckinStatus as CheckinStatusValue,
  CurrentProgramResponseValue,
  DayResponseValue,
  FeedRowValue,
  PutDayBodyValue,
} from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { CheckinForm } from './CheckinForm.js'

/**
 * task 8.7.1's verify list, all 14 named cases (tasks-detail.md's own
 * wording, read literally — including its "GET /programs/current 404" case,
 * which design.md D22 clarifies is always a 200 with `program: null`, never
 * a literal 404; see CheckinForm.tsx's header comment).
 */

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111'
const DATE = '2026-09-08'

const ROUTES: RouteObject[] = [
  { path: '/checkin/:date', element: <CheckinForm /> },
  { path: '/today', element: <h1>Today screen</h1> },
]

function mount(program: CurrentProgramResponseValue, day?: DayResponseValue) {
  respond('programs.current', program)
  if (day !== undefined) {
    respond('days.get', day)
  }
  return renderWithProviders(<></>, { route: `/checkin/${DATE}`, routes: ROUTES })
}

const OPEN_PROGRAM: CurrentProgramResponseValue = {
  program: {
    id: PROGRAM_ID,
    realm: 'demo',
    status: 'active',
    baselineDate: '2026-09-01',
    timezone: 'America/Los_Angeles',
    leisureAllowanceMinutes: 20,
    feedEstimateMinutes: null,
    currentRevisionId: '22222222-2222-4222-8222-222222222222',
    version: 1,
  },
  revision: {
    id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    effectiveDay: 0,
    settings: { practiceTargetSeconds: 600, bandCeilings: [], leisureAllowanceMin: 20 },
    reason: 'initial plan',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  slots: [],
  day: 7,
  nextAction: { kind: 'practice', block: 1 },
}

const NO_PROGRAM: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

const BLANK_AGGREGATES = {
  unitLabel: 'device-minutes' as const,
  feedDeviceMinutes: null,
  feedByDevice: { phone: null, desktop: null, tablet: null, unspecified: null },
  partial: true,
  shortVideoDeviceMinutes: null,
  appTotals: [],
}

function dayFixture(overrides: {
  sleepMinutes?: number | null
  feed?: FeedRowValue[]
  status?: CheckinStatusValue
  missing?: CheckinField[]
  version?: number
  stress?: number | null
  mindfulnessMinutes?: number | null
  note?: string | null
} = {}): DayResponseValue {
  return {
    checkin: {
      localDate: DATE,
      sleepMinutes: overrides.sleepMinutes ?? null,
      stress: overrides.stress ?? null,
      mindfulnessMinutes: overrides.mindfulnessMinutes ?? null,
      note: overrides.note ?? null,
    },
    feed: overrides.feed ?? [],
    status: {
      status: overrides.status ?? 'not_reported',
      missing: overrides.missing ?? ['sleep', 'feed'],
    },
    aggregates: BLANK_AGGREGATES,
    version: overrides.version ?? 0,
  }
}

const EMPTY_DAY = dayFixture()

/** `api.days.put(programId, date, body)` — the body is always argument index 2. */
function putBody(index = 0): PutDayBodyValue {
  const call = mockApi.days.put.mock.calls[index] as [string, string, PutDayBodyValue]
  return call[2]
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

describe('CheckinForm', () => {
  it('default render shows only sleep, phone, desktop, More detail and Save', async () => {
    mount(OPEN_PROGRAM, EMPTY_DAY)

    await screen.findByLabelText('Sleep minutes')
    expect(screen.getByLabelText('Phone feed minutes')).toBeInTheDocument()
    expect(screen.getByLabelText('Desktop feed minutes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More detail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    expect(screen.queryByLabelText(/stress/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/mindfulness/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument()
  })

  it('blank sleep is omitted from the PUT body', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '30')
    respond('days.put', dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 30, measurementScope: 'feed', source: 'estimate' }], version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    expect('sleepMinutes' in body).toBe(false)
  })

  it('blank phone sends no phone row and the summary shows phone Not reported', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    expect(screen.getByText('Phone: Not reported')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Sleep minutes'), '420')
    respond('days.put', dayFixture({ sleepMinutes: 420, status: 'incomplete', missing: ['feed'], version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    expect(body.feed.some((row) => row.device === 'phone')).toBe(false)
  })

  it('explicit phone 0 sends a row with minutes 0 and the summary shows 0 min, not Not reported', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '0')
    expect(screen.getByText('Phone: 0 min')).toBeInTheDocument()
    expect(screen.queryByText('Phone: Not reported')).not.toBeInTheDocument()

    respond('days.put', dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 0, measurementScope: 'feed', source: 'estimate' }], version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    const phoneRow = body.feed.find((row) => row.device === 'phone')
    expect(phoneRow).toMatchObject({ minutes: 0 })
  })

  it('phone headline row is sent with platform all', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '15')
    respond('days.put', dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 15, measurementScope: 'feed', source: 'estimate' }], version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    const phoneRow = body.feed.find((row) => row.device === 'phone')
    expect(phoneRow?.platform).toBe('all')
  })

  it('sleep 420 and phone 30 saves with status Complete and the body carries no stress, mindfulnessMinutes or note', async () => {
    const { user, router } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Sleep minutes'), '420')
    await user.type(screen.getByLabelText('Phone feed minutes'), '30')
    respond(
      'days.put',
      dayFixture({
        sleepMinutes: 420,
        feed: [{ device: 'phone', platform: 'all', minutes: 30, measurementScope: 'feed', source: 'estimate' }],
        status: 'complete',
        missing: [],
        version: 1,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.state).toEqual({ notice: 'Check-in saved.' })

    const body = putBody()
    expect('stress' in body).toBe(false)
    expect('mindfulnessMinutes' in body).toBe(false)
    expect('note' in body).toBe(false)
  })

  it('sleep-only save shows Incomplete — missing: feed taken from the response, not inferred from the record', async () => {
    mount(OPEN_PROGRAM, dayFixture({ sleepMinutes: 420, status: 'incomplete', missing: ['feed'], version: 1 }))

    await screen.findByLabelText('Sleep minutes')
    expect(screen.getByRole('status')).toHaveTextContent('Incomplete — missing: feed')
  })

  it('adding a desktop detail row disables the desktop headline input and shows the summed total', async () => {
    const desktopDetailRow: FeedRowValue = {
      device: 'desktop',
      platform: 'Chrome',
      minutes: 20,
      shortVideoMinutes: null,
      measurementScope: 'feed',
      source: 'estimate',
      plannedWindow: null,
    }
    mount(OPEN_PROGRAM, dayFixture({ feed: [desktopDetailRow], status: 'incomplete', missing: ['sleep'], version: 3 }))

    await screen.findByLabelText('Sleep minutes')
    const desktopInput = screen.getByLabelText('Desktop feed minutes')
    expect(desktopInput).toBeDisabled()
    expect(desktopInput).toHaveValue(20)
    expect(screen.getByText('Desktop: 20 min')).toBeInTheDocument()
  })

  it('422 feed_platform_conflict renders on the phone headline field and blocks Save', async () => {
    const { user, router } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '10')
    reject('days.put', {
      status: 422,
      code: 'feed_platform_conflict',
      fieldErrors: { 'feed[0].platform': ['device has both an all row and platform rows'] },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Clear this total or remove the detail rows below')
    expect(router.state.location.pathname).toBe(`/checkin/${DATE}`)
  })

  it('stale 409 replaces the form with the returned current values and offers Re-apply my values', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Sleep minutes'), '100')

    const current = dayFixture({ sleepMinutes: 300, status: 'incomplete', missing: ['feed'], version: 5 })
    reject('days.put', { status: 409, code: 'stale_version', details: { current } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('This check-in was updated elsewhere; showing the current values')
    expect(screen.getByLabelText('Sleep minutes')).toHaveValue(300)

    await user.click(screen.getByRole('button', { name: 'Re-apply my values' }))
    expect(screen.getByLabelText('Sleep minutes')).toHaveValue(100)
    expect(screen.queryByText('This check-in was updated elsewhere; showing the current values')).not.toBeInTheDocument()

    respond('days.put', dayFixture({ sleepMinutes: 100, status: 'incomplete', missing: ['feed'], version: 6 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(2))
    const body = putBody(1)
    expect(body.expectedVersion).toBe(5)
    expect(body.sleepMinutes).toBe(100)
  })

  it('55 minutes against a 20-minute allowance saves with Check-in saved. and no text matching /exceeded|over your allowance|too much|warning/i', async () => {
    const { user, router } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await user.type(screen.getByLabelText('Phone feed minutes'), '55')
    expect(document.body.textContent ?? '').not.toMatch(/exceeded|over your allowance|too much|warning/i)

    respond('days.put', dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 55, measurementScope: 'feed', source: 'estimate' }], version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.state).toEqual({ notice: 'Check-in saved.' })
    expect(document.body.textContent ?? '').not.toMatch(/exceeded|over your allowance|too much|warning/i)
  })

  it('after a save returning version 2, remounting and saving again sends expectedVersion 2 to the same date', async () => {
    const first = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    await first.user.type(screen.getByLabelText('Phone feed minutes'), '10')
    respond('days.put', dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' }], version: 2 }))
    await first.user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const firstBody = putBody(0)
    expect(firstBody.expectedVersion).toBe(0)

    cleanup()

    const second = mount(
      OPEN_PROGRAM,
      dayFixture({ feed: [{ device: 'phone', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' }], version: 2 }),
    )
    await screen.findByLabelText('Sleep minutes')

    await second.user.type(screen.getByLabelText('Sleep minutes'), '200')
    respond('days.put', dayFixture({ sleepMinutes: 200, version: 3 }))
    await second.user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(2))
    const secondBody = putBody(1)
    expect(secondBody.expectedVersion).toBe(2)
  })

  it('a date with no check-in renders the D22 all-null shape and the first PUT sends expectedVersion 0', async () => {
    const { user } = mount(OPEN_PROGRAM, EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    expect(screen.getByLabelText('Sleep minutes')).toHaveValue(null)
    expect(screen.getByLabelText('Phone feed minutes')).toHaveValue(null)
    expect(screen.getByLabelText('Desktop feed minutes')).toHaveValue(null)
    expect(screen.getByRole('status')).toHaveTextContent('Incomplete — missing: sleep, feed')

    respond('days.put', dayFixture({ version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    expect(body.expectedVersion).toBe(0)
  })

  it('GET /programs/current 404 renders the Setup link and no form', async () => {
    mount(NO_PROGRAM)

    const link = await screen.findByRole('link', { name: 'Set up your program first' })
    expect(link).toHaveAttribute('href', '/setup')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sleep minutes')).not.toBeInTheDocument()
    expect(mockApi.days.get).not.toHaveBeenCalled()
  })
})
