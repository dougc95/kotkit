import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type { CurrentProgramResponseValue, DayResponseValue, FeedRowValue, PutDayBodyValue } from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { CheckinForm } from './CheckinForm.js'
import { PLATFORM_ALL_RESERVED_MESSAGE, STRESS_RANGE_MESSAGE, SUBSET_VIOLATION_MESSAGE } from './FeedRows.js'

/**
 * task 8.7.2's verify list, all 11 named cases. FeedRows/FeedTotals/
 * OptionalFields are controlled pieces of CheckinForm's own reducer (see
 * CheckinForm.tsx's header comment for why) — exactly like 8.7.1's own
 * CheckinForm.test.tsx, these tests mount the whole form, open "More
 * detail", drive it through Testing Library, and assert on the PUT body /
 * rendered copy. No test here reaches into FeedRows/FeedTotals in
 * isolation: "rows live in the 8.7.1 reducer" (8.7.2's own State section) is
 * exactly what makes the round trip through CheckinForm the real behavior.
 */

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111'
const DATE = '2026-09-08'

const ROUTES: RouteObject[] = [
  { path: '/checkin/:date', element: <CheckinForm /> },
  { path: '/today', element: <h1>Today screen</h1> },
]

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

const BLANK_AGGREGATES = {
  unitLabel: 'device-minutes' as const,
  feedDeviceMinutes: null,
  feedByDevice: { phone: null, desktop: null, tablet: null, unspecified: null },
  partial: true,
  shortVideoDeviceMinutes: null,
  appTotals: [],
}

function dayFixture(overrides: { sleepMinutes?: number | null; feed?: FeedRowValue[]; version?: number } = {}): DayResponseValue {
  return {
    checkin: { localDate: DATE, sleepMinutes: overrides.sleepMinutes ?? null, stress: null, mindfulnessMinutes: null, note: null },
    feed: overrides.feed ?? [],
    status: { status: 'not_reported', missing: ['sleep', 'feed'] },
    aggregates: BLANK_AGGREGATES,
    version: overrides.version ?? 0,
  }
}

const EMPTY_DAY = dayFixture()

function mount(day: DayResponseValue) {
  respond('programs.current', OPEN_PROGRAM)
  respond('days.get', day)
  return renderWithProviders(<></>, { route: `/checkin/${DATE}`, routes: ROUTES })
}

/** `api.days.put(programId, date, body)` — the body is always argument index 2. */
function putBody(index = 0): PutDayBodyValue {
  const call = mockApi.days.put.mock.calls[index] as [string, string, PutDayBodyValue]
  return call[2]
}

async function openMoreDetail(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'More detail' }))
}

async function addRow(user: ReturnType<typeof renderWithProviders>['user'], rowNumber: number): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Add row' }))
  return screen.getByRole('group', { name: `Feed detail row ${rowNumber}` })
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

