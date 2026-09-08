/**
 * Task 9.4.1 — Live-region assertion: countdown emits no per-second
 * announcements (design.md D39; specs/app-shell: "Screen reader during a
 * timer" — "WHEN a timer is running and milestone announcements are
 * disabled THEN no live-region updates are emitted by the countdown").
 *
 * `TimerDisplay.tsx` renders `mm:ss` in a PLAIN element (`data-testid`
 * `timer-digits`/`timer-hidden-text`, no `aria-live`) — the app's one shared
 * live region (`ui/LiveRegion.tsx`, mounted once in `Root.tsx`) is reserved
 * for the 5:00/0:00 milestone announcements `useMilestoneAnnouncements.ts`
 * fires, gated by `preferences.milestoneAnnouncements` (default `false`,
 * D22/D39). This file proves the countdown itself never touches that (or
 * any other) live region while ticking — Focus (1), Benchmark Running (2),
 * Recall (3), and Focus with the timer hidden (4) — then proves the
 * milestone path itself actually fires, and only at the two named crossings
 * (5).
 *
 * `installLiveRegionObserver` (an `addInitScript`, installed before this
 * file's first `page.goto` in every test, matching `clock.ts`'s own
 * documented requirement for `installClock`) watches the WHOLE document for
 * childList/characterData mutations and records only the ones whose target
 * lies inside this task's own named selector — so a countdown ticking in a
 * plain element is invisible to it, while `SyncStatus.tsx`'s
 * `role="status"` row, `Recall.tsx`'s retry row and the shared
 * `<LiveRegion>` are exactly what it would catch if any of them fired.
 *
 * Reconciliation note (test 5): this task's own brief describes crossing
 * BOTH 5:00 and 0:00 through "a Focus countdown". The 5:00 crossing
 * genuinely works that way. 0:00 does not, and — as the app is actually
 * built — cannot: `Focus.tsx`'s `deadlineReached ? <deadline UI> :
 * <TimerDisplay .../>` and `remaining.ts`'s `deadlineReached =
 * remainingSecondsRaw <= 0` mean the FIRST render where `remainingSeconds`
 * would reach 0 is the SAME render that removes `TimerDisplay` — and
 * therefore `useMilestoneAnnouncements`, which lives entirely inside it —
 * from the tree. `TimerDisplay`'s last real render under Focus is always
 * `remainingSeconds === 1`; the crossing check (`previous > milestone &&
 * current <= milestone`) never gets a render at `current <= 0` to compare
 * against. `Running.tsx` (Benchmark) has the identical structure — same
 * gap. `Recall.tsx` is the one screen that does NOT swap `TimerDisplay` out
 * at the target (`timeIsUp` only adds an extra `<p role="status">`
 * ALONGSIDE it, per its own source), so it is the only place in this app a
 * 0:00 crossing can actually be observed. Verified by reading
 * `apps/web/src/features/focus/Focus.tsx`, `apps/web/src/lib/clock/
 * remaining.ts`, `apps/web/src/features/benchmark/Running.tsx` and
 * `apps/web/src/features/benchmark/Recall.tsx` directly (no unit test in
 * this repo exercises a MOUNTED 0-crossing through Focus/Running either —
 * `TimerDisplay.test.tsx`/`milestones.test.tsx` only ever drive the hook
 * with an explicit prop, decoupled from the parent screen's own unmount).
 * This test proves 5:00 through Focus (as asked) and 0:00 through Recall
 * (the only reachable path) rather than asserting a Focus behavior that
 * does not exist; flagged in this task's own `blockers` for a human to
 * confirm whether a static status-role insertion standing in for the 0:00
 * announcement on Focus/Benchmark is the intended design.
 */
import type { PatchPreferencesBodyValue } from '@attention-lab/shared'
import type { Page } from '@playwright/test'

import { advance, installClock } from '../support/clock.js'
import { expect, test, type DemoClient } from '../support/demo.js'

// ---------------------------------------------------------------------------
// The observer itself (page-side). Standalone — no closed-over variables —
// so `page.addInitScript` can serialize and run it as-is (mirrors
// `clock.ts`'s `applyTabHidden`).
// ---------------------------------------------------------------------------

interface LiveLogEntry {
  readonly type: string
  readonly text: string | null
}

