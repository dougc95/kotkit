/**
 * Task 9.3.1 — axe (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA) and responsive checks on
 * the six non-session screens (app-shell: "Accessibility baseline" /
 * "Responsive layout" / "Navigation exists outside session mode only";
 * daily-checkin: "Low burden" / "Default visible fields"; research-cards:
 * "Three finite curated cards"). Uses `expectNoSeriousViolations` and
 * `expectFocusVisible` (7.1.5) exclusively — this file adds no new shared
 * helper of its own (D16: one owner per shared piece; this task's own brief
 * names no new support file).
 *
 * Eleven cases: nine screen-state axe checks (Setup, Readiness, Today,
 * Check-in collapsed, Check-in expanded, Progress x2, Research, Settings),
 * one keyboard-tab-order check on Today's four nav destinations, and one
 * 390x844 responsive check on Check-in. Every test gets a fresh principal
 * via the shared `beforeEach`'s `demo.reset()` and then loads exactly the
 * state its own name promises — no test depends on another's leftover data.
 */
import { expect, test } from '../support/demo.js'
import { expectNoSeriousViolations, expectFocusVisible } from '../support/a11y.js'
import type { Page } from '@playwright/test'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to Today (which must already have a real check-in link — i.e. an
 * open program) and clicks "Open check-in" (`CheckinCard.tsx`), the same
 * route a real user takes to `/checkin/:date` rather than this file guessing
 * at the current local date's arithmetic itself. Returns the resolved date
 * for callers that want it.
 */
async function openCheckinFromToday(page: Page): Promise<string> {
  await page.goto('/today')
  await page.getByRole('link', { name: 'Open check-in' }).click()
  await page.waitForURL(/\/checkin\/\d{4}-\d{2}-\d{2}$/)
  const match = /\/checkin\/(\d{4}-\d{2}-\d{2})$/.exec(page.url())
  if (match?.[1] === undefined) {
    throw new Error(`axe-shell.spec: could not parse a check-in date from ${page.url()}`)
  }
  return match[1]
}

// ---------------------------------------------------------------------------
// Setup / Readiness
// ---------------------------------------------------------------------------

test('Setup has no serious/critical axe violations', async ({ page }) => {
  // beforeEach already reset — no program exists, so PlanForm's blank
  // "Set up your plan" form is what a first-time user actually sees.
  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Set up your plan' })).toBeVisible()

  await expectNoSeriousViolations(page, 'setup')
})

test('Readiness has none', async ({ page, demo }) => {
  // readyProgram() creates the program AND saves all four required slots
  // (baseline_ready), but that only gates the mutation's own onSuccess
  // redirect — an initial GET-render of ReadinessForm shows the existing
  // program's rows regardless of status, never redirecting away (only a
  // `program === null` cache entry does that).
  await demo.readyProgram()
  await page.goto('/setup/readiness')
  await expect(page.getByRole('heading', { name: 'Readiness' })).toBeVisible()

  await expectNoSeriousViolations(page, 'readiness')
})

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

test('Today (working-day) has none', async ({ page, demo }) => {
  await demo.load('working-day')
  await page.goto('/today')
  // A stable signal the two-query load (programs/current -> today) has
  // actually resolved into real content, not the `aria-busy` placeholder.
  await expect(page.getByRole('link', { name: 'Open check-in' })).toBeVisible()

  await expectNoSeriousViolations(page, 'today-working-day')
})

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

test('Check-in collapsed has none', async ({ page, demo }) => {
  await demo.load('working-day')
  await openCheckinFromToday(page)

  // Low burden / Default visible fields (daily-checkin spec): sleep, phone,
  // desktop and Save only — everything else stays out of the DOM until
  // "More detail" is opened.
  await expect(page.getByLabel('Sleep minutes')).toBeVisible()
  await expect(page.getByLabel('Phone feed minutes')).toBeVisible()
  await expect(page.getByLabel('Desktop feed minutes')).toBeVisible()
  await expect(page.getByLabel('Stress (0-10)')).toHaveCount(0)

  await expectNoSeriousViolations(page, 'checkin-collapsed')
})

test('Check-in expanded (platform rows, scope, source, short-video, stress, mindfulness, note) has none', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')
  await openCheckinFromToday(page)

  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  // OptionalFields (stress, mindfulness, note) mounts as soon as the
  // Collapsible opens, with zero detail rows.
  await expect(page.getByLabel('Stress (0-10)')).toBeVisible()
  await expect(page.getByLabel('Mindfulness minutes')).toBeVisible()
  await expect(page.getByLabel('Note')).toBeVisible()

  // A platform detail row (device, platform, scope, source, short-video)
  // only renders once at least one row exists (FeedRows.tsx maps over
  // `rows`) — "Add row" is what puts it there.
  await page.getByRole('button', { name: 'Add row', exact: true }).click()
  const row = page.getByRole('group', { name: 'Feed detail row 1' })
  await expect(row).toBeVisible()
  await expect(row.getByLabel('Platform')).toBeVisible()
  await expect(row.getByLabel('Short-video minutes')).toBeVisible()
  await expect(row.getByText('Measurement scope')).toBeVisible()
  await expect(row.getByText('Feed only')).toBeVisible()
  await expect(row.getByText('From device report')).toBeVisible()

  await expectNoSeriousViolations(page, 'checkin-expanded')
})

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

