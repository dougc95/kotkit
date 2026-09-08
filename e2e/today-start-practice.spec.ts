/**
 * Task 8.2.6 (design.md D16, D18, D20, D23; practice-sessions: "Today shows
 * one next action and two blocks" / "Returning user can start in three
 * actions", "One unfinished session per user" / "Second tab"; session-
 * recovery: "Starting a session requires the server"; app-shell: "Responsive
 * layout", "Navigation exists outside session mode only" / "Navigation on
 * Today"). Drives the real Today (8.2.1) -> BlockCard/StartPracticeForm
 * (8.2.2) -> Focus (8.5.3) screens against the `working-day` demo scenario
 * (Day 4, `packages/shared/src/fixtures/demoScenarios.ts` — both baselines
 * already eligible, block 1 already finalized for the day, block 2 not
 * started, so `nextAction` points straight at block 2 with no benchmark or
 * setup detour) through three checks in one test:
 *
 *  - A returning user reaches a running practice session in exactly two user
 *    actions (fill the intended-output field, click Start) — comfortably
 *    inside the "three actions" the spec promises — with no session existing
 *    beforehand (`GET /sessions/active` 204/null) and the real session's
 *    kind and typed intendedOutput confirmed server-side afterward (D20).
 *  - A second page in the SAME browser context, loading `/today` while that
 *    session is still running, renders `ActiveSessionCard` (8.2.5) with a
 *    Return link to the exact same `/focus/:id` and no Start control of its
 *    own INSIDE that card. (`BlockCard`'s own `StartPracticeForm`, elsewhere
 *    on the page, still renders for the now-in-progress block — clicking it
 *    would just get a 409 `active_session_exists` that the form already
 *    swallows silently, per 8.2.2's own brief — so this check is scoped to
 *    the card itself, exactly what 8.2.5 owns, not "no Start button
 *    anywhere on the page".)
 *  - Once that session is abandoned (`POST /sessions/{id}/transitions`
 *    `{type:'abandon'}` — `demo.ts` has no dedicated method for this, so
 *    this file calls the route directly through `page.request`, the same
 *    convention `benchmark-review.spec.ts` already uses for a raw finalize
 *    call), a fresh `/today` at a 390x844 viewport shows the bottom nav
 *    (`data-placement="bottom"`) and both block cards stacked in one visual
 *    column — measured via bounding boxes, not assumed from a CSS class name
 *    — with no horizontal overflow anywhere on the page.
 */
import { expect, test } from './support/demo.js'
import type { TransitionBodyValue } from '@attention-lab/shared'

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

test('returning user starts practice in two actions, a second tab shows Return with no Start inside the card, and a narrow fresh Today stacks one column', async ({
  page,
  demo,
}) => {
  const current = await demo.current()
  if (current.program === null) {
    throw new Error('today-start-practice: GET /programs/current has no program after loading working-day')
  }
  const programId = current.program.id
  const today = await demo.today(programId)

  // -- Today: one header, two block cards, nothing running yet --------------
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: `Day ${today.day} of 14` })).toBeVisible()
  await expect(page.locator('[data-testid="block-card-slot"]')).toHaveCount(2)

  const beforeStart = await demo.active()
  expect(beforeStart).toBeNull()

  // -- Start within <= 3 user actions (practice-sessions: "Returning user
  // can start in three actions") --------------------------------------------
  const intendedOutput = 'Draft the outline for the newsletter piece'
  let actionCount = 0

  await page.getByLabel('What will you produce?').fill(intendedOutput)
  actionCount += 1
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  actionCount += 1

  expect(actionCount).toBeLessThanOrEqual(3)

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`today-start-practice: could not read a session id from the URL "${page.url()}"`)
  }

  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('today-start-practice: GET /sessions/active returned null right after Start')
  }
  expect(active.id).toBe(sessionId)
  expect(active.kind).toBe('practice')
  expect(active.intendedOutput).toBe(intendedOutput)

  // -- Second tab: ActiveSessionCard, Return link, no Start inside the card --
  const secondPage = await page.context().newPage()
  await secondPage.goto('/today')

  const card = secondPage.getByTestId('active-session-card')
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: /start/i })).toHaveCount(0)

  const returnLink = card.getByRole('link', { name: 'Return to your session' })
  await expect(returnLink).toBeVisible()
  await expect(returnLink).toHaveAttribute('href', `/focus/${sessionId}`)

  await secondPage.close()

  // -- Abandon the session, then a fresh narrow /today -----------------------
  const beforeAbandon = await demo.session(sessionId)
  const abandonBody: TransitionBodyValue = { expectedVersion: beforeAbandon.version, type: 'abandon' }
  const abandonResponse = await page.request.post(`/api/v1/sessions/${sessionId}/transitions`, {
    data: abandonBody,
  })
  expect(abandonResponse.status()).toBe(200)
  expect(await demo.active()).toBeNull()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/today')

  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toBeVisible()
  await expect(nav).toHaveAttribute('data-placement', 'bottom')

  const blockSlots = page.locator('[data-testid="block-card-slot"]')
  await expect(blockSlots).toHaveCount(2)
  const firstBox = await blockSlots.nth(0).boundingBox()
  const secondBox = await blockSlots.nth(1).boundingBox()
  if (firstBox === null || secondBox === null) {
    throw new Error('today-start-practice: could not read a bounding box for a block card at the narrow viewport')
  }
  // Single column: the second card starts at the same left edge as the
  // first and below it, never beside it.
  expect(Math.abs(secondBox.x - firstBox.x)).toBeLessThanOrEqual(1)
  expect(secondBox.y).toBeGreaterThanOrEqual(firstBox.y + firstBox.height - 1)

  const hasNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(hasNoHorizontalOverflow).toBe(true)
})
