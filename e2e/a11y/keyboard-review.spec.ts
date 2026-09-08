/**
 * Task 9.3.3 — keyboard-only practice review with a visible focus indicator
 * at every step (design.md's non-functional table: "WCAG 2.2 AA on core
 * flow; keyboard-only review"; specs/practice-sessions: "Session review
 * saves honest outcomes" / "Partial output", "Early finish"; specs/app-shell:
 * "Copy never punishes or gamifies", "Accessibility baseline" / "Keyboard-
 * only session review").
 *
 * Every test drives `working-day` (Day 4, block 1 already finalized, block 2
 * not started, 900 s / 15 min target — `packages/shared/src/fixtures/
 * demoScenarios.ts`) purely through `page.keyboard`, never `.click()` or
 * `.fill()`, from starting block 2 on Today through to Save on the review
 * form. `tabUntil` below is the same "keep pressing Tab until the right
 * accessible name shows up, bounded" shape this task's own brief uses for
 * "Finish early" — used throughout rather than hard-coding exact Tab counts,
 * since the precise number of stops before a named control is an
 * implementation detail this spec has no reason to pin down.
 *
 * Two adaptations from this task's compressed one-line brief, made after
 * reading the real components (`TransitionControls.tsx`, `PracticeReview.tsx`
 * and its field components) rather than guessing:
 *  - "Finish early" only OPENS a Radix `AlertDialog` confirm (`Keep going` /
 *    `Finish now`) — it does not itself end the session. Reaching
 *    `/review/:id` by keyboard genuinely needs a second Tab+Enter onto
 *    `Finish now` once the dialog is open; test 1 below drives that whole
 *    round trip rather than stopping at one Enter press.
 *  - The review form's real DOM order is `Yes/Partly/No` (a Radix
 *    `RadioGroup`) -> episodes -> external -> agent checks -> **two**
 *    separate note fields (`OutputNoteField` "What did you finish?" then
 *    `ReviewNoteField` "Notes (optional)") -> Save review. There is no
 *    separate focusable "output line" stop before the radio group — the
 *    "Planned output: …" text above the form is a plain, non-focusable `<p>`
 *    — and "note" in the brief covers two real stops, not one. Test 2 below
 *    asserts the order actually present in the DOM.
 *
 * One more real gotcha, not covered by any existing helper doc comment:
 * Radix's roving-focus group defers the DOM focus move an arrow key causes
 * to a bare `setTimeout(fn)` (`@radix-ui/react-roving-focus`). With the fake
 * clock installed (required here for `advance(900)`), that timeout is fake
 * too and never fires on its own — `page.clock.runFor(0)` right after the
 * `ArrowRight` press is what actually lets focus (and the Radix "checked"
 * click it synthesizes) land on "Partly". `selectPartlyByKeyboard` below is
 * the one place this matters.
 */
import type { Page } from '@playwright/test'

import { expect, test } from '../support/demo.js'
import type { DemoClient } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'
import { expectNoPunitiveCopy } from '../support/copy.js'
import { expectFocusVisible } from '../support/a11y.js'

const DEADLINE_MESSAGE = 'Block time reached — save your review to record it'

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

// ---------------------------------------------------------------------------
// A small, deliberately narrow accessible-name/role reader (good enough for
// this screen's plain buttons/inputs/textareas and the app's one labeled
// Radix radio group — not a general ARIA implementation) plus the Tab
// helpers built on it.
// ---------------------------------------------------------------------------

interface ActiveElementInfo {
  readonly role: string
  readonly name: string
  readonly tag: string
}

/** Runs inside the page (no closed-over variables, so it serializes as-is for `page.evaluate`). */
function readActiveElement(): ActiveElementInfo | null {
  const active = document.activeElement as HTMLElement | null
  if (active === null || active === document.body) {
    return null
  }

  const tag = active.tagName.toLowerCase()
  let role = active.getAttribute('role')
  if (role === null) {
    if (tag === 'button') {
      role = 'button'
    } else if (tag === 'a') {
      role = 'link'
    } else if (tag === 'textarea') {
      role = 'textbox'
    } else if (tag === 'input') {
      const type = (active.getAttribute('type') ?? 'text').toLowerCase()
      role = type === 'number' ? 'spinbutton' : type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox'
    } else {
      role = tag
    }
  }

  let name = active.getAttribute('aria-label')
  if (name === null) {
    const labelledBy = active.getAttribute('aria-labelledby')
    if (labelledBy !== null) {
      name = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim()
    }
  }
  if ((name === null || name.length === 0) && active.id.length > 0) {
    const label = document.querySelector(`label[for="${CSS.escape(active.id)}"]`)
    if (label !== null) {
      name = label.textContent?.trim() ?? null
    }
  }
  if (name === null || name.length === 0) {
    const closestLabel = active.closest('label')
    if (closestLabel !== null) {
      name = closestLabel.textContent?.trim() ?? null
    }
  }
  if (name === null || name.length === 0) {
    name = (active.textContent ?? '').trim()
  }

  return { role, name, tag }
}