test('Progress (comparable-change) has none', async ({ page, demo }) => {
  await demo.load('comparable-change')
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
  await expect(page.getByTestId('result-state')).toBeVisible()

  await expectNoSeriousViolations(page, 'progress-comparable-change')
})

test('Progress (missing-final) has none', async ({ page, demo }) => {
  await demo.load('missing-final')
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
  await expect(page.getByTestId('result-state')).toBeVisible()

  await expectNoSeriousViolations(page, 'progress-missing-final')
})

// ---------------------------------------------------------------------------
// Research / Settings
// ---------------------------------------------------------------------------

test('Research has none', async ({ page }) => {
  // research-cards: "Three finite curated cards" — no program is needed to
  // view this screen at all.
  await page.goto('/research')
  await expect(page.getByRole('heading', { name: 'Research' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Curated research cards' })).toBeVisible()

  await expectNoSeriousViolations(page, 'research')
})

test('Settings with demo controls has none', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  // `me.identityMode` is always 'local-demo' in this acceptance environment,
  // so the demo-controls slot (Settings.tsx) always mounts — no extra setup
  // needed to exercise it.
  await expect(page.getByRole('region', { name: 'Demo controls' })).toBeVisible()

  await expectNoSeriousViolations(page, 'settings')
})

// ---------------------------------------------------------------------------
// Keyboard tab order on Today's four destinations
// ---------------------------------------------------------------------------

const DESTINATIONS = ['Today', 'Progress', 'Research', 'Settings'] as const

/**
 * The accessible name of the currently focused element, but ONLY when it is
 * one of RailLayout's own nav links (`nav[aria-label="Main"] a`) — every
 * other focusable stop (the skip link, page content) resolves to `null` so
 * the caller can filter for nav stops alone without hand-parsing hrefs.
 */
async function focusedNavLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (active === null || active.tagName !== 'A') {
      return null
    }
    const nav = active.closest('nav[aria-label="Main"]')
    if (nav === null) {
      return null
    }
    return (active.textContent ?? '').trim()
  })
}

test('Today: the four destinations Today, Progress, Research, Settings are reached by Tab in that relative order with focus visible at each stop', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Open check-in' })).toBeVisible()

  const order: string[] = []
  // The skip link (1 Tab) plus the four nav destinations (4 Tabs) = 5 stops;
  // a generous cap in case another focusable stop is inserted ahead of them.
  for (let tabPress = 0; tabPress < 12 && order.length < DESTINATIONS.length; tabPress++) {
    await page.keyboard.press('Tab')
    const label = await focusedNavLabel(page)
    if (label !== null && (DESTINATIONS as readonly string[]).includes(label) && !order.includes(label)) {
      order.push(label)
      await expectFocusVisible(page)
    }
  }

  expect(order).toEqual([...DESTINATIONS])
})

// ---------------------------------------------------------------------------
// Check-in responsive check at 390x844
// ---------------------------------------------------------------------------

test('Check-in at 390x844: single column, no horizontal scroll, controls at least 24x24 CSS px (WCAG 2.2 AA 2.5.8 minimum, D40), bottom navigation visible', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')
  await page.setViewportSize({ width: 390, height: 844 })
  await openCheckinFromToday(page)
  await expect(page.getByLabel('Sleep minutes')).toBeVisible()

  const hasNoHorizontalOverflow = await page.evaluate(() => {
    const el = document.scrollingElement
    return el === null ? true : el.scrollWidth <= el.clientWidth
  })
  expect(hasNoHorizontalOverflow).toBe(true)

  // Every visible input/button in the check-in form (checkbox/radio would
  // match the same selector but none render until "More detail" is opened,
  // which this test deliberately leaves collapsed) meets the WCAG 2.2 AA
  // 2.5.8 24x24 CSS px minimum (D40) — a stricter 44px target applies
  // elsewhere in this app (RailLayout's NavItem), but 24px is the floor this
  // test actually holds every control to.
  const controls = page.locator('form input, form button, form [role="checkbox"], form [role="radio"]')
  const controlCount = await controls.count()
  expect(controlCount).toBeGreaterThan(0)
  for (let i = 0; i < controlCount; i++) {
    const box = await controls.nth(i).boundingBox()
    expect(box, `control ${i} has no bounding box (not visible?)`).not.toBeNull()
    if (box === null) continue
    expect(box.width).toBeGreaterThanOrEqual(24)
    expect(box.height).toBeGreaterThanOrEqual(24)
  }

  // Single column: every top-level field's own <input> starts at the same
  // left edge (mirrors the established convention in e2e/checkin.spec.ts's
  // own phone-viewport case — inputs only, not buttons, since a full-width
  // button's left edge is a weaker signal of "one input column" than the
  // fields themselves).
  const inputs = page.locator('form input')
  const inputCount = await inputs.count()
  expect(inputCount).toBeGreaterThan(0)
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

  // Below the 768px tablet breakpoint RailLayout switches to a fixed bottom
  // bar (`data-placement="bottom"`) that must stay inside the 844px-tall
  // viewport, not scrolled off or clipped.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toBeVisible()
  await expect(nav).toHaveAttribute('data-placement', 'bottom')
  const navBox = await nav.boundingBox()
  expect(navBox).not.toBeNull()
  if (navBox !== null) {
    expect(navBox.y).toBeGreaterThanOrEqual(0)
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(844)
  }
})
