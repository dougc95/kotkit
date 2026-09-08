import { describe, expect, it } from 'vitest'
import {
  addDays,
  currentProgramDay,
  finalDate,
  isValidIanaTimezone,
  localDateAt,
  programDates,
  type LocalDate,
} from '../../src/domain/calendar.js'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

/**
 * Finds the earliest UTC instant whose local date in `timeZone` equals `date`
 * — i.e. local midnight for that date — by scanning UTC minutes forward from
 * a point safely before it. This is a minute-resolution scan against
 * `localDateAt`, never inverse-timezone math, so it stays correct across any
 * IANA offset (-12:00 through +14:00) without assuming one.
 */
function localMidnightInstant(date: LocalDate, timeZone: string): Date {
  const [yearStr, monthStr, dayStr] = date.split('-') as [string, string, string]
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const searchStart = Date.UTC(year, month - 1, day, 0, 0, 0) - 24 * MS_PER_HOUR
  const minutesToScan = 3 * 24 * 60
  for (let i = 0; i < minutesToScan; i++) {
    const instant = new Date(searchStart + i * MS_PER_MINUTE)
    if (localDateAt(instant, timeZone) === date) {
      return instant
    }
  }
  throw new Error(`Could not locate local midnight for ${date} in ${timeZone}`)
}

/**
 * Steps hourly instants from Day 0's local midnight up to (but excluding) Day
 * 15's local midnight, and asserts the resulting local dates are exactly the
 * program's 15 dates (Day 0..14), in non-decreasing order, with none skipped
 * or duplicated — regardless of a DST transition crossed along the way.
 * Returns the number of hourly steps taken, so a caller can additionally
 * assert the exact count where that count is itself meaningful (a fall-back
 * day is 25 hours; a spring-forward day is 23).
 */
function assertConsecutiveProgramDates(baselineDate: LocalDate, timeZone: string): number {
  const dayZero = localMidnightInstant(baselineDate, timeZone)
  const dayFifteen = localMidnightInstant(addDays(baselineDate, 15), timeZone)
  const hoursSpanned = Math.round((dayFifteen.getTime() - dayZero.getTime()) / MS_PER_HOUR)

  const dates: LocalDate[] = []
  for (let hour = 0; hour < hoursSpanned; hour++) {
    dates.push(localDateAt(new Date(dayZero.getTime() + hour * MS_PER_HOUR), timeZone))
  }

  const distinct = Array.from(new Set(dates))
  expect(distinct).toHaveLength(15)
  expect(distinct).toEqual(programDates(baselineDate))
  for (let i = 1; i < dates.length; i++) {
    expect(dates[i]! >= dates[i - 1]!).toBe(true)
  }

  return hoursSpanned
}

describe('domain/calendar: timezone-derived program day', () => {
  it(
    'fall-back DST (America/New_York, baseline 2026-10-25, DST ends 2026-11-01): stepping ' +
      'hourly instants from the Day 0 00:00 local instant for 15 x 24 + 1 hours yields exactly ' +
      '15 distinct dates, non-decreasing, none skipped or duplicated (the Day 0 instant is found ' +
      'by scanning UTC minutes until localDateAt first equals the baseline date; no ' +
      'inverse-timezone math)',
    () => {
      const hoursSpanned = assertConsecutiveProgramDates('2026-10-25', 'America/New_York')
      // The fall-back day (Nov 1, 2026) has 25 real hours, so the 15-day span is one hour
      // longer than a plain 15 x 24 -- exactly the "15 x 24 + 1" the case name names.
      expect(hoursSpanned).toBe(15 * 24 + 1)
    },
  )

  it(
    'spring-forward DST (Europe/Madrid, baseline 2027-03-21, DST starts 2027-03-28) same property',
    () => {
      const hoursSpanned = assertConsecutiveProgramDates('2027-03-21', 'Europe/Madrid')
      // The spring-forward day (Mar 28, 2027) has 23 real hours, so the 15-day span is one
      // hour shorter than a plain 15 x 24.
      expect(hoursSpanned).toBe(15 * 24 - 1)
    },
  )

  it(
    'profile timezone change on Day 8 does not move program days: instant 2026-09-09T00:00Z ' +
      'with baseline 2026-09-01 is Day 8 in Europe/Madrid and would be Day 7 in ' +
      'America/Los_Angeles; currentProgramDay returns Day 8 because only the program timezone ' +
      'is consulted',
    () => {
      const baselineDate: LocalDate = '2026-09-01'
      const now = new Date('2026-09-09T00:00:00Z')

      const madrid = currentProgramDay({ baselineDate, timezone: 'Europe/Madrid' }, now)
      expect(madrid.day).toBe(8)

      const losAngeles = currentProgramDay({ baselineDate, timezone: 'America/Los_Angeles' }, now)
      expect(losAngeles.day).toBe(7)

      // The program was created with Europe/Madrid as its stored timezone. A later profile
      // timezone change to America/Los_Angeles must not move the program's own day boundaries:
      // currentProgramDay never takes the profile timezone as an input, only the program's.
      expect(
        currentProgramDay({ baselineDate, timezone: 'Europe/Madrid' }, now).day,
      ).toBe(8)
    },
  )

  it('a UTC instant late in its own day resolves to the next local date in Asia/Tokyo, one day ahead of the UTC date', () => {
    const baselineDate: LocalDate = '2026-09-10'
    // 23:30 UTC on Sep 10 is already 08:30 the next morning in Tokyo (UTC+9, no DST): the
    // UTC calendar date (Sep 10) is one day earlier than the correct local date (Sep 11).
    const now = new Date('2026-09-10T23:30:00Z')
    expect(now.toISOString().slice(0, 10)).toBe('2026-09-10')
    expect(localDateAt(now, 'Asia/Tokyo')).toBe('2026-09-11')

    const result = currentProgramDay({ baselineDate, timezone: 'Asia/Tokyo' }, now)
    expect(result.localDate).toBe('2026-09-11')
    expect(result.day).toBe(1)
  })

  it('now advanced by a demo offset of 14 days resolves to Day 14 and localDate equals finalDate (D8)', () => {
    const baselineDate: LocalDate = '2026-09-06'
    const timezone = 'UTC'
    const realNow = new Date('2026-09-06T12:00:00Z')
    const demoClockOffsetSeconds = 14 * 24 * 60 * 60
    const now = new Date(realNow.getTime() + demoClockOffsetSeconds * 1000)

    const result = currentProgramDay({ baselineDate, timezone }, now)
    expect(result.day).toBe(14)
    expect(result.localDate).toBe(finalDate(baselineDate))
  })

  it('isValidIanaTimezone: "Europe/Madrid" true, "Mars/Olympus" false, "" false', () => {
    expect(isValidIanaTimezone('Europe/Madrid')).toBe(true)
    expect(isValidIanaTimezone('Mars/Olympus')).toBe(false)
    expect(isValidIanaTimezone('')).toBe(false)
  })
})
