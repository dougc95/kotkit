/**
 * Task 9.1.3 — the first journey a brand-new user takes: reset, Setup,
 * Readiness, and what Today/Progress show along the way. Six named tests,
 * every one starting from `demo.reset()` (`test.beforeEach` below).
 *
 * Field-level validation (the missing-slot list, the one-hour rule between
 * baseline A and B) is 8.1's own job (`PlanForm.test.tsx` /
 * `ReadinessForm.test.tsx`) and is not repeated here — this file only
 * exercises the real screens end to end, against the built app
 * (`playwright.config.ts`'s `acceptance` project, D37).
 *
 * Test 1 deliberately does NOT assert the literal
 * `RESULT_STATE_COPY.baseline_pending` copy on Progress: that copy only
 * exists once a PROGRAM exists with fewer than two eligible baseline
 * attempts (exercised for real by test 5, after readiness completes).
 * Immediately after `demo.reset()` no program exists at all (`GET
 * /programs/current` returns `program: null`, D22's no-program shape;
 * `demo/scenarios/new-user` fixture — packages/shared's own
 * `demoScenarios.ts` — seeds exactly this: `program: null, expected:
 * {resultState: null}`), and `Progress.tsx` renders its own
 * `ProgressEmptyState` for that case rather than the baseline-pending
 * result-state card — a genuinely different state (CLAUDE.md: "Unknown !=
 * zero" — not-yet-measured is not the same state as measured-and-zero).
 * This test instead asserts the real empty-state copy plus the same
 * substantive guarantees the brief names for it: no percent sign, no
 * computed "0 → 0", and no attention-score wording.
 */
import { RESULT_STATE_COPY } from '@attention-lab/shared'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/demo.js'
import { expectDemoBanner, expectNoPunitiveCopy } from '../support/copy.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Local helpers — only used within this file, so kept local rather than
// added to the shared `e2e/support/*` modules (D16: those are owned by
// 9.1.1/9.1.2, not by individual journey specs).
// ---------------------------------------------------------------------------

/**
 * The local calendar date (`YYYY-MM-DD`) of `instant` in IANA zone
 * `timeZone` — the same fixed computation `e2e/support/demo.ts`'s
 * `readyProgram()` uses for its own `baselineDate`, duplicated here for the
 * same reason that file gives for owning its copy (small enough; keeps this
 * spec's only real dependency on Playwright and the 2.7 contracts).
 */
function localDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`new-user.spec.ts: could not resolve a local date for timeZone "${timeZone}"`)
  }
  return `${year}-${month}-${day}`
}

/**
 * Opens `/setup` and fills only the baseline date, computed from whatever
 * timezone the form itself pre-filled (`localDateAt` above) so Day 0 always
 * lands on the program's real "today" regardless of the host's own
 * UTC/local offset. Every other field keeps its default (10-minute
 * duration, 20-minute leisure allowance, feed estimate blank, timezone left
 * UNCONFIRMED). Returns the pre-filled timezone so a caller can assert
 * against the value actually sent once confirmed.
 */
async function openSetupWithDate(page: Page): Promise<string> {
  await page.goto('/setup')
  // `exact: true` is load-bearing here, not decoration: "Confirm timezone"
  // (the checkbox's own label, right below this select) CONTAINS "Timezone"
  // as a case-insensitive substring, so a non-exact `getByLabel('Timezone')`
  // matches both elements and `.inputValue()` throws a strict-mode
  // violation — the same "one label contains another" gotcha as 'Not
  // accurate' containing 'accurate'.
  const timezone = await page.getByLabel('Timezone', { exact: true }).inputValue()
  await page.getByLabel('Baseline date (Day 0)', { exact: true }).fill(localDateAt(new Date(), timezone))
  return timezone
}

/**
 * Fills the "Material reference" field inside the named readiness row
 * (`ReadinessForm.tsx`'s `SlotRow`: one `<fieldset>` per slot, titled
 * "Baseline A" / "Baseline B" / "Final A" / "Final B"). The label text alone
 * is not unique across the four rows, so this always scopes through the
 * row's own `group` (its `<legend>` is the group's accessible name) first —
 * the same pattern `ReadinessForm.test.tsx`'s own `fillMaterialRef` uses.
 */
async function fillMaterialRef(page: Page, rowTitle: string, value: string): Promise<void> {
  const group = page.getByRole('group', { name: rowTitle, exact: true })
  await group.getByLabel('Material reference').fill(value)
}

/**
 * Fills the named row's own planned-time field. `"${rowTitle} planned
 * time"` IS unique per row (unlike "Material reference"), so no group
 * scoping is needed here.
 */