describe('FeedRows', () => {
  it('rows and optional fields are hidden until More detail is opened', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')

    expect(screen.queryByRole('button', { name: 'Add row' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stress (0-10)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mindfulness minutes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()

    await openMoreDetail(user)

    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument()
    expect(screen.getByLabelText('Stress (0-10)')).toBeInTheDocument()
    expect(screen.getByLabelText('Mindfulness minutes')).toBeInTheDocument()
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
  })

  it('short-video 45 over 30 minutes blocks Save naming the subset rule and sends no PUT', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '30')
    await user.type(within(group).getByLabelText('Short-video minutes'), '45')

    expect(screen.getByText(SUBSET_VIOLATION_MESSAGE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockApi.days.put).not.toHaveBeenCalled()
  })

  it('server 422 subset maps to the row short-video field', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '30')
    await user.type(within(group).getByLabelText('Short-video minutes'), '10')
    expect(screen.queryByText(SUBSET_VIOLATION_MESSAGE)).not.toBeInTheDocument()

    reject('days.put', {
      status: 422,
      code: 'feed_subset_violation',
      fieldErrors: { 'feed[0].shortVideoMinutes': ['must not exceed minutes'] },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const message = await within(screen.getByRole('group', { name: 'Feed detail row 1' })).findByText(SUBSET_VIOLATION_MESSAGE)
    expect(message).toBeInTheDocument()
  })

  it('platform all on a detail row is rejected inline and blocks Save', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'all')
    await user.type(within(group).getByLabelText('Minutes'), '10')

    expect(screen.getByText(PLATFORM_ALL_RESERVED_MESSAGE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockApi.days.put).not.toHaveBeenCalled()
  })

  it('adding a phone detail row disables the phone headline input; removing it re-enables the field', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '12')

    await waitFor(() => expect(screen.getByLabelText('Phone feed minutes')).toBeDisabled())
    expect(screen.getByLabelText('Phone feed minutes')).toHaveValue(12)

    await user.click(within(group).getByRole('button', { name: 'Remove row' }))

    await waitFor(() => expect(screen.getByLabelText('Phone feed minutes')).not.toBeDisabled())
    expect(screen.getByLabelText('Phone feed minutes')).toHaveValue(null)
  })

  it('From device report sends source device_report and the row is labelled From device report', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '15')
    await user.click(within(group).getByLabelText('From device report'))
    expect(within(group).getByLabelText('From device report')).toBeChecked()

    respond(
      'days.put',
      dayFixture({
        feed: [{ device: 'phone', platform: 'Instagram', minutes: 15, measurementScope: 'feed', source: 'device_report' }],
        version: 1,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockApi.days.put).toHaveBeenCalledTimes(1))
    const body = putBody()
    expect(body.feed[0]).toMatchObject({ platform: 'Instagram', source: 'device_report' })
  })

  it('phone Instagram app_total 60 alongside feed 25 shows 25 device-minutes and 60 as a broad app total', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group1 = await addRow(user, 1)
    await user.type(within(group1).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group1).getByLabelText('Minutes'), '25')

    const group2 = await addRow(user, 2)
    await user.type(within(group2).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group2).getByLabelText('Minutes'), '60')
    await user.click(within(group2).getByLabelText('Whole app'))

    expect(screen.getByText(/25 device-minutes \(feed\)/)).toBeInTheDocument()
    expect(screen.getByText('Broad app total: 60 min — phone Instagram')).toBeInTheDocument()
  })

  it('phone 20 + desktop 20 reads 40 device-minutes and not 40 minutes', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group1 = await addRow(user, 1)
    await user.type(within(group1).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group1).getByLabelText('Minutes'), '20')

    const group2 = await addRow(user, 2)
    await user.selectOptions(within(group2).getByLabelText('Device'), 'desktop')
    await user.type(within(group2).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group2).getByLabelText('Minutes'), '20')

    expect(screen.getByText(/40 device-minutes \(feed\)/)).toBeInTheDocument()
    expect(screen.queryByText('40 minutes')).not.toBeInTheDocument()
  })

  it('short video is shown as of which short video and never added to the total', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.type(within(group).getByLabelText('Platform'), 'Instagram')
    await user.type(within(group).getByLabelText('Minutes'), '30')
    await user.type(within(group).getByLabelText('Short-video minutes'), '10')

    expect(screen.getByText(/30 device-minutes \(feed\)/)).toBeInTheDocument()
    expect(screen.getByText('of which short video: 10 min')).toBeInTheDocument()
    expect(screen.queryByText(/40 device-minutes/)).not.toBeInTheDocument()
  })

  it('phone 0 + desktop 20 reads 20 device-minutes without the partial label; desktop 20 with no phone row of any kind is labelled partial', async () => {
    const { user } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    const group = await addRow(user, 1)
    await user.selectOptions(within(group).getByLabelText('Device'), 'desktop')
    await user.type(within(group).getByLabelText('Platform'), 'Chrome')
    await user.type(within(group).getByLabelText('Minutes'), '20')

    expect(screen.getByText(/partial/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Phone feed minutes'), '0')

    expect(screen.getByText(/20 device-minutes \(feed\)/)).toBeInTheDocument()
    expect(screen.queryByText(/partial/i)).not.toBeInTheDocument()
  })

  it('blank stress, mindfulness and note are omitted from the body and stress 11 is rejected inline', async () => {
    const { user, router } = mount(EMPTY_DAY)
    await screen.findByLabelText('Sleep minutes')
    await openMoreDetail(user)

    await user.type(screen.getByLabelText('Stress (0-10)'), '11')
    expect(screen.getByText(STRESS_RANGE_MESSAGE)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Sleep minutes'), '420')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockApi.days.put).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Stress (0-10)'))
    expect(screen.queryByText(STRESS_RANGE_MESSAGE)).not.toBeInTheDocument()

    respond('days.put', dayFixture({ sleepMinutes: 420, version: 1 }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    const body = putBody()
    expect('stress' in body).toBe(false)
    expect('mindfulnessMinutes' in body).toBe(false)
    expect('note' in body).toBe(false)
  })
})