/**
 * The exact selector this task's own brief names:
 * `[aria-live]:not([aria-live="off"]), [role=status], [role=alert],
 * [role=log], [role=timer][aria-live=polite],
 * [role=timer][aria-live=assertive]`. Watches `document` (childList,
 * characterData, subtree) and appends every mutation whose target lies
 * inside a matching element to `window.__liveLog`.
 */
function installLiveRegionObserver(): void {
  const globalWindow = window as typeof window & { __liveLog?: { type: string; text: string | null }[] }
  globalWindow.__liveLog = []

  const selector =
    '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], [role="timer"][aria-live="polite"], [role="timer"][aria-live="assertive"]'

  function containingElement(node: Node): Element | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement
    }
    return node instanceof Element ? node : null
  }

  const observer = new MutationObserver((records) => {
    const win = window as typeof window & { __liveLog?: { type: string; text: string | null }[] }
    const append = (type: string, text: string | null) => {
      win.__liveLog = [...(win.__liveLog ?? []), { type, text }]
    }
    for (const record of records) {
      // Text (or a child) changing WITHIN an already-present live region:
      // the mutation's own target sits inside a matching ancestor.
      const element = containingElement(record.target)
      if (element !== null && element.closest(selector) !== null) {
        append(record.type, record.target.textContent)
        continue
      }
      // A BRAND NEW live region appearing (e.g. a conditionally-rendered
      // `<p role="status">…</p>` mounting for the first time, `Recall.tsx`'s
      // "Time is up"): the mutation's target is the PARENT the node was
      // inserted into, which does not itself carry the role — the
      // newly-added node (or one of ITS descendants) does. Checking only
      // `record.target`'s own ancestry (as this observer originally did)
      // misses this case entirely: a real screen reader announces a
      // freshly-inserted live region exactly as it would announce new text
      // inside an existing one, so this observer must too (confirmed
      // empirically: 9.4.1's own "Time is up" milestone case recorded zero
      // mutations under the target-only check, despite the paragraph
      // genuinely, visibly appearing in the DOM).
      for (const added of Array.from(record.addedNodes)) {
        const addedElement = containingElement(added)
        if (addedElement === null) {
          continue
        }
        const match = addedElement.matches(selector) ? addedElement : addedElement.querySelector(selector)
        if (match !== null) {
          append(record.type, match.textContent)
        }
      }
    }
  })
  observer.observe(document, { childList: true, characterData: true, subtree: true })
}

async function clearLiveLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { __liveLog?: unknown[] }).__liveLog = []
  })
}

/** The full log's `text` values, in order — an empty array both proves "zero mutations" and reads cleanly against `toEqual`. */
async function liveLogTexts(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    ((window as typeof window & { __liveLog?: LiveLogEntry[] }).__liveLog ?? []).map((entry) => entry.text),
  )
}

// ---------------------------------------------------------------------------
// Preferences (D39) — via `page.request`, relative to the `acceptance`
// project's own `baseURL` (D37), the same convention `e2e/invariants/
// hidden-tab.spec.ts`'s `setVisibilityContext` already established for a
// preference `DemoClient` exposes no generic setter for.
// ---------------------------------------------------------------------------

async function setMilestoneAnnouncements(page: Page, milestoneAnnouncements: boolean): Promise<void> {
  const body: PatchPreferencesBodyValue = { milestoneAnnouncements }
  const response = await page.request.patch('/api/v1/me/preferences', { data: body })
  if (!response.ok()) {
    const bodyText = await response.text().catch(() => '<unreadable body>')
    throw new Error(`PATCH /me/preferences -> ${response.status()}: ${bodyText}`)
  }
}

// ---------------------------------------------------------------------------
// Local helpers to reach each of the three timer screens (this file may not
// import from another `.spec.ts` file — Playwright's own full-suite
// discovery rejects that).
// ---------------------------------------------------------------------------

/** Starts working-day's remaining practice block via the real Today form; resolves once Focus has mounted. */
async function startFocusSession(page: Page, note: string): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(note)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined) {
    throw new Error(`Could not read a session id from ${page.url()}`)
  }
  return sessionId
}