async function fillPlannedTime(page: Page, rowTitle: string, value: string): Promise<void> {
  await page.getByLabel(`${rowTitle} planned time`, { exact: true }).fill(value)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('new user: /today routes to /setup, and Progress with no program yet shows a neutral not-yet-measured state with no percent sign, no computed 0 -> 0 and no attention wording', async ({
  page,
  demo,
}) => {
  await page.goto('/today')
  await page.waitForURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Set up your plan', exact: true })).toBeVisible()

  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  await expect(
    page.getByText('There is nothing to report yet. Set up your program to start your baseline.'),
  ).toBeVisible()

  // The baseline-pending RESULT STATE card (and any comparison figure) is
  // never mounted here — there is no program yet for it to describe.
  await expect(page.getByTestId('result-state')).toHaveCount(0)
  await expect(page.getByTestId('comparison-figures')).toHaveCount(0)

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('%')
  expect(bodyText).not.toMatch(/\b0\s*(?:→|->)\s*0\b/)
  await expectNoPunitiveCopy(page)

  const current = await demo.current()
  expect(current.program).toBeNull()
})

test('setup: Save is refused until the prefilled timezone is confirmed; a blank feed estimate is stored as not reported', async ({
  page,
  demo,
}) => {
  const timezone = await openSetupWithDate(page)
  await page.getByRole('radio', { name: '10 minutes', exact: true }).check()
  // Feed estimate left blank deliberately — never coerced to 0 (CLAUDE.md).

  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByText('Confirm your timezone before saving.')).toBeVisible()
  await expect(page).toHaveURL(/\/setup$/)
  expect((await demo.current()).program).toBeNull()

  await page.getByLabel('Confirm timezone', { exact: true }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL(/\/setup\/readiness$/)

  const current = await demo.current()
  expect(current.program?.status).toBe('draft')
  expect(current.program?.feedEstimateMinutes).toBeNull()
  expect(current.program?.timezone).toBe(timezone)
  expect(current.revision?.settings.practiceTargetSeconds).toBe(600)
})

test('setup with 5 minutes: practiceTargetSeconds 300 and the Days 1-3 band ceiling in revision.settings.bandCeilings stays 600 s', async ({
  page,
  demo,
}) => {
  await openSetupWithDate(page)
  await page.getByLabel('Confirm timezone', { exact: true }).check()
  await page.getByRole('radio', { name: '5 minutes', exact: true }).check()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL(/\/setup\/readiness$/)

  const current = await demo.current()
  expect(current.revision?.settings.practiceTargetSeconds).toBe(300)

  const daysOneToThree = current.revision?.settings.bandCeilings.find(
    (band) => band.fromDay === 1 && band.toDay === 3,
  )
  // 10 minutes = 600 s — the first band ceiling is unaffected by choosing a
  // 5-minute initial duration (program-setup: "Initial duration below ten
  // minutes").
  expect(daysOneToThree?.minutes).toBe(10)
})

test('readiness complete: four refs, baseline A 09:00 / B 14:00, Save -> /today reads Start with your baseline with next action baseline A; demo.active() is null; program.status baseline_ready', async ({
  page,
  demo,
}) => {
  await openSetupWithDate(page)
  await page.getByLabel('Confirm timezone', { exact: true }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL(/\/setup\/readiness$/)

  await fillMaterialRef(page, 'Baseline A', 'Baseline A — assigned reading')
  await fillPlannedTime(page, 'Baseline A', '09:00')
  await fillMaterialRef(page, 'Baseline B', 'Baseline B — assigned reading')
  await fillPlannedTime(page, 'Baseline B', '14:00')
  await fillMaterialRef(page, 'Final A', 'Final A — assigned reading')
  await fillMaterialRef(page, 'Final B', 'Final B — assigned reading')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL(/\/today$/)

  await expect(page.getByRole('link', { name: 'Start with your baseline', exact: true })).toBeVisible()

  const current = await demo.current()
  expect(current.program?.status).toBe('baseline_ready')

  const { nextAction } = current
  if (nextAction.kind !== 'benchmark') {
    throw new Error(`new-user.spec.ts: expected nextAction.kind "benchmark", got "${nextAction.kind}"`)
  }
  const nextSlot = current.slots.find((slot) => slot.id === nextAction.slotId)
  expect(nextSlot?.phase).toBe('baseline')
  expect(nextSlot?.label).toBe('A')

  expect(await demo.active()).toBeNull()
})

test('Progress after readiness: baseline-pending copy, 0 of 2 baseline samples, empty attempts table, no percent sign', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.readyProgram()

  await page.goto('/progress')

  await expect(page.getByText(/0 of 2 baseline samples eligible/)).toBeVisible()
  await expect(page.getByText(/0 of 2 final samples eligible/)).toBeVisible()
  await expect(page.getByText('No benchmark attempts yet.')).toBeVisible()
  await expect(page.getByTestId('result-state-message')).toHaveText(RESULT_STATE_COPY.baseline_pending.message)
  await expect(page.getByTestId('comparison-figures')).toHaveCount(0)

  // Let the (async, network-backed) export preview finish loading before
  // scanning the whole page for a stray "%".
  await expect(page.getByTestId('export-preview-text')).toBeVisible()
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('%')

  const report = await demo.report(programId)
  expect(report.samples).toEqual({ baselineEligible: 0, finalEligible: 0 })
  expect(report.attempts).toEqual([])
  expect(report.resultState).toBe('baseline_pending')
})

test('demo banner is visible without scrolling on Setup, Readiness, Today and Progress', async ({ page, demo }) => {
  await demo.readyProgram()

  await page.goto('/setup')
  await expectDemoBanner(page)

  await page.goto('/setup/readiness')
  await expectDemoBanner(page)

  await page.goto('/today')
  await expectDemoBanner(page)

  await page.goto('/progress')
  await expectDemoBanner(page)
})
