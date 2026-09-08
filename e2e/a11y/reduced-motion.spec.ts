/**
 * Task 9.4.2 — reduced motion disables transitions and animations
 * (design.md's app-shell: Accessibility baseline / Reduced motion —
 * "WHEN the system prefers reduced motion THEN transitions and progress
 * animations are disabled or replaced with instant state changes"). Uses
 * `demo`/`installClock`/`advance`/`sleep` (7.1.5/9.1.1/9.1.2) exclusively —
 * this file adds no new shared support module of its own (D16: one owner
 * per shared piece; this task's own brief names no new support file).
 *
 * `page.emulateMedia({ reducedMotion: 'reduce' })` is called BEFORE the
 * test's first navigation in every case (matching `installClock`'s own
 * documented ordering requirement for the same reason: media-query state
 * that changes after a page has already loaded may leave already-rendered
 * elements on their prior styling) — the app enforces this at exactly two
 * layers, both exercised below:
 *
 *  - CSS (`src/index.css`'s `@media (prefers-reduced-motion: reduce)`
 *    block): a global `*, *::before, *::after` rule forces
 *    `transition-duration`/`animation-duration` to `0.01ms !important` —
 *    deliberately NOT a literal `0`, the standard trick that keeps
 *    `transitionend`/`animationend` listeners firing instead of never
 *    firing at all under a `transition: none`. `expectNoMotion` below
 *    therefore treats any duration at or under 1ms (100x that floor, and
 *    three orders of magnitude under this app's shortest real transition,
 *    Button's/Collapsible.Trigger's 150ms `transition-colors`) as "no
 *    motion", not literal `0` — a real un-neutralized transition fails this
 *    check by a wide margin either way.
 *  - JS (`usePrefersReducedMotion()`, read via `matchMedia` — Playwright's
 *    `emulateMedia` drives both the CSS media query and this): Recharts'
 *    `isAnimationActive={!reducedMotion}` on every `Bar`/`Line`
 *    (PracticeTrend.tsx/DailyTrend.tsx) and TimerDisplay.tsx's own
 *    conditional `transition-opacity` class.
 *
 * Four named cases, one per brief bullet. Each calls `expectNoMotion` at
 * every state transition the brief names, never only once at the end, so a
 * regression that reintroduces motion mid-interaction (not just on initial
 * load) is caught.
 */
import type { Page } from '@playwright/test'
import { advance, installClock, sleep } from '../support/clock.js'
import { expect, test } from '../support/demo.js'

// ---------------------------------------------------------------------------
// expectNoMotion — this file's own local helper (no other spec needs it, so
// it stays here rather than in e2e/support/, per D16's "one owner" reading:
// a helper moves to e2e/support/ only once a second file needs it).
// ---------------------------------------------------------------------------

/** See this file's header comment: `index.css` zeroes to 0.01ms (0.00001s), never a literal 0 — this is comfortably above that floor and comfortably below any real (un-neutralized) transition/animation this app uses. */
const NO_MOTION_EPSILON_SECONDS = 0.001

interface NoMotionResult {
  readonly offenders: readonly string[]
  readonly runningAnimations: number
  readonly svgAnimateElements: number
}

/**
 * Runs entirely inside the page via `page.evaluate` (real Chromium computed
 * styles, real `document.getAnimations()` — never guessed at from outside).
 * Walks `document.body` and every descendant (Radix's `Portal`-rendered
 * dialogs/menus append to `document.body`, so this reaches them too):
 * each element's `transitionDuration` must parse to <= the epsilon above,
 * and each element must either report `animationName: 'none'` or an
 * `animationDuration` also <= that epsilon. Separately asserts zero
 * `document.getAnimations()` entries (no Web Animations API animation
 * actually mid-flight) and zero SVG `<animate>`/`<animateTransform>`
 * elements anywhere in the document (this app defines neither, but a
 * regression introducing one would defeat both the CSS- and JS-layer
 * checks above, which only see `transition`/`animation` properties).
 */