/** Drives Today -> Ready -> Running for baseline A via the real screens; resolves once Running has mounted. */
async function startBaselineARunning(page: Page, demo: DemoClient): Promise<string> {
  const { slots } = await demo.readyProgram()
  const baselineA = slots.find((slot) => slot.phase === 'baseline' && slot.label === 'A')
  if (baselineA === undefined) {
    throw new Error('readyProgram() did not seed a baseline A slot')
  }

  await page.goto('/today')
  await page.getByRole('link', { name: 'Start with your baseline' }).click()
  await page.waitForURL(new RegExp(`/benchmark/${baselineA.id}$`))
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('No active session after starting baseline A')
  }
  return active.id
}

/**
 * Runs baseline A to its fixed 1200 s target (D30), confirms recall
 * ("I'm ready for recall"), then starts the 180 s (3:00) recall countdown
 * ("Start recall"). Resolves once `TimerDisplay` is showing on `Recall`.
 */
async function reachRecallWriting(page: Page, demo: DemoClient): Promise<string> {
  const sessionId = await startBaselineARunning(page, demo)

  await advance(page, demo, 1205) // past the fixed 1200 s benchmark target (D30)
  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(new RegExp(`/benchmark/${sessionId}/recall$`))

  await page.getByRole('button', { name: 'Start recall', exact: true }).click()
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return sessionId
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, demo }) => {
  await demo.reset()
  // Defensive baseline: `demo.reset()` never touches `user_profiles.
  // preferences` (see `e2e/invariants/hidden-tab.spec.ts`'s identical
  // convention for `visibilityContext`) — every case here starts from the
  // documented `milestoneAnnouncements` default (`false`) regardless of
  // what an earlier spec file in this shared-principal run left behind.
  await setMilestoneAnnouncements(page, false)
})

// ---------------------------------------------------------------------------
// (1) Focus
// ---------------------------------------------------------------------------

test('Focus countdown with the default preference: 120 simulated seconds produce zero live-region mutations, and the countdown element carries no aria-live or aria-live=off', async ({
  page,
  demo,
}) => {
  await page.addInitScript(installLiveRegionObserver)
  await installClock(page)
  await demo.load('working-day')

  await startFocusSession(page, 'Verify the countdown never announces per-second (9.4.1)')

  const timerDigits = page.getByTestId('timer-digits')
  await expect(timerDigits).toBeVisible()
  const before = await timerDigits.innerText()

  await clearLiveLog(page)
  await advance(page, demo, 120)

  expect(await liveLogTexts(page)).toEqual([])

  // Proves the observer's silence is meaningful, not vacuous: the
  // underlying countdown really did move over the same window.
  const after = await timerDigits.innerText()
  expect(after).not.toBe(before)

  const ariaLive = await timerDigits.getAttribute('aria-live')
  expect(ariaLive === null || ariaLive === 'off').toBe(true)
})

// ---------------------------------------------------------------------------
// (2) Benchmark Running
// ---------------------------------------------------------------------------

test('Benchmark countdown: zero live-region mutations over 120 s', async ({ page, demo }) => {
  await page.addInitScript(installLiveRegionObserver)
  await installClock(page)

  await startBaselineARunning(page, demo)

  const timerDigits = page.getByTestId('timer-digits')
  const before = await timerDigits.innerText()

  await clearLiveLog(page)
  await advance(page, demo, 120)

  expect(await liveLogTexts(page)).toEqual([])

  const after = await timerDigits.innerText()
  expect(after).not.toBe(before)

  const ariaLive = await timerDigits.getAttribute('aria-live')
  expect(ariaLive === null || ariaLive === 'off').toBe(true)
})

// ---------------------------------------------------------------------------
// (3) Recall
// ---------------------------------------------------------------------------

test('Recall countdown: zero live-region mutations over 60 s', async ({ page, demo }) => {
  await page.addInitScript(installLiveRegionObserver)
  await installClock(page)

  await reachRecallWriting(page, demo)

  const timerDigits = page.getByTestId('timer-digits')
  const before = await timerDigits.innerText()

  await clearLiveLog(page)
  await advance(page, demo, 60)

  expect(await liveLogTexts(page)).toEqual([])

  const after = await timerDigits.innerText()
  expect(after).not.toBe(before)

  const ariaLive = await timerDigits.getAttribute('aria-live')
  expect(ariaLive === null || ariaLive === 'off').toBe(true)
})

// ---------------------------------------------------------------------------
// (4) Timer hidden
// ---------------------------------------------------------------------------

