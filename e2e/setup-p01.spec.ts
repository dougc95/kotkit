/**
 * P-01 (task 8.1.4; program-setup spec: "Basic plan captures only what is
 * required" / "Save with optional fields blank", "Readiness step assigns
 * materials and benchmark times" / "Readiness complete", "Saving never
 * starts a timer"; practice-sessions: "Today shows one next action and two
 * blocks"). Runs the real PlanForm and ReadinessForm screens end to end
 * against the dev-server pair (`../playwright.config.ts`'s `webServer`
 * array — this file lives directly under `e2e/`, matched automatically by
 * that config's `acceptance-dev` project), then asserts the invariant this
 * whole flow exists to protect (CLAUDE.md: "Unknown != zero"): a feed
 * estimate nobody typed is stored as `null`, never coerced to `0`.
 *
 * `completeSetup` (this task's own reusable helper, `helpers/setup.ts`) IS
 * the flow under test here — this spec calls it rather than duplicating its
 * steps inline, so the helper a later spec (8.3.4, 8.2.6, 8.5.6, ...) reuses
 * is exercised for real by its own first caller rather than only by
 * assumption.
 */
import { expect, test } from './support/demo.js'
import { expectNoPunitiveCopy } from './support/copy.js'
import { completeSetup } from './helpers/setup.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('setup with a blank feed estimate lands on Today, baseline_ready, feedEstimateMinutes null', async ({
  page,
  demo,
}) => {
  await completeSetup(page, demo)

  // Lands on Today with its one next action for a fresh, benchmark-ready program.
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('link', { name: 'Start with your baseline' })).toBeVisible()

  // No session was started merely by saving setup (program-setup: "Saving never starts a timer").
  const active = await demo.active()
  expect(active).toBeNull()

  // The program is baseline_ready, and the feed estimate nobody typed stayed
  // `null` all the way to the server — never coalesced to `0` anywhere along
  // PlanForm's submit, the wire body, or storage.
  const current = await demo.current()
  expect(current.program).not.toBeNull()
  expect(current.program?.status).toBe('baseline_ready')
  expect(current.program?.feedEstimateMinutes).toBeNull()

  // No punitive/gamified copy (streak, restart, "attention +", ...) and no
  // invented percentage anywhere on the page — CLAUDE.md's "No invented
  // attention score" carried into the very first screen a user reaches.
  await expectNoPunitiveCopy(page)
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/%/)
})
