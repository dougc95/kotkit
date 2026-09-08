import { describe, expect, it } from 'vitest'
import {
  PROGRAM_LENGTH_DAYS,
  addDays,
  finalDate,
  isValidLocalDate,
  isWithinProgram,
  localDateForProgramDay,
  programDates,
  programDayForLocalDate,
  type LocalDate,
} from '../../src/domain/calendar.js'

describe('domain/calendar: calendar-field arithmetic', () => {
  it('Day 0 equals the baseline date', () => {
    const baselineDate: LocalDate = '2026-09-06'
    expect(localDateForProgramDay(baselineDate, 0)).toBe(baselineDate)
  })

  it('finalDate is baseline + 14 calendar days', () => {
    const baselineDate: LocalDate = '2026-09-06'
    expect(finalDate(baselineDate)).toBe(addDays(baselineDate, 14))
    expect(finalDate(baselineDate)).toBe('2026-09-20')
  })

  it('programDates yields 15 distinct consecutive dates across a month boundary (baseline 2026-09-25)', () => {
    const baselineDate: LocalDate = '2026-09-25'
    const dates = programDates(baselineDate)
    expect(dates).toHaveLength(15)
    expect(new Set(dates).size).toBe(15)
    expect(dates[0]).toBe('2026-09-25')
    expect(dates[14]).toBe('2026-10-09')
    for (let i = 1; i < dates.length; i++) {
      expect(addDays(dates[i - 1]!, 1)).toBe(dates[i])
    }
  })

  it('programDayForLocalDate inverts localDateForProgramDay for days 0..14', () => {
    const baselineDate: LocalDate = '2026-09-06'
    for (let day = 0; day <= PROGRAM_LENGTH_DAYS; day++) {
      const localDate = localDateForProgramDay(baselineDate, day)
      expect(programDayForLocalDate(baselineDate, localDate)).toBe(day)
    }
  })

  it('date before baseline returns a negative day and Day 15 returns 15 (not clamped)', () => {
    const baselineDate: LocalDate = '2026-09-06'
    const before = addDays(baselineDate, -3)
    expect(programDayForLocalDate(baselineDate, before)).toBe(-3)
    const day15 = addDays(baselineDate, 15)
    expect(programDayForLocalDate(baselineDate, day15)).toBe(15)
    expect(isWithinProgram(15)).toBe(false)
    expect(isWithinProgram(-3)).toBe(false)
  })

  it('leap day: 2028-02-28 + 1 = 2028-02-29', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(isValidLocalDate('2028-02-29')).toBe(true)
    // 2028 is a leap year; 2027 is not, so the same step would overflow to March 1.
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('malformed date string throws', () => {
    expect(() => addDays('not-a-date', 1)).toThrow()
    expect(() => localDateForProgramDay('2026-13-40', 0)).toThrow()
    expect(() => programDayForLocalDate('2026-09-06', '2026-02-30')).toThrow()
    expect(isValidLocalDate('not-a-date')).toBe(false)
    expect(isValidLocalDate('2026-02-30')).toBe(false)
  })
})
