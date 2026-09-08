/**
 * Program calendar arithmetic: Day 0 (baseline) through Day 14 (final), expressed
 * as local calendar dates in the program's stored timezone.
 *
 * This unit is deliberately split in two:
 *  - calendar-field arithmetic (`addDays`, `localDateForProgramDay`,
 *    `programDayForLocalDate`, `finalDate`, `programDates`) never touches a
 *    timezone; it operates purely on YYYY-MM-DD strings via `Date.UTC` at noon,
 *    so no local wall-clock or DST behavior can leak into it.
 *  - deriving a local date FROM an instant (`localDateAt`, `currentProgramDay`)
 *    is the only place a timezone enters, per program-setup's requirement that
 *    "current day SHALL be derived server-side from the program timezone (or
 *    the demo clock in demo mode)" — never from the profile timezone.
 *
 * See docs/Attention-Lab-Prototype-PRD.md and
 * specs/program-setup/spec.md ("Program calendar uses stored timezone and
 * local dates").
 */

/** A calendar date in YYYY-MM-DD form, always local to some timezone the caller knows. */
export type LocalDate = string

/** Day 0 is the baseline; Day 14 is the final date. */
export const PROGRAM_LENGTH_DAYS = 14

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface LocalDateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** Is `value` a real, well-formed YYYY-MM-DD calendar date? Rejects e.g. 2026-02-30. */
export function isValidLocalDate(value: string): value is LocalDate {
  if (!LOCAL_DATE_PATTERN.test(value)) return false
  const parts = value.split('-')
  const yearStr = parts[0]
  const monthStr = parts[1]
  const dayStr = parts[2]
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) return false
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

function assertValidLocalDate(value: string): asserts value is LocalDate {
  if (!isValidLocalDate(value)) {
    throw new RangeError(`Invalid LocalDate: "${value}" is not a real YYYY-MM-DD calendar date`)
  }
}

function parseLocalDateParts(value: LocalDate): LocalDateParts {
  const [yearStr, monthStr, dayStr] = value.split('-') as [string, string, string]
  return { year: Number(yearStr), month: Number(monthStr), day: Number(dayStr) }
}

function formatLocalDate(dt: Date): LocalDate {
  const year = String(dt.getUTCFullYear()).padStart(4, '0')
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * `date` shifted by `n` calendar days (`n` may be negative). Pure calendar-field
 * arithmetic via `Date.UTC` at noon — no timezone is involved, so this never
 * observes a DST transition.
 */
export function addDays(date: LocalDate, n: number): LocalDate {
  assertValidLocalDate(date)
  const { year, month, day } = parseLocalDateParts(date)
  return formatLocalDate(new Date(Date.UTC(year, month - 1, day + n, 12, 0, 0)))
}

/** The local date for program Day `day` (0 = baseline). Never clamped. */
export function localDateForProgramDay(baselineDate: LocalDate, day: number): LocalDate {
  assertValidLocalDate(baselineDate)
  return addDays(baselineDate, day)
}

/**
 * The raw program-day offset of `localDate` relative to `baselineDate`.
 * Negative before Day 0; greater than 14 after Day 14. Never clamped.
 */
export function programDayForLocalDate(baselineDate: LocalDate, localDate: LocalDate): number {
  assertValidLocalDate(baselineDate)
  assertValidLocalDate(localDate)
  const base = parseLocalDateParts(baselineDate)
  const target = parseLocalDateParts(localDate)
  const baseMs = Date.UTC(base.year, base.month - 1, base.day, 12, 0, 0)
  const targetMs = Date.UTC(target.year, target.month - 1, target.day, 12, 0, 0)
  return Math.round((targetMs - baseMs) / MS_PER_DAY)
}

/** The program's final date: baseline + 14 calendar days (Day 14). */
export function finalDate(baselineDate: LocalDate): LocalDate {
  return addDays(baselineDate, PROGRAM_LENGTH_DAYS)
}

/** Is `day` one of the 15 in-program days, 0 through 14 inclusive? */
export function isWithinProgram(day: number): boolean {
  return day >= 0 && day <= PROGRAM_LENGTH_DAYS
}

/** The 15 local dates of the program, Day 0 through Day 14 inclusive. */
export function programDates(baselineDate: LocalDate): LocalDate[] {
  assertValidLocalDate(baselineDate)
  const dates: LocalDate[] = []
  for (let day = 0; day <= PROGRAM_LENGTH_DAYS; day++) {
    dates.push(addDays(baselineDate, day))
  }
  return dates
}

/**
 * The local calendar date of `instant` in IANA zone `timeZone`. This is the
 * only correct way to turn an instant into "today" for a program: slicing an
 * ISO string's date part reads the UTC date, which is routinely a different
 * calendar day near midnight in most zones.
 */
export function localDateAt(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not resolve a local date for timeZone "${timeZone}"`)
  }
  return `${year}-${month}-${day}`
}

/** Is `tz` a timezone name `Intl` recognizes? Empty string and unknown names are false. */
export function isValidIanaTimezone(tz: string): boolean {
  if (tz === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch (err) {
    if (err instanceof RangeError) return false
    throw err
  }
}

/**
 * The program's current day and local date at instant `now`, consulting ONLY
 * the program's own stored timezone — never the caller's or the profile's —
 * so a later profile timezone change cannot move program day boundaries (see
 * "Profile timezone changed mid-program"). `now` is supplied by the caller so
 * a demo clock offset (D8: `ctx.now = realNow + offset`) works unchanged. Day
 * is not clamped to 0..14.
 */
export function currentProgramDay(
  program: { readonly baselineDate: LocalDate; readonly timezone: string },
  now: Date,
): { day: number; localDate: LocalDate } {
  const localDate = localDateAt(now, program.timezone)
  const day = programDayForLocalDate(program.baselineDate, localDate)
  return { day, localDate }
}