async function readMotionState(page: Page): Promise<NoMotionResult> {
  return page.evaluate(async (epsilonSeconds) => {
    function parseDurations(value: string): number[] {
      return value
        .split(',')
        .map((part) => Number.parseFloat(part.trim()))
        .filter((parsed) => !Number.isNaN(parsed))
    }

    function describe(element: Element): string {
      const testId = element.getAttribute('data-testid')
      const id = element.id
      return testId !== null ? `${element.tagName}[data-testid="${testId}"]` : id !== '' ? `${element.tagName}#${id}` : element.tagName
    }

    const offenders: string[] = []
    const elements = [document.body, ...Array.from(document.body.querySelectorAll('*'))]

    for (const element of elements) {
      const style = getComputedStyle(element)

      const transitionDurations = parseDurations(style.transitionDuration)
      if (transitionDurations.some((duration) => duration > epsilonSeconds)) {
        offenders.push(`${describe(element)} transitionDuration="${style.transitionDuration}"`)
        continue
      }

      if (style.animationName !== 'none') {
        const animationDurations = parseDurations(style.animationDuration)
        if (animationDurations.some((duration) => duration > epsilonSeconds)) {
          offenders.push(
            `${describe(element)} animationName="${style.animationName}" animationDuration="${style.animationDuration}"`,
          )
        }
      }
    }

    // A neutralized 0.01 ms CSS transition (index.css's own reduced-motion
    // floor — a real, running one, not an offender) can still be
    // `playState: 'running'` for a brief instant right after it starts:
    // its own completion is driven by the compositor's rendering timeline,
    // not by `setTimeout`/`Date` (so it settles the same way whether or not
    // a test has installed Playwright's fake clock), but reading
    // `document.getAnimations()` synchronously, in the same tick as the
    // click/navigation that started it, can catch it mid-flight (confirmed
    // empirically: a Today->Progress nav link's own `transition-colors`,
    // `getTiming().duration` reading exactly `0.01`, i.e. correctly
    // neutralized, still reported `playState: 'running'` right after the
    // route change). A single round of awaiting `finished` was not always
    // enough either (also confirmed empirically): a route change's own
    // cascade of re-renders can start a SECOND neutralized transition (e.g.
    // on a different nav item) only after the first one's `finished`
    // promise already resolved. Repeating the await — a bounded LOOP count,
    // never a wall-clock timeout, so this behaves identically whether or
    // not a test has installed the fake clock — lets that whole settling
    // cascade finish. A genuinely long-running (non-neutralized) animation
    // simply never resolves any of these `finished` promises and is still
    // correctly counted below once the loop gives up.
    for (let round = 0; round < 20 && document.getAnimations().length > 0; round += 1) {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})))
    }

    return {
      offenders,
      runningAnimations: document.getAnimations().length,
      svgAnimateElements: document.querySelectorAll('animate, animateTransform').length,
    }
  }, NO_MOTION_EPSILON_SECONDS)
}

/** Asserts every element on `page` is motionless right now (see `readMotionState`'s own header comment for exactly what that means). `label` names the moment being checked in a failing assertion's message — this function is called several times per test, at each state transition the brief names. */
async function expectNoMotion(page: Page, label: string): Promise<void> {
  const result = await readMotionState(page)

  expect(result.offenders, `[${label}] element(s) with a transition/animation duration above the reduced-motion floor`).toEqual([])
  expect(result.runningAnimations, `[${label}] document.getAnimations() reported a running animation`).toBe(0)
  expect(result.svgAnimateElements, `[${label}] an SVG <animate>/<animateTransform> element is present`).toBe(0)
}

// ---------------------------------------------------------------------------
// 1. Today -> Progress route change
// ---------------------------------------------------------------------------

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('Today -> Progress route change under reduce runs no animations', async ({ page, demo }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await demo.load('comparable-change')

  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Open check-in', exact: true })).toBeVisible()
  await expectNoMotion(page, 'Today')

  // A real client-side route change (react-router's <NavLink>, not a full
  // reload) — the case a page-transition animation library would actually
  // touch, which this app has none of.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'Progress', exact: true }).click()
  await page.waitForURL(/\/progress$/)
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  await expectNoMotion(page, 'Progress (after route change)')
})

