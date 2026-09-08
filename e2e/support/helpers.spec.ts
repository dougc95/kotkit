/**
 * Task 9.1.2 — verifies the 7.1.5 support helpers this whole Group 9 suite
 * depends on (D16: created once, never redefined) actually do what their
 * own doc comments claim, against the real `acceptance` project. Six
 * cases: a 60 s `advance` matches server-truth `timing.remainingSeconds`
 * within 1 s; `sleep(300)` (past the 60 s clock-gap threshold, D5) raises
 * both the `ClockGapPrompt` and a server `clock_gap` event; `sleep(30)`
 * (under the threshold) raises neither; `hideTab`/`showTab` toggle
 * `document.hidden`/`visibilityState` and fire `visibilitychange`; the copy
 * and axe assertions pass on the real Today screen; and the same
 * assertions FAIL against deliberately injected negative controls (proving
 * the assertions are not vacuously true).
 */
import { installClock, advance, hideTab, showTab, sleep } from './clock.js'
import { expectDemoBanner, expectNoPunitiveCopy, expectNoTechnicalIds } from './copy.js'
import { expectNoSeriousViolations } from './a11y.js'
import { expect, test } from './demo.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

/**
 * `readyProgram()` reaches `baseline_ready` (nextAction 'benchmark'), never
 * a practice-startable Today — these three tests need the real "What will
 * you produce?" BlockCard form, so they load 'working-day' (Day 4, one
 * 15-min practice block left) instead.
 */
test('60 s advance matches server-truth timing.remainingSeconds within 1 s', async ({ page, demo }) => {
  await installClock(page)
  await demo.load('working-day')
  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('helpers.spec.ts: working-day scenario has no governing revision')
  }
  const targetSeconds = current.revision.settings.practiceTargetSeconds

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify the 60 s advance helper')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!

  await advance(page, demo, 60)

  const session = await demo.session(sessionId)
  expect(session.timing.remainingSeconds).toBeGreaterThanOrEqual(targetSeconds - 60 - 1)
  expect(session.timing.remainingSeconds).toBeLessThanOrEqual(targetSeconds - 60 + 1)
})

test('sleep(300) raises the clock-gap prompt and a server clock_gap event', async ({ page, demo }) => {
  await installClock(page)
  await demo.load('working-day')

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify sleep(300) raises a gap')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!

  await sleep(page, demo, 300)

  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()

  // The `clock_gap` event carries `details.resolution` (D26) — it does not
  // exist, on the client or the server, until the user actually answers the
  // prompt; detection alone only opens the dialog. "Yes, it continued" is
  // the lowest-friction real answer.
  await page.getByRole('button', { name: 'Yes, it continued' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // `useClockGap.ts`'s `resolve()` reaches the server-truth `POST
  // /sessions/{id}/clock-gap` endpoint directly (which is what actually
  // updates `timerQuality`/eligibility — already covered by Group 8's own
  // recovery.spec.ts) and separately writes a LOCAL outbox copy of the
  // event for replay/audit purposes, but triggers no flush of its own.
  // Reloading is the same established trigger `recovery.spec.ts`'s
  // "refresh during practice" cases already rely on
  // (`SessionModeProvider`'s boot-time `replayOnLoad`) to push any
  // still-buffered row to `POST /sessions/{id}/events`.
  await page.reload()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  await expect
    .poll(async () => (await demo.session(sessionId)).events.some((event) => event.type === 'clock_gap'))
    .toBe(true)
})

test('sleep(30) raises no clock-gap prompt and no server clock_gap event', async ({ page, demo }) => {
  await installClock(page)
  await demo.load('working-day')

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify sleep(30) raises nothing')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!

  await sleep(page, demo, 30)

  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  const session = await demo.session(sessionId)
  expect(session.events.some((event) => event.type === 'clock_gap')).toBe(false)
})

test('hideTab/showTab toggle document.hidden and visibilityState, firing visibilitychange', async ({ page }) => {
  await page.goto('/today')

  const before = await page.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState }))
  expect(before).toEqual({ hidden: false, state: 'visible' })

  const seenHidden = page.evaluate(
    () => new Promise<boolean>((resolve) => document.addEventListener('visibilitychange', () => resolve(document.hidden), { once: true })),
  )
  await hideTab(page)
  expect(await seenHidden).toBe(true)

  const afterHide = await page.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState }))
  expect(afterHide).toEqual({ hidden: true, state: 'hidden' })

  const seenVisible = page.evaluate(
    () => new Promise<boolean>((resolve) => document.addEventListener('visibilitychange', () => resolve(!document.hidden), { once: true })),
  )
  await showTab(page)
  expect(await seenVisible).toBe(true)

  const afterShow = await page.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState }))
  expect(afterShow).toEqual({ hidden: false, state: 'visible' })
})

test('copy and axe assertions pass on the real Today screen', async ({ page, demo }) => {
  await demo.readyProgram()
  await page.goto('/today')

  await expectDemoBanner(page)
  await expectNoPunitiveCopy(page)
  await expectNoTechnicalIds(page.locator('body'))
  await expectNoSeriousViolations(page, 'helpers-today-positive-control')
})

test('copy and axe assertions FAIL against injected negative controls', async ({ page, demo }) => {
  await demo.readyProgram()
  await page.goto('/today')

  // A punitive word, a raw UUID, and an icon-only button with no accessible
  // name — one deliberate violation per assertion this file verifies.
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.innerHTML = `
      <p>Keep your streak alive!</p>
      <p>session 3fa85f64-5717-4562-b3fc-2c963f66afa6</p>
      <button><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="4"></circle></svg></button>
    `
    document.body.appendChild(container)
  })

  await expect(expectNoPunitiveCopy(page)).rejects.toThrow()
  await expect(expectNoTechnicalIds(page.locator('body'))).rejects.toThrow()
  await expect(expectNoSeriousViolations(page, 'helpers-today-negative-control')).rejects.toThrow()
})
