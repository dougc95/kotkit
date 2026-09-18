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

  it('still needed row is a needs-you message: text-attention, not text-ink-muted', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: ['sleep'],
        values: { sleepMinutes: null, phoneFeedMinutes: 10, desktopFeedMinutes: 20 },
      }),
    )

    const stillNeeded = screen.getByText(/Still needed/)
    expect(stillNeeded).toHaveClass('text-attention')
    expect(stillNeeded).not.toHaveClass('text-ink-muted')
    expect(stillNeeded).toHaveTextContent('Still needed: sleep')
  })

  it('sleep and feed values are wrapped in Reported with the correct data-tier', () => {
    mountCard(
      checkinFixture({
        status: 'incomplete',
        missing: ['sleep'],
        values: { sleepMinutes: null, phoneFeedMinutes: 0, desktopFeedMinutes: 25 },
      }),
    )

    const sleepValue = screen.getByText('Sleep').nextElementSibling
    expect(sleepValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'absent')

    const phoneValue = screen.getByText('Phone feed').nextElementSibling
    expect(phoneValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')

    const desktopValue = screen.getByText('Desktop feed').nextElementSibling
    expect(desktopValue?.querySelector('[data-tier]')).toHaveAttribute('data-tier', 'recorded')
  })

  it('Open check-in link carries data-variant secondary via Button asChild', () => {
    mountCard(checkinFixture())

    expect(screen.getByRole('link', { name: 'Open check-in' })).toHaveAttribute('data-variant', 'secondary')
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

  it('root draws a top rule, not a bottom one: the column should not end on a hairline under nothing (task V4b)', () => {
    mountCard(checkinFixture())

    const heading = screen.getByRole('heading', { name: 'Check-in' })
    const root = heading.parentElement
    expect(root).toHaveClass('border-t')
    expect(root).not.toHaveClass('border-b')
  })
})