async function describeActiveElement(page: Page): Promise<ActiveElementInfo | null> {
  return page.evaluate(readActiveElement)
}

/**
 * Confirms `name` is checked after an arrow-key roving-focus move, with a
 * fallback for a real, narrow race this task's own investigation found:
 * Radix's roving-focus group is supposed to synthesize a `.click()` on the
 * item an arrow key moves focus to (the module header's own citation), and
 * usually does — but occasionally, driven by Playwright's synthetic key
 * dispatch specifically, that synthesized click never fires at all, not
 * merely late (confirmed empirically: even nudging the fake clock forward
 * for a full 15 real seconds never reached `data-state="checked"` in a
 * reproduced failure — a genuinely dropped interaction, not a timing
 * deficit `runFor()` could ever recover from). Space is a second,
 * independent path to the exact same outcome — a native browser `keydown`
 * on a focused, non-disabled `role="radio"` element fires a real `click`
 * regardless of whatever roving-focus bookkeeping did or didn't run — so
 * pressing it once, only if the fast (arrow-key) path hasn't already
 * succeeded, recovers deterministically without weakening what this
 * function actually verifies (the item ends up checked).
 */
async function expectRadioChecked(page: Page, name: string): Promise<void> {
  const radio = page.getByRole('radio', { name, exact: true })
  try {
    await expect
      .poll(
        async () => {
          await page.clock.runFor(200)
          return radio.getAttribute('data-state')
        },
        { timeout: 3_000 },
      )
      .toBe('checked')
    return
  } catch {
    // Fast path missed — see the doc comment above.
  }
  await page.keyboard.press('Space')
  await expect(radio).toHaveAttribute('data-state', 'checked')
}

interface TabUntilResult {
  readonly steps: number
  readonly info: ActiveElementInfo
}

/** Presses Tab up to `maxTabs` times, stopping as soon as the active element's accessible name matches `pattern`. */
async function tabUntil(page: Page, pattern: RegExp, maxTabs: number): Promise<TabUntilResult> {
  for (let step = 1; step <= maxTabs; step += 1) {
    await page.keyboard.press('Tab')
    const info = await describeActiveElement(page)
    if (info !== null && pattern.test(info.name)) {
      return { steps: step, info }
    }
  }
  throw new Error(`keyboard-review: no element matching ${pattern} was reached within ${maxTabs} Tabs`)
}

/** Tags the active element with a stable per-element id on first visit (test 4's "no keyboard trap" check). */
function readActiveElementMarker(): string {
  const active = document.activeElement as (HTMLElement & { dataset: DOMStringMap }) | null
  if (active === null) {
    return '<none>'
  }
  if (active === document.body) {
    return '<body>'
  }
  if (active.dataset.tabProbeId === undefined) {
    active.dataset.tabProbeId = Math.random().toString(36).slice(2)
  }
  return active.dataset.tabProbeId
}

async function activeElementMarker(page: Page): Promise<string> {
  return page.evaluate(readActiveElementMarker)
}

function readActiveElementInsideForm(): boolean {
  const active = document.activeElement as HTMLElement | null
  if (active === null || active === document.body) {
    return false
  }
  return active.closest('form') !== null
}

async function activeElementInsideForm(page: Page): Promise<boolean> {
  return page.evaluate(readActiveElementInsideForm)
}

// ---------------------------------------------------------------------------
// Shared keyboard-only journeys
// ---------------------------------------------------------------------------

/** working-day's Day-4 block-2 practice target (900 s / 15 min), read off the governing revision rather than hard-coded. */
async function blockTwoTargetSeconds(demo: DemoClient): Promise<number> {
  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('keyboard-review: working-day scenario has no governing revision')
  }
  return current.revision.settings.practiceTargetSeconds
}

