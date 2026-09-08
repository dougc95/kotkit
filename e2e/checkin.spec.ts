/**
 * Task 8.7.3 (design.md D12, D22, D36; daily-checkin: "Overruns and missed
 * days never block" / "Allowance exceeded" and "Skipped day"; daily-checkin:
 * "Feed rows carry device, platform, scope and source" / "Short-video
 * exceeds total"; daily-checkin: "Incomplete saves and completeness status"
 * / "Sleep only"; daily-checkin: "One check-in per program day" / "Edit
 * today's check-in twice"; daily-checkin: "Low burden" / "Default visible
 * fields"; app-shell: "Responsive layout" / "Check-in on a phone-sized
 * viewport"; app-shell: "Copy never punishes or gamifies" / "Feed allowance
 * exceeded"). Drives the real Today (8.2.1/8.2.3) -> CheckinForm (8.7.1,
 * extended by 8.7.2) screens against the `working-day` demo scenario (Day 4,
 * `packages/shared/src/fixtures/demoScenarios.ts` — checkins exist for Days
 * 1-3 only, so "today", Day 4, always opens blank) through six independent
 * journeys, one per test, each starting from its own `beforeEach` scenario
 * load so no test depends on another's saved state.
 *
 * Two interpretive notes on the task brief, both settled by reading the
 * real components rather than guessing:
 *
 *  - "afterEach reset(request) from e2e/support/clock.ts" names a function
 *    that does not exist there — `clock.ts` exports only `installClock`,
 *    `advance`, `sleep`, `hideTab`, `showTab` (none of them a bare reset).
 *    The real reset is `support/demo.ts`'s own `demo.reset()` (POST
 *    `/demo/reset`), which is what task 7.1.5 actually built and every
 *    other spec's `beforeEach` already calls. This file's `afterEach` calls
 *    that instead, mainly so Test 4's two-day clock jump does not linger
 *    for whatever file Playwright happens to run next (though every other
 *    file's own `beforeEach` would already correct it via `demo.load`/
 *    `demo.reset`, per D35: both zero the offset).
 *  - "Today shows the check-in status Complete" cannot mean literal on-page
 *    text on `/today` itself: `CheckinCard.tsx` (8.2.3, confirmed against
 *    its own `CheckinCard.test.tsx`) renders NO status text at all once a
 *    day is complete — only a "Still needed: …" line when it is not, mirrored
 *    by `PracticeReview.tsx`/`AbandonSession`'s own already-established
 *    pattern (see `practice-review.spec.ts`'s header comment) of navigation
 *    `state.notice` values nothing on screen ever reads. What DOES literally
 *    render the word "Complete" is `CheckinForm`'s own `CheckinStatus`
 *    component (`role="status"`) on `/checkin/:date` itself. This file reads
 *    the brief's intent as both halves of that: Today's card drops its
 *    "Still needed" line (checked directly below), and reopening the form
 *    shows the real "Complete" status text.
 *
 * Test 4's "skipped day" is read literally against `apps/api/src/services/
 * report/days.ts`'s own header comment: `days[]` lists one row per program
 * day, Day 0 through today, and a day with no `daily_checkins` row at all
 * maps to every field `null` — so advancing the clock two days and saving
 * only the NEW day's sleep leaves exactly one day in between with no
 * check-in ever attempted; that in-between day is "the skipped date" the
 * report must show as null/null, never 0. `addDaysToLocalDate` computes that
 * date with pure calendar-string arithmetic (mirroring `support/demo.ts`'s
 * own small self-contained date helpers) — deliberately not the program
 * timezone's real wall-clock math, since calendar-day offsetting from an
 * already-resolved `YYYY-MM-DD` string needs none of that.
 */
import type { Page } from '@playwright/test'
import type { DayResponseValue } from '@attention-lab/shared'

import { expect, test } from './support/demo.js'
import type { DemoClient } from './support/demo.js'
import { expectNoPunitiveCopy } from './support/copy.js'

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

