/**
 * Reusable UI-driven setup-completion helper (task 8.1.4; program-setup
 * spec: "Basic plan captures only what is required" / "Save with optional
 * fields blank", "Readiness step assigns materials and benchmark times" /
 * "Readiness complete", "Saving never starts a timer"; practice-sessions:
 * "Today shows one next action and two blocks").
 *
 * Drives the REAL PlanForm (`apps/web/src/features/setup/PlanForm.tsx`) and
 * ReadinessForm (`apps/web/src/features/setup/ReadinessForm.tsx`) screens —
 * not a raw API shortcut (`../support/demo.ts`'s own `readyProgram()`
 * already exists for a caller that does not care about the UI at all, and
 * stays untouched here: this file owns none of `support/`) — so a later
 * e2e spec that needs "a fresh program, set up, through the real screens"
 * has one place to ask for it instead of re-typing the same form
 * interactions `setup-p01.spec.ts` performs. The one read this helper makes
 * afterward (`GET /programs/current`) goes through `demo` (task 7.1.5's own
 * fixture, `../support/demo.ts`), never a raw `APIRequestContext` of its
 * own.
 *
 * Defaults match `setup-p01.spec.ts` exactly (10-minute practice blocks, a
 * BLANK feed-time estimate, baseline A 09:00 / B 18:00 — an hour-plus apart,
 * satisfying `readiness.ts`'s `atLeastOneHourApart` rule) so the common
 * "just get me to a ready program" call is `completeSetup(page, demo)` with
 * no options at all. Every option stays optional and additive for a caller
 * that needs a different shape (a non-blank feed estimate, a different
 * duration, distinct material text) without forking this file.
 */
import type { Page } from '@playwright/test'
import type { SlotResponseValue } from '@attention-lab/shared'
import type { DemoClient } from '../support/demo.js'

export interface CompleteSetupMaterialRefs {
  readonly baselineA?: string
  readonly baselineB?: string
  readonly finalA?: string
  readonly finalB?: string
}

export interface CompleteSetupOptions {
  /** Practice block duration radio to choose on PlanForm. Defaults to 10 (matches P-01). */
  readonly durationMinutes?: 5 | 10 | 15
  /**
   * Feed-estimate minutes to type on PlanForm. Omitted (the default) leaves
   * the field blank — CLAUDE.md's "Unknown != zero": a caller that wants an
   * explicit `0` measurement must pass `0` here, not omit the option.
   */
  readonly feedEstimateMinutes?: number
  /** Baseline A/B planned local times (`HH:MM`) on ReadinessForm. Must stay >= 1 hour apart. Default '09:00'/'18:00'. */
  readonly baselineATime?: string
  readonly baselineBTime?: string
  /** Material reference text for each of the four readiness-required rows. */
  readonly materialRefs?: CompleteSetupMaterialRefs
}

export interface CompleteSetupResult {
  readonly programId: string
  readonly slots: readonly SlotResponseValue[]
}

const REQUIRED_ROWS: ReadonlyArray<{
  readonly key: 'baseline:A' | 'baseline:B' | 'final:A' | 'final:B'
  readonly defaultMaterialRef: string
}> = [
  { key: 'baseline:A', defaultMaterialRef: 'Baseline A — assigned reading' },
  { key: 'baseline:B', defaultMaterialRef: 'Baseline B — assigned reading' },
  { key: 'final:A', defaultMaterialRef: 'Final A — assigned reading' },
  { key: 'final:B', defaultMaterialRef: 'Final B — assigned reading' },
]

/**
 * The browser's own local calendar date (`YYYY-MM-DD`). Deliberately reads
 * `Date#getFullYear`/`getMonth`/`getDate` (local-timezone accessors) inside
 * `page.evaluate` rather than composing a date on the Node side — PlanForm's
 * own timezone default is `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * read INSIDE the same browser, so the only way to guarantee this date and
 * that default zone agree on what "today" means is to ask the same browser
 * both questions.
 */
async function todayLocalDate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date()
    const year = String(now.getFullYear()).padStart(4, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })
}

/**
 * Runs PlanForm then ReadinessForm to a saved, `baseline_ready` program,
 * ending on `/today`. Assumes the caller already reset demo data
 * (`demo.reset()`) and that no program yet exists for this principal — the
 * same precondition `setup-p01.spec.ts` runs under, and the one
 * `POST /programs` (D18's `program_exists`) itself enforces.
 */
export async function completeSetup(
  page: Page,
  demo: DemoClient,
  options: CompleteSetupOptions = {},
): Promise<CompleteSetupResult> {
  const {
    durationMinutes = 10,
    feedEstimateMinutes,
    baselineATime = '09:00',
    baselineBTime = '18:00',
    materialRefs = {},
  } = options
  const refByKey: Record<(typeof REQUIRED_ROWS)[number]['key'], string | undefined> = {
    'baseline:A': materialRefs.baselineA,
    'baseline:B': materialRefs.baselineB,
    'final:A': materialRefs.finalA,
    'final:B': materialRefs.finalB,
  }

  // -- PlanForm ---------------------------------------------------------
  await page.goto('/')
  await page.waitForURL('**/setup')

  const baselineDate = await todayLocalDate(page)
  await page.getByLabel('Baseline date (Day 0)').fill(baselineDate)
  await page.getByLabel('Confirm timezone').check()
  await page.getByRole('radio', { name: `${durationMinutes} minutes` }).check()
  if (feedEstimateMinutes !== undefined) {
    await page.getByLabel('Current daily feed time (estimate)').fill(String(feedEstimateMinutes))
  }
  await page.getByRole('button', { name: 'Save' }).click()

  // -- ReadinessForm ------------------------------------------------------
  await page.waitForURL('**/setup/readiness')

  for (const row of REQUIRED_ROWS) {
    const fieldset = page.locator(`fieldset[data-slot-key="${row.key}"]`)
    await fieldset.getByLabel('Material reference').fill(refByKey[row.key] ?? row.defaultMaterialRef)
  }
  await page.locator('fieldset[data-slot-key="baseline:A"]').getByLabel('Baseline A planned time').fill(baselineATime)
  await page.locator('fieldset[data-slot-key="baseline:B"]').getByLabel('Baseline B planned time').fill(baselineBTime)
  await page.getByRole('button', { name: 'Save' }).click()

  await page.waitForURL('**/today')

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('completeSetup: GET /programs/current still has no program after saving readiness')
  }
  return { programId: current.program.id, slots: current.slots }
}
