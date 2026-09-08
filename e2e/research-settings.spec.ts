/**
 * Task 8.9.4 (design.md D16, D17, D22, D35, D38; research-cards: "Never
 * surfaced in session mode" / "During practice", "External sources open
 * deliberately" / "Read source"; app-shell: "Navigation exists outside
 * session mode only" / "Navigation on Today", "Navigation hidden during
 * practice", "Leaving a session by URL"; identity-realm: "Demo-only controls
 * exist only in demo mode" / "Reset demo data", "Load a demonstration
 * scenario", "Skip to Day 14 in demo mode", "Demo mode is permanently and
 * unmistakably labeled" / "Banner on every screen"). Drives the real
 * `RailLayout` nav (7.1.3), `ResearchCards`/`ResearchCard` (8.9.1),
 * `SessionLayout` (7.1.4) + `SessionLeaveGuard` (7.4.3), and
 * `Settings`/`DemoControls`/`ResetPanel`/`ScenarioLoader`/`DemoClockPanel`
 * (8.9.2/8.9.3) against the real dev-server pair.
 *
 * A note on "leaving a session by URL" (Tests 2 and 3): `SessionLeaveGuard`
 * (`apps/web/src/app/SessionLeaveGuard.tsx`) intercepts only CLIENT-SIDE
 * router transitions (`Link`/`navigate()`/history POP) via react-router's
 * `useBlocker` — its own header comment is explicit that "leaving via the
 * browser itself (close tab, hard reload, back to another origin) is
 * permitted" (no `beforeunload` handler exists, by design: D17 forbids a
 * boot-time redirect, so a fresh document load has nothing to intercept
 * with). A real `page.goto('/research')` in Playwright is exactly such a
 * browser-level navigation (confirmed empirically against the running app:
 * it unloads the SPA and lands cleanly on Research, no guard, since that is
 * the correct, documented behavior) — so it cannot be the mechanism these
 * tests use to exercise the guard. `page.goBack()` after an earlier
 * same-document (client-side) visit to a rail route IS a same-document
 * history POP the guard does intercept — confirmed empirically the same
 * way — so that is what these two tests use instead; the dialog it produces
 * is identical regardless of which rail route the attempted destination is
 * ("A session is in progress" names no destination), and the assertions
 * below independently confirm Research's own content (its "Read source"
 * links) never rendered during the attempt.
 */
import { expect, test } from './support/demo.js'
import { expectDemoBanner } from './support/copy.js'
import { startBaselineA } from './helpers/session.js'

// ---------------------------------------------------------------------------
// Test 1 — navigation outside session mode
// ---------------------------------------------------------------------------

test('navigation outside session mode: Today, Progress, Research and Settings are visible and reachable via Tab', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')
  expect(await demo.active()).toBeNull()

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: /Day \d+ of 14/ })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toBeVisible()

  const destinations = ['Today', 'Progress', 'Research', 'Settings'] as const
  for (const label of destinations) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }

  // Keyboard reachability: Tab from a fresh load walks "Skip to content"
  // then the four destinations, in DOM order (RailLayout.tsx).
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()

  for (const label of destinations) {
    await page.keyboard.press('Tab')
    await expect(nav.getByRole('link', { name: label })).toBeFocused()
  }
})

// ---------------------------------------------------------------------------
// Test 2 — research hidden during practice
// ---------------------------------------------------------------------------