// ---------------------------------------------------------------------------
// 2. Focus: agent panel open/close, clock-gap prompt, timer digits update
// ---------------------------------------------------------------------------

test('Focus: opening/closing the agent panel and the clock-gap prompt runs no animations and the progress indicator updates without transition', async ({
  page,
  demo,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installClock(page)
  await demo.load('working-day')

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify reduced motion on Focus')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)

  const timerDigits = page.getByTestId('timer-digits')
  await expect(timerDigits).toBeVisible()
  await expectNoMotion(page, 'Focus (idle)')

  // Open the agent panel ("Waiting on an agent?" — AgentPanel.tsx's Radix
  // Collapsible.Trigger toggles open/closed on repeated clicks, per its own
  // test file's `openPanel` helper).
  const agentTrigger = page.getByRole('button', { name: 'Waiting on an agent?', exact: true })
  await agentTrigger.click()
  await expect(page.getByLabel('Workstream')).toBeVisible()
  await expectNoMotion(page, 'Focus (agent panel open)')

  await agentTrigger.click()
  await expect(page.getByLabel('Workstream')).toHaveCount(0)
  await expectNoMotion(page, 'Focus (agent panel closed)')

  // The "progress indicator" — the countdown TimerDisplay renders
  // (`timer-digits`) — updates its text on every tick with no CSS
  // transition class applied under reduce (TimerDisplay.tsx's own
  // `usePrefersReducedMotion()` branch omits `transition-opacity
  // duration-200` entirely rather than relying on the CSS floor alone).
  const before = await timerDigits.textContent()
  await advance(page, demo, 5)
  await expect.poll(() => timerDigits.textContent()).not.toBe(before)
  await expectNoMotion(page, 'Focus (timer digits updated)')

  // sleep(300) — past the 60s clock-gap threshold — raises the prompt.
  await sleep(page, demo, 300)
  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()
  await expectNoMotion(page, 'Focus (clock-gap prompt open)')

  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expectNoMotion(page, 'Focus (clock-gap prompt resolved)')
})

// ---------------------------------------------------------------------------
// 3. Progress charts and the result-state card
// ---------------------------------------------------------------------------

test('Progress charts and the result-state card render with no animations', async ({ page, demo }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // 'working-day' carries six finalized practice blocks (Days 1-3) and three
  // days of check-ins/feed rows — both PracticeTrend's and DailyTrend's bar/
  // line charts render non-empty (`chartData.length > 0`) rather than being
  // skipped, so `isAnimationActive={!reducedMotion}` actually has something
  // to gate (packages/shared/src/fixtures/demoScenarios.ts's own scenario
  // description: "six practice blocks qualified... across Days 1-3").
  await demo.load('working-day')

  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  await expect(page.getByTestId('result-state')).toBeVisible()
  await expect(page.getByTestId('practice-trend-chart')).toBeVisible()
  await expect(page.getByTestId('daily-trend-chart')).toBeVisible()

  await expectNoMotion(page, 'Progress (charts + result-state card)')
})

// ---------------------------------------------------------------------------
// 4. Check-in expand control
// ---------------------------------------------------------------------------

test('Check-in expand control swaps content instantly', async ({ page, demo }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await demo.load('working-day')

  await page.goto('/today')
  await page.getByRole('link', { name: 'Open check-in', exact: true }).click()
  await page.waitForURL(/\/checkin\/\d{4}-\d{2}-\d{2}$/)

  // Default render (CheckinForm.tsx's own header comment): "More detail"'s
  // Collapsible.Content is not present in the DOM at all until opened.
  await expect(page.getByLabel('Stress (0-10)')).toHaveCount(0)

  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  await expect(page.getByLabel('Stress (0-10)')).toBeVisible()

  await expectNoMotion(page, 'Check-in (expanded)')
})