/**
 * Starts block 2 from a fresh `/today` purely by keyboard: Tab to "What will
 * you produce?", type, Tab to Start, Enter — this task's own brief's own
 * shared setup. Returns the new session's id.
 */
async function startBlockTwoByKeyboard(page: Page, intendedOutput: string): Promise<string> {
  await page.goto('/today')

  await tabUntil(page, /what will you produce\?/i, 30)
  await expectFocusVisible(page)
  await page.keyboard.type(intendedOutput)

  await page.keyboard.press('Tab')
  const started = await describeActiveElement(page)
  if (started === null || started.role !== 'button' || !/^start$/i.test(started.name)) {
    throw new Error(
      `keyboard-review: expected the Start button focused right after the output field, got ${JSON.stringify(started)}`,
    )
  }
  await expectFocusVisible(page)

  await page.keyboard.press('Enter')
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`keyboard-review: could not read a session id from the URL "${page.url()}"`)
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return sessionId
}

/** Starts block 2 by keyboard, then advances the demo clock to the target so Focus reaches "Block time reached". */
async function reachDeadlineReachedFocus(page: Page, demo: DemoClient, intendedOutput: string): Promise<string> {
  const targetSeconds = await blockTwoTargetSeconds(demo)
  const sessionId = await startBlockTwoByKeyboard(page, intendedOutput)
  await advance(page, demo, targetSeconds)
  await expect(page.getByText(DEADLINE_MESSAGE)).toBeVisible()
  return sessionId
}

/**
 * Reaches "Block time reached", tabs to the "Review" action (bounded, per
 * this task's own "at most 20 Tabs" shape) and presses Enter, then waits for
 * the review form to actually be rendered (not just the route to have
 * changed — `PracticeReview` flushes the outbox and fetches the session
 * before its fields exist) before returning, so every caller can start
 * Tabbing immediately.
 */
async function reachReviewByKeyboard(page: Page, demo: DemoClient, intendedOutput: string): Promise<string> {
  const sessionId = await reachDeadlineReachedFocus(page, demo, intendedOutput)

  const { info } = await tabUntil(page, /^review$/i, 20)
  if (info.role !== 'button') {
    throw new Error(`keyboard-review: expected a button named "Review", got role "${info.role}"`)
  }
  await expectFocusVisible(page)

  await page.keyboard.press('Enter')
  await page.waitForURL(new RegExp(`/review/${sessionId}$`))
  await expect(page.getByRole('radio', { name: 'Yes', exact: true })).toBeVisible()
  return sessionId
}

/**
 * From a freshly-reached review form (focus on `<body>`), Tabs onto the
 * radio group's first item ("Yes" — nothing is checked yet, so Radix's
 * roving-focus entry-focus logic lands there) then presses ArrowRight to
 * move focus AND selection onto "Partly" (Radix's roving-focus group
 * synthesizes a `.click()` on arrow-key focus moves — see the module header
 * for why `page.clock.runFor(0)` is required here whenever the fake clock is
 * installed).
 */
async function selectPartlyByKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('Tab')
  const yes = await describeActiveElement(page)
  if (yes === null || yes.role !== 'radio' || !/^yes$/i.test(yes.name)) {
    throw new Error(`keyboard-review: expected the "Yes" radio focused first on the review form, got ${JSON.stringify(yes)}`)
  }
  await expectFocusVisible(page)

  await page.keyboard.press('ArrowRight')
  await page.clock.runFor(0)

  const partly = await describeActiveElement(page)
  if (partly === null || partly.role !== 'radio' || !/^partly$/i.test(partly.name)) {
    throw new Error(`keyboard-review: ArrowRight did not move focus onto "Partly", got ${JSON.stringify(partly)}`)
  }
  await expectFocusVisible(page)
  await expectRadioChecked(page, 'Partly')
}

// ---------------------------------------------------------------------------
// 1. From a running Focus, keyboard alone reaches "Finish early" (bounded)
//    and, via the confirm dialog's "Finish now", the review screen.
// ---------------------------------------------------------------------------