test.afterEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `GET /programs/current`'s program id, after the scenario load above. */
async function currentProgramId(demo: DemoClient): Promise<string> {
  const current = await demo.current()
  if (current.program === null) {
    throw new Error('checkin.spec: GET /programs/current has no program after loading working-day')
  }
  return current.program.id
}

/**
 * The one-click path the daily-checkin spec's "Default visible fields" case
 * names: from a fresh `/today`, click the CheckinCard's "Open check-in" link
 * (`CheckinCard.tsx`, task 8.2.3) and read the resulting `/checkin/:date`
 * date back off the URL — never computed independently, so this works
 * identically before and after Test 4 advances the demo clock.
 */
async function openCheckinFromToday(page: Page): Promise<string> {
  await page.goto('/today')
  await page.getByRole('link', { name: 'Open check-in' }).click()
  await page.waitForURL(/\/checkin\/\d{4}-\d{2}-\d{2}$/)
  const match = /\/checkin\/(\d{4}-\d{2}-\d{2})$/.exec(page.url())
  if (match?.[1] === undefined) {
    throw new Error(`checkin.spec: could not parse a check-in date from ${page.url()}`)
  }
  return match[1]
}

/** Pure calendar-string arithmetic: `localDate` shifted by `deltaDays` (may be negative), with no timezone involved. */
function addDaysToLocalDate(localDate: string, deltaDays: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`checkin.spec: malformed local date "${localDate}"`)
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays))
  const y = String(shifted.getUTCFullYear()).padStart(4, '0')
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `programs/{id}/days/{date}` through the web origin's own `/api` proxy (matches `today-start-practice.spec.ts`'s own `page.request` convention). */
async function getDay(page: Page, programId: string, date: string): Promise<DayResponseValue> {
  const response = await page.request.get(`/api/v1/programs/${programId}/days/${date}`)
  if (!response.ok()) {
    throw new Error(`GET days/${date} -> ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as DayResponseValue
}

// ---------------------------------------------------------------------------
// Test 1 — over-allowance saves neutrally
// ---------------------------------------------------------------------------

test('over-allowance saves neutrally: only the default fields show, and an over-allowance phone total saves with no warning copy', async ({
  page,
  demo,
}) => {
  const programId = await currentProgramId(demo)
  const date = await openCheckinFromToday(page)

  // Low burden / Default visible fields: sleep, phone, desktop, "More
  // detail" and Save only — stress, mindfulness, note and the detail-row
  // controls stay entirely out of the DOM (Radix `Collapsible.Content`)
  // until "More detail" is opened.
  await expect(page.getByLabel('Sleep minutes')).toBeVisible()
  await expect(page.getByLabel('Phone feed minutes')).toBeVisible()
  await expect(page.getByLabel('Desktop feed minutes')).toBeVisible()
  await expect(page.getByRole('button', { name: 'More detail' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(page.getByLabel('Stress (0-10)')).toHaveCount(0)
  await expect(page.getByLabel('Mindfulness minutes')).toHaveCount(0)
  await expect(page.getByLabel('Note')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(0)

  // The working-day scenario's leisure allowance is 20 min/day (revision 1
  // and 2 both set `leisureAllowanceMin: 20`) — 55 is well over it.
  await page.getByLabel('Sleep minutes').fill('420')
  await page.getByLabel('Phone feed minutes').fill('55')

  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('**/today')

  // Neutral save: no exceeded/warning copy anywhere, and CLAUDE.md's own
  // punitive/gamified guard for good measure.
  const todayBodyText = await page.locator('body').innerText()
  expect(todayBodyText).not.toMatch(/exceeded|over your allowance|too much|warning/i)
  await expectNoPunitiveCopy(page)

  // Today's card is implicitly complete now — no "Still needed" line.
  await expect(page.getByText(/still needed/i)).toHaveCount(0)

  const day = await getDay(page, programId, date)
  const phoneRow = day.feed.find((row) => row.device === 'phone')
  expect(phoneRow).toBeDefined()
  expect(phoneRow?.platform).toBe('all')
  expect(phoneRow?.minutes).toBe(55)

  // Reopening shows the form's own literal "Complete" status.
  const reopenedDate = await openCheckinFromToday(page)
  expect(reopenedDate).toBe(date)
  await expect(page.getByRole('status')).toHaveText('Complete')
})

// ---------------------------------------------------------------------------
// Test 2 — subset rule
// ---------------------------------------------------------------------------

test('subset rule: an inconsistent short-video detail row blocks Save inline, and correcting it saves and disables the desktop headline field', async ({
  page,
  demo,
}) => {
  const programId = await currentProgramId(demo)
  const date = await openCheckinFromToday(page)

  await page.getByRole('button', { name: 'More detail' }).click()
  await page.getByRole('button', { name: 'Add row' }).click()

  const row = page.getByRole('group', { name: 'Feed detail row 1' })
  // Desktop has no headline value yet (never touched this test), so this
  // row cannot collide with D36's platform-conflict rule — only the
  // short-video subset rule is under test here.
  // `exact: true` matters for both of these: Playwright's default
  // `getByLabel` match is a case-insensitive SUBSTRING, and "Device" is
  // contained in "From device report"'s label while "Minutes" is contained
  // in "Short-video minutes"'s — a bare (non-exact) lookup for either is a
  // strict-mode violation across two real controls.
  await row.getByLabel('Device', { exact: true }).selectOption('desktop')
  await row.getByLabel('Platform', { exact: true }).fill('reels')
  await row.getByLabel('Minutes', { exact: true }).fill('30')
  await row.getByLabel('Short-video minutes', { exact: true }).fill('45')

  // Inline, reactive — FeedRows.tsx re-validates on every render, no submit needed.
  const subsetError = row.getByText('Short video is a subset of feed minutes and cannot exceed them')
  await expect(subsetError).toBeVisible()

  let sawPutWhileInvalid = false
  try {
    await page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes(`/programs/${programId}/days/${date}`),
      { timeout: 1000 },
    )
    sawPutWhileInvalid = true
  } catch {
    sawPutWhileInvalid = false
  }
  await page.getByRole('button', { name: 'Save' }).click()
  expect(sawPutWhileInvalid).toBe(false)
  // The client-side gate blocked the submit entirely — still on the form.
  await expect(page).toHaveURL(new RegExp(`/checkin/${date}$`))

  await row.getByLabel('Short-video minutes', { exact: true }).fill('20')

  const putAfterFix = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().includes(`/programs/${programId}/days/${date}`),
  )
  await page.getByRole('button', { name: 'Save' }).click()
  await putAfterFix
  await page.waitForURL('**/today')

  const day = await getDay(page, programId, date)
  const desktopDetailRow = day.feed.find((r) => r.device === 'desktop' && r.platform !== 'all')
  expect(desktopDetailRow).toBeDefined()
  expect(desktopDetailRow?.minutes).toBe(30)
  expect(desktopDetailRow?.shortVideoMinutes).toBe(20)

  // D36: a scope-feed detail row for a device disables that device's headline input.
  await openCheckinFromToday(page)
  await expect(page.getByLabel('Desktop feed minutes')).toBeDisabled()
})

// ---------------------------------------------------------------------------
// Test 3 — sleep only
// ---------------------------------------------------------------------------

test('sleep only: saving sleep with no feed leaves feed listed as missing, and phone/desktop render not yet reported, never 0', async ({
  page,
}) => {
  await openCheckinFromToday(page)

  await page.getByLabel('Sleep minutes').fill('420')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('**/today')

  await expect(page.getByText('Still needed: feed')).toBeVisible()
  await expect(page.locator('dt:text-is("Sleep") + dd')).toHaveText('420 min')
  await expect(page.locator('dt:text-is("Phone feed") + dd')).toHaveText('not yet reported')
  await expect(page.locator('dt:text-is("Desktop feed") + dd')).toHaveText('not yet reported')
})

// ---------------------------------------------------------------------------
// Test 4 — skipped day
// ---------------------------------------------------------------------------

test('skipped day: advancing the clock two days and saving only the new day leaves the day between as null/null, never 0', async ({
  page,
  demo,
}) => {
  const programId = await currentProgramId(demo)

  const offsetBefore = await demo.offset()
  await demo.setClock(offsetBefore + 2 * 24 * 60 * 60)

  const newDate = await openCheckinFromToday(page)
  const skippedDate = addDaysToLocalDate(newDate, -1)

  await page.getByLabel('Sleep minutes').fill('420')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('**/today')

  const report = await demo.report(programId)

  const skippedRow = report.days.find((row) => row.localDate === skippedDate)
  expect(skippedRow).toBeDefined()
  expect(skippedRow?.status).toBe('not_reported')
  expect(skippedRow?.sleepMinutes).toBeNull()
  expect(skippedRow?.feedDeviceMinutes).toBeNull()

  const newRow = report.days.find((row) => row.localDate === newDate)
  expect(newRow).toBeDefined()
  expect(newRow?.sleepMinutes).toBe(420)
})

// ---------------------------------------------------------------------------
// Test 5 — edit twice
// ---------------------------------------------------------------------------

test('edit today\'s check-in twice: the second save keeps the first field, adds the headline phone row, and raises the version', async ({
  page,
  demo,
}) => {
  const programId = await currentProgramId(demo)
  const date = await openCheckinFromToday(page)

  await page.getByLabel('Sleep minutes').fill('420')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('**/today')

  const firstDay = await getDay(page, programId, date)
  expect(firstDay.checkin.sleepMinutes).toBe(420)
  expect(firstDay.feed).toHaveLength(0)

  const reopenedDate = await openCheckinFromToday(page)
  expect(reopenedDate).toBe(date)
  await expect(page.getByLabel('Sleep minutes')).toHaveValue('420')

  // No phone detail row exists, so this is sent as the headline row (D36).
  await page.getByLabel('Phone feed minutes').fill('30')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL('**/today')

  const secondDay = await getDay(page, programId, date)
  expect(secondDay.checkin.sleepMinutes).toBe(420)
  const phoneRows = secondDay.feed.filter((row) => row.device === 'phone')
  expect(phoneRows).toHaveLength(1)
  expect(phoneRows[0]?.platform).toBe('all')
  expect(phoneRows[0]?.minutes).toBe(30)
  expect(secondDay.version).toBeGreaterThan(firstDay.version)
})

// ---------------------------------------------------------------------------
// Test 6 — phone viewport
// ---------------------------------------------------------------------------

test('phone viewport: the check-in form fits a 390px width with no horizontal scroll, 44px touch targets and one input column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openCheckinFromToday(page)

  // The form fetches `programs/current` then `days/:date` in sequence
  // (CheckinForm.tsx) and renders an `aria-busy` loading placeholder — no
  // `<form>` at all — until both resolve; wait for a real field before
  // measuring anything, or the counts/overflow check below could run
  // against that placeholder instead of the rendered form.
  await expect(page.getByLabel('Sleep minutes')).toBeVisible()

  const hasNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(hasNoHorizontalOverflow).toBe(true)

  // Scoped to the check-in <form> itself (CheckinForm.tsx's own root
  // element) — the surrounding RailLayout nav renders only <a> links
  // (role="link", react-router's NavLink), never a native input or button,
  // so this scoping is belt-and-braces rather than load-bearing.
  const controls = page.locator('form input, form button')
  const controlCount = await controls.count()
  // Default-visible-fields (8.7.1): sleep, phone, desktop inputs plus
  // "More detail" and Save buttons — five controls, "More detail" collapsed.
  expect(controlCount).toBe(5)
  for (let i = 0; i < controlCount; i++) {
    const box = await controls.nth(i).boundingBox()
    expect(box).not.toBeNull()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  const inputs = page.locator('form input')
  const inputCount = await inputs.count()
  expect(inputCount).toBe(3)
  const leftEdges: number[] = []
  for (let i = 0; i < inputCount; i++) {
    const box = await inputs.nth(i).boundingBox()
    expect(box).not.toBeNull()
    if (box !== null) leftEdges.push(box.x)
  }
  const firstEdge = leftEdges[0]
  expect(firstEdge).toBeDefined()
  for (const x of leftEdges) {
    expect(Math.abs(x - (firstEdge ?? x))).toBeLessThanOrEqual(1)
  }
})