test('timer hidden: zero live-region mutations over 120 s, the remaining time is not in the DOM until revealed, and at the target the session still reaches awaiting review', async ({
  page,
  demo,
}) => {
  await page.addInitScript(installLiveRegionObserver)
  await installClock(page)
  await demo.load('working-day')

  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('working-day scenario has no governing revision')
  }
  const targetSeconds = current.revision.settings.practiceTargetSeconds

  const sessionId = await startFocusSession(page, 'Verify the hidden-timer live region (9.4.1)')

  const timerDigits = page.getByTestId('timer-digits')
  await expect(timerDigits).toBeVisible()
  const initialText = await timerDigits.innerText()

  await page.getByRole('button', { name: 'Hide timer', exact: true }).click()
  await expect(page.getByTestId('timer-hidden-text')).toBeVisible()
  await expect(timerDigits).toHaveCount(0)

  await clearLiveLog(page)
  await advance(page, demo, 120)

  expect(await liveLogTexts(page)).toEqual([])
  // Still hidden: TimerDisplay.tsx renders `timer-hidden-text` INSTEAD OF
  // `timer-digits`, never both — the remaining time is genuinely absent
  // from the DOM, not merely visually covered.
  await expect(timerDigits).toHaveCount(0)
  await expect(page.getByTestId('timer-hidden-text')).toBeVisible()

  await page.getByRole('button', { name: 'Show timer', exact: true }).click()
  await expect(timerDigits).toBeVisible()
  const revealedText = await timerDigits.innerText()
  expect(revealedText).not.toBe(initialText)

  // Continue to the target — hiding the timer is a display preference only
  // and never blocks the session from completing (CLAUDE.md: no invented
  // gate on top of the server-truth countdown).
  await advance(page, demo, targetSeconds - 120 + 5)
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForURL(new RegExp(`/review/${sessionId}$`))

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('awaiting_review')
})

// ---------------------------------------------------------------------------
// (5) Milestone announcements enabled (D39)
// ---------------------------------------------------------------------------

test('milestone announcements enabled (D39): PATCH /me/preferences {milestoneAnnouncements: true}, then advancing a countdown across 5:00 (Focus) and across 0:00 (Recall — see this file\'s reconciliation note) each produce exactly one polite live-region mutation naming that milestone and no others', async ({
  page,
  demo,
}) => {
  await page.addInitScript(installLiveRegionObserver)
  await installClock(page)
  await setMilestoneAnnouncements(page, true)

  // --- 5:00, through Focus -------------------------------------------------
  await demo.load('working-day')
  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('working-day scenario has no governing revision')
  }
  const practiceTargetSeconds = current.revision.settings.practiceTargetSeconds

  await startFocusSession(page, 'Verify the 5:00 milestone announcement (9.4.1)')
  const focusTimerDigits = page.getByTestId('timer-digits')
  await expect(focusTimerDigits).toBeVisible()
  const focusBefore = await focusTimerDigits.innerText()

  await clearLiveLog(page)
  // practiceTargetSeconds (900 s on working-day's Day 4 block) down to a
  // remainder safely below 300 and nowhere near 0 — one crossing only.
  await advance(page, demo, practiceTargetSeconds - 250)

  expect(await liveLogTexts(page)).toEqual(['5 minutes remaining'])
  const focusAfter = await focusTimerDigits.innerText()
  expect(focusAfter).not.toBe(focusBefore)

  // --- 0:00, through Recall (see this file's reconciliation note) ---------
  // Preferences survive a reset (`deletePrincipalData`'s own doc comment;
  // see `hidden-tab.spec.ts`'s identical assumption) — milestoneAnnouncements
  // stays `true` for this session's practice block.
  await demo.reset()
  await reachRecallWriting(page, demo)

  const recallTimerDigits = page.getByTestId('timer-digits')
  const recallBefore = await recallTimerDigits.innerText()

  await clearLiveLog(page)
  await advance(page, demo, 185) // past the fixed 180 s (3:00) recall target

  // `Recall.tsx`'s own literal text (verified by reading the source) — not
  // the truncated "Time is up" this task's brief paraphrased it as.
  expect(await liveLogTexts(page)).toEqual(['Time is up — save when you are ready'])
  const recallAfter = await recallTimerDigits.innerText()
  expect(recallAfter).not.toBe(recallBefore)

  // Restore the default so no later spec file sharing this principal
  // inherits the opt-in (see the module doc comment on `beforeEach`).
  await setMilestoneAnnouncements(page, false)
})