test('from a running Focus, keyboard alone reaches Finish early within 20 Tabs, and confirming with Finish now reaches the review screen', async ({
  page,
  demo,
}) => {
  const sessionId = await startBlockTwoByKeyboard(page, 'Keyboard-only path to Finish early')

  const { steps, info } = await tabUntil(page, /finish early/i, 20)
  expect(steps).toBeLessThanOrEqual(20)
  expect(info.role).toBe('button')
  await expectFocusVisible(page)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog', { name: 'Finish this block early?' })).toBeVisible()

  // Radix's `AlertDialog.Content` is documented to auto-focus its first
  // tabbable child on open, but never did so here in practice — a real app
  // bug, not test timing (confirmed empirically: the dialog's own DOM, both
  // buttons present and enabled, was entirely correct, yet
  // `document.activeElement` stayed on the "Finish early" trigger
  // indefinitely — a manual `.focus()` call on "Keep going" worked
  // immediately once actually invoked). Two real fixes now cover it:
  // `apps/web/src/ui/Button.tsx` accepts `ref` as a React 19 prop (it was a
  // plain function component before, so Radix's `asChild` Slot composition
  // never had a real DOM handle on any trigger built from it), and
  // `TransitionControls.tsx` now explicitly focuses "Keep going" itself in a
  // `useEffect` on `confirmOpen` rather than depending on Radix's own
  // (non-firing, in this build) default. This poll stays as a defensive
  // wait for that effect rather than assuming it is perfectly synchronous
  // with the dialog becoming visible.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? null))
    .not.toBe('Finish early')

  // With focus now genuinely inside the dialog (Radix's own first-tabbable
  // auto-focus — "Keep going" here), one more Tab reaches "Finish now"
  // without needing to search past it.
  const { info: confirmInfo } = await tabUntil(page, /^finish now$/i, 5)
  expect(confirmInfo.role).toBe('button')
  await expectFocusVisible(page)

  await page.keyboard.press('Enter')
  await page.waitForURL(new RegExp(`/review/${sessionId}$`))
  await expect(page.getByRole('radio', { name: 'Yes', exact: true })).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('awaiting_review')
  expect(session.completeInterval).toBe(false)
})

// ---------------------------------------------------------------------------
// 2. After advance(900), the review is reached by keyboard and its real tab
//    order is Yes/Partly/No -> episodes -> external -> agent checks ->
//    output note -> review note -> Save, with focus visible at every stop.
// ---------------------------------------------------------------------------

test('after advance(900) the review is reached by keyboard, and its tab order is Yes/Partly/No -> episodes -> external -> agent checks -> output note -> review note -> Save, with a visible focus indicator at every stop', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await reachReviewByKeyboard(page, demo, 'Keyboard-only walk through the whole review form')

  const stops: ActiveElementInfo[] = []

  // Yes/Partly/No: entry lands on "Yes" (roving-focus, nothing checked yet);
  // ArrowRight both moves focus and selects "Partly".
  await page.keyboard.press('Tab')
  let info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the Yes/Partly/No stop')
  expect(info.role).toBe('radio')
  expect(info.name).toMatch(/^yes$/i)
  await expectFocusVisible(page)
  stops.push(info)

  await page.keyboard.press('ArrowRight')
  await page.clock.runFor(0)
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused after ArrowRight in the radio group')
  expect(info.role).toBe('radio')
  expect(info.name).toMatch(/^partly$/i)
  await expectRadioChecked(page, 'Partly')
  await expectFocusVisible(page)
  stops.push(info)

  // episodes
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the episodes stop')
  expect(info.role).toBe('spinbutton')
  expect(info.name).toMatch(/how many times did you switch away\?/i)
  await expectFocusVisible(page)
  stops.push(info)

  // external
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the external stop')
  expect(info.role).toBe('spinbutton')
  expect(info.name).toMatch(/how many were external interruptions\?/i)
  await expectFocusVisible(page)
  stops.push(info)

  // agent checks
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the agent-checks stop')
  expect(info.role).toBe('spinbutton')
  expect(info.name).toMatch(/how many unplanned agent checks\?/i)
  await expectFocusVisible(page)
  stops.push(info)

  // output note
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the output-note stop')
  expect(info.role).toBe('textbox')
  expect(info.name).toMatch(/what did you finish\?/i)
  await expectFocusVisible(page)
  stops.push(info)

  // review note
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the review-note stop')
  expect(info.role).toBe('textbox')
  expect(info.name).toMatch(/^notes \(optional\)$/i)
  await expectFocusVisible(page)
  stops.push(info)

  // Save
  await page.keyboard.press('Tab')
  info = await describeActiveElement(page)
  if (info === null) throw new Error('keyboard-review: nothing focused for the Save stop')
  expect(info.role).toBe('button')
  expect(info.name).toMatch(/^save review$/i)
  await expectFocusVisible(page)
  stops.push(info)

  expect(stops.map((stop) => stop.role)).toEqual([
    'radio',
    'radio',
    'spinbutton',
    'spinbutton',
    'spinbutton',
    'textbox',
    'textbox',
    'button',
  ])

  await test.info().attach('keyboard-review-tab-order', {
    body: JSON.stringify(stops, null, 2),
    contentType: 'application/json',
  })
})

