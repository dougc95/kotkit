import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { TodayResponseValue } from '@attention-lab/shared'

import { mockApi } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { CheckinCard } from './CheckinCard.js'

/** task 8.2.3's verify list, all 6 named cases. */

function checkinFixture(overrides: Partial<TodayResponseValue['checkin']> = {}): TodayResponseValue['checkin'] {
  return {
    status: 'not_reported',
    missing: ['sleep', 'feed'],
    values: { sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null },
    ...overrides,
  }
}

function mountCard(checkin: TodayResponseValue['checkin'], localDate = '2026-09-06') {
  return renderWithProviders(<CheckinCard programId="program-1" localDate={localDate} checkin={checkin} />)
}

afterEach(() => {
  cleanup()
})

describe('CheckinCard', () => {
  it('missing sleep renders not yet reported and no 0', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: ['sleep'],
        values: { sleepMinutes: null, phoneFeedMinutes: 10, desktopFeedMinutes: 20 },
      }),
    )

    const sleepValue = screen.getByText('Sleep').nextElementSibling
    expect(sleepValue).toHaveTextContent('not yet reported')
    expect(sleepValue?.textContent).not.toMatch(/\b0\b/)
  })

  it('complete check-in shows sleep, phone and desktop values from checkin.values and no missing list', () => {
    mountCard(
      checkinFixture({
        status: 'complete',
        missing: [],
        values: { sleepMinutes: 480, phoneFeedMinutes: 15, desktopFeedMinutes: 5 },
      }),
    )

    expect(screen.getByText('Sleep').nextElementSibling).toHaveTextContent('480 min')
    expect(screen.getByText('Phone feed').nextElementSibling).toHaveTextContent('15 min')
    expect(screen.getByText('Desktop feed').nextElementSibling).toHaveTextContent('5 min')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/still needed/i)).not.toBeInTheDocument()
  })

  it('phone missing but desktop reported renders the desktop value and phone as not yet reported', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: [],
        values: { sleepMinutes: 400, phoneFeedMinutes: null, desktopFeedMinutes: 25 },
      }),
    )

    expect(screen.getByText('Phone feed').nextElementSibling).toHaveTextContent('not yet reported')
    expect(screen.getByText('Desktop feed').nextElementSibling).toHaveTextContent('25 min')
  })

  it('explicit zero feed value renders 0 min while a null value renders not yet reported', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: [],
        values: { sleepMinutes: 400, phoneFeedMinutes: 0, desktopFeedMinutes: null },
      }),
    )

    expect(screen.getByText('Phone feed').nextElementSibling).toHaveTextContent('0 min')
    expect(screen.getByText('Desktop feed').nextElementSibling).toHaveTextContent('not yet reported')
  })

  it('card issues no request to GET /programs/{id}/days/{date}', () => {
    mountCard(checkinFixture())

    expect(mockApi.days.get).not.toHaveBeenCalled()
  })

  it('link targets /checkin/:localDate', () => {
    mountCard(checkinFixture(), '2026-09-09')

    const link = screen.getByRole('link', { name: 'Open check-in' })
    expect(link).toHaveAttribute('href', '/checkin/2026-09-09')
  })
})