test('research hidden during practice: no navigation, no Research text, and leaving the session by URL is blocked with a return action', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')

  await page.goto('/today')
  // Visit Research once via a real in-app (client-side) navigation, then
  // back to Today, so a later same-document `goBack()` from inside the
  // session has somewhere real to have come from.
  await page.getByRole('link', { name: 'Research', exact: true }).click()
  await page.waitForURL('**/research')
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await page.waitForURL('**/today')

  await page.getByLabel('What will you produce?').fill('Draft the outline for the newsletter piece')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`research-settings: could not read a session id from "${page.url()}"`)
  }

  // Never surfaced in session mode: no top-level nav, no "Research" text
  // anywhere inside the session layout's own main region.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  const main = page.locator('main#main')
  await expect(main).toBeVisible()
  await expect(main).not.toContainText('Research')
  await expect(page.getByRole('link', { name: 'Read source' })).toHaveCount(0)

  // Leaving the session by URL (same-document history navigation) is
  // blocked by SessionLeaveGuard: the attempt never lands anywhere, so
  // Research's own content (its "Read source" links) never renders.
  await page.goBack()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('A session is in progress')
  await expect(page).toHaveURL(/\/focus\//)
  await expect(page.getByRole('link', { name: 'Read source' })).toHaveCount(0)

  const stillActive = await demo.active()
  if (stillActive === null) {
    throw new Error('research-settings: GET /sessions/active returned null while the leave-guard dialog was open')
  }
  expect(stillActive.id).toBe(sessionId)
  expect(stillActive.lifecycle).toBe('running')

  await dialog.getByRole('button', { name: 'Return to session' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/focus\//)
})

// ---------------------------------------------------------------------------
// Test 3 — research hidden during a benchmark
// ---------------------------------------------------------------------------

test('research hidden during a benchmark: the same navigation, text and leave-guard guarantees hold on Running', async ({
  page,
  demo,
}) => {
  await demo.reset()
  const { sessionId } = await startBaselineA(page, demo)

  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  const main = page.locator('main#main')
  await expect(main).toBeVisible()
  await expect(main).not.toContainText('Research')
  await expect(page.getByRole('link', { name: 'Read source' })).toHaveCount(0)

  // Ready -> Running never changed the URL (benchmark-running.spec.ts's own
  // header comment); the entry directly before it is Today, reached by the
  // real "Start with your baseline" client-side navigation, so `goBack()`
  // here is the same same-document POP attempt Test 2 exercises.
  await page.goBack()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('A session is in progress')
  await expect(page).toHaveURL(/\/benchmark\//)
  await expect(page.getByRole('link', { name: 'Read source' })).toHaveCount(0)

  const stillActive = await demo.active()
  if (stillActive === null) {
    throw new Error('research-settings: GET /sessions/active returned null while the leave-guard dialog was open')
  }
  expect(stillActive.id).toBe(sessionId)
  expect(stillActive.lifecycle).toBe('running')

  await dialog.getByRole('button', { name: 'Return to session' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/benchmark\//)
})

// ---------------------------------------------------------------------------
// Test 4 — read source
// ---------------------------------------------------------------------------

test('read source: outside a session, the first card opens its source in a new tab and Research stays put', async ({
  page,
  context,
  demo,
}) => {
  await demo.reset()
  await page.goto('/research')

  const cards = page.getByRole('listitem')
  await expect(cards.first()).toBeVisible()
  const readSourceLink = cards.first().getByRole('link', { name: 'Read source' })
  await expect(readSourceLink).toBeVisible()
  const expectedHref = await readSourceLink.getAttribute('href')
  if (expectedHref === null) {
    throw new Error('research-settings: the first research card has no href on its Read source link')
  }

  const [newPage] = await Promise.all([context.waitForEvent('page'), readSourceLink.click()])
  expect(newPage.url()).toBe(expectedHref)
  expect(page.url()).toContain('/research')

  await newPage.close()
})

// ---------------------------------------------------------------------------
// Test 5 — reset
// ---------------------------------------------------------------------------

test('reset: Settings -> Reset -> confirm posts no body and Today routes to the new-user setup state', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const [resetRequest] = await Promise.all([
    page.waitForRequest((req) => req.url().includes('/api/v1/demo/reset') && req.method() === 'POST'),
    (async () => {
      await page.getByRole('button', { name: 'Reset demo data', exact: true }).click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
    })(),
  ])
  expect(resetRequest.postData()).toBeNull()

  await page.waitForURL('**/setup')
  await expect(page.getByRole('heading', { name: 'Set up your plan' })).toBeVisible()

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('Start with your baseline')
  expect(bodyText).not.toContain('%')

  const current = await demo.current()
  expect(current.program).toBeNull()
  expect(current.nextAction).toEqual({ kind: 'setup' })
})

// ---------------------------------------------------------------------------
// Test 6 — load scenario
// ---------------------------------------------------------------------------

test('load scenario: Settings -> Comparable Change -> Load -> confirm posts no body and lands on Progress showing the improvement headline', async ({
  page,
  demo,
}) => {
  await demo.reset()

  await page.goto('/settings')
  await page.getByRole('combobox', { name: 'Demonstration scenario' }).click()
  await page.getByRole('option', { name: 'Comparable Change' }).click()

  const [loadRequest] = await Promise.all([
    page.waitForRequest(
      (req) => req.url().includes('/api/v1/demo/scenarios/comparable-change/load') && req.method() === 'POST',
    ),
    (async () => {
      await page.getByRole('button', { name: 'Load scenario', exact: true }).click()
      await page.getByRole('button', { name: 'Load', exact: true }).click()
    })(),
  ])
  expect(loadRequest.postData()).toBeNull()

  await page.waitForURL('**/progress')
  await expect(page.getByTestId('result-state-headline')).toContainText('Fewer reported switches')
})

// ---------------------------------------------------------------------------
// Test 7 — skip to Day 14
// ---------------------------------------------------------------------------

test('skip to Day 14: Today shows Day 14 with final A next, and starting it carries timeSource demo_clock', async ({
  page,
  demo,
}) => {
  await demo.reset()
  await demo.readyProgram()

  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Skip to Day 14' })).toBeEnabled()

  await Promise.all([
    page.waitForRequest((req) => req.url().includes('/api/v1/demo/clock') && req.method() === 'POST'),
    page.getByRole('button', { name: 'Skip to Day 14' }).click(),
  ])

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today', exact: true }).click()
  await page.waitForURL('**/today')

  await expect(page.getByRole('heading', { name: 'Day 14 of 14' })).toBeVisible()
  const finalAction = page.getByRole('link', { name: 'Final benchmark A' })
  await expect(finalAction).toBeVisible()

  await finalAction.click()
  await page.waitForURL(/\/benchmark\/[0-9a-f-]{36}$/i)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Record off-task episode' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('research-settings: GET /sessions/active returned null after starting final A')
  }
  expect(active.timeSource).toBe('demo_clock')

  await demo.reset()
})

// ---------------------------------------------------------------------------
// Test 8 — banner without scrolling
// ---------------------------------------------------------------------------

test('demo banner is visible without scrolling on Progress, Research, Settings, check-in and a practice review', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')
  const current = await demo.current()
  if (current.program === null) {
    throw new Error('research-settings: GET /programs/current has no program after loading working-day')
  }
  const today = await demo.today(current.program.id)

  await page.goto('/progress')
  await expectDemoBanner(page)

  await page.goto('/research')
  await expectDemoBanner(page)

  await page.goto('/settings')
  await expectDemoBanner(page)

  await page.goto(`/checkin/${today.localDate}`)
  await expectDemoBanner(page)

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Draft the outline for the newsletter piece')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(/\/review\/[0-9a-f-]{36}$/i)
  await expectDemoBanner(page)
})