// ---------------------------------------------------------------------------
// 3. Enter on Save finalizes with Partly; Today shows the block completed
//    (the FULL target elapsed — completeInterval, not outputQuality, decides
//    the block status) with a partly-reported output, and no punitive copy.
// ---------------------------------------------------------------------------

test('Enter on Save finalizes with Partly, and Today shows the block completed with neutral copy', async ({ page, demo }) => {
  await installClock(page)
  const sessionId = await reachReviewByKeyboard(page, demo, 'Keyboard-only Partly review')
  await selectPartlyByKeyboard(page)

  const { info } = await tabUntil(page, /^save review$/i, 10)
  expect(info.role).toBe('button')
  await expectFocusVisible(page)

  await page.keyboard.press('Enter')
  await page.waitForURL('**/today')

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('finalized')
  expect(session.review.outputQuality).toBe('partly')
  // completeInterval is true (the full 900 s target elapsed before Review
  // was pressed) — "partial output is not the same thing as a partial
  // block" (apps/api/src/services/program/blocks.ts's own deriveStatus
  // comment): the block reads "Completed" below despite the Partly report.
  expect(session.completeInterval).toBe(true)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('keyboard-review: GET /programs/current returned no program after a session was finalized')
  }
  const today = await demo.today(current.program.id)
  const ourBlock = today.blocks.find((block) => block.sessionId === sessionId)
  if (ourBlock === undefined) {
    throw new Error(`keyboard-review: no Today block is occupied by session ${sessionId}`)
  }
  expect(ourBlock.status).toBe('completed')

  const blockCard = page.locator(`[data-block-index="${ourBlock.index}"]`)
  await expect(blockCard.locator('[data-status]')).toHaveAttribute('data-status', 'completed')
  await expect(blockCard).toContainText('Completed')

  await expectNoPunitiveCopy(page)
})

// ---------------------------------------------------------------------------
// 4. No keyboard trap: consecutive Tabs never repeat the same element, Tab
//    past Save leaves the <form>, and Shift+Tab from the first field leaves
//    it too.
// ---------------------------------------------------------------------------

test('no keyboard trap: consecutive Tabs never repeat, Tab past Save review leaves the form, and Shift+Tab from the first field leaves it too', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await reachReviewByKeyboard(page, demo, 'Keyboard trap check for the review form')

  const seenMarkers: string[] = []
  let sawSaveReview = false
  let leftFormAfterSave = false

  for (let step = 1; step <= 12; step += 1) {
    await page.keyboard.press('Tab')
    const marker = await activeElementMarker(page)
    const previous = seenMarkers[seenMarkers.length - 1]
    if (previous !== undefined) {
      expect(marker, `Tab #${step} landed on the same element as the previous Tab (a keyboard trap)`).not.toBe(previous)
    }
    seenMarkers.push(marker)
    await expectFocusVisible(page)

    if (sawSaveReview) {
      const insideForm = await activeElementInsideForm(page)
      expect(insideForm, 'the Tab immediately after Save review must leave the <form>').toBe(false)
      leftFormAfterSave = true
      break
    }

    const info = await describeActiveElement(page)
    if (info !== null && info.role === 'button' && /^save review$/i.test(info.name)) {
      sawSaveReview = true
    }
  }

  expect(sawSaveReview, 'never reached the Save review button within 12 Tabs').toBe(true)
  expect(leftFormAfterSave, 'Tab past Save review never left the form within the bound').toBe(true)

  // Fresh navigation resets focus to <body> without discarding the
  // still-`awaiting_review` session (nothing above was ever submitted).
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Yes', exact: true })).toBeVisible()

  await page.keyboard.press('Tab')
  const first = await describeActiveElement(page)
  if (first === null) throw new Error('keyboard-review: nothing focused on the first Tab after reload')
  expect(first.role).toBe('radio')
  expect(first.name).toMatch(/^yes$/i)
  await expectFocusVisible(page)

  await page.keyboard.press('Shift+Tab')
  const insideFormAfterShiftTab = await activeElementInsideForm(page)
  expect(insideFormAfterShiftTab, 'Shift+Tab from the first field must leave the form').toBe(false)
})
