/**
 * Task 9.2.2 — Invariant: reload and URL navigation recover the session
 * without side effects (design.md D5, D6, D9, D17, D18, D20, D21, D24, D38;
 * specs/session-recovery: "Reload recovers the active session" / "Refresh
 * during practice", "Refresh after target passed"; "Recovery buffer is
 * bounded and purged" / "Buffer after sync"; specs/benchmark-assessment:
 * "Fixed interval with no valid pause" / "Interval reached";
 * "Interruption recording during the benchmark" / "Record after
 * returning"; specs/practice-sessions: "Practice timer and elapsed time";
 * specs/app-shell: "Navigation exists outside session mode only" /
 * "Leaving a session by URL"). Five cases, run against the real `acceptance`
 * project (D37's single-origin build-and-serve topology) — each its own
 * independent `test()` (the project's `workers: 1`/`fullyParallel: false`
 * only guarantee ORDER, not shared state; every test below establishes its
 * own fresh scenario via the file-level `demo.reset()`, then `demo.load()`
 * or `demo.readyProgram()`, exactly like every other Group 9 invariant spec).
 *
 * Local helpers only (this task owns none of `e2e/support/*`, D16) —
 * `startWorkingDayBlock`/`readOutboxRowsForSession` are deliberate,
 * self-contained duplicates of the same-named helpers `e2e/recovery.spec.ts`
 * (task 8.10.8) already proved against the dev-server pair: Playwright
 * rejects a `.spec.ts` file importing another `.spec.ts` file once the whole
 * suite is discovered together ("test file X should not import test file
 * Y" — `e2e/helpers/session.ts`'s own header comment documents this exact
 * restriction), so a spec file can only reuse another spec file's logic by
 * re-writing it, not importing it.
 *
 * Two notes on adapting this task's own brief to the real, already-verified
 * app behavior rather than a literal reading of it:
 *
 *  - Test 3's "no review" check reads `session.review.finalizedAt` (and
 *    `outputQuality`), never a literal `session.review === null` — `review`
 *    is D31's own row that "exists from session start; never absent, never
 *    null" (`SessionResponse.review` in `contracts/sessions.ts`); the
 *    brief's "review === null" is read here as "no review content was ever
 *    submitted", which `finalizedAt`/`outputQuality` both staying `null`
 *    establishes precisely, without asserting something the wire contract
 *    makes structurally false.
 *  - Test 5's "leaving by URL" does not use a literal `page.goto('/progress')`
 *    — `SessionLeaveGuard` (`apps/web/src/app/SessionLeaveGuard.tsx`)
 *    intercepts only CLIENT-SIDE router transitions via react-router's
 *    `useBlocker`; a real `page.goto()` is a fresh browser navigation the
 *    guard never sees (no `beforeunload` handler exists, by design — the
 *    component's own header comment, and `e2e/research-settings.spec.ts`'s
 *    task 8.9.4 header comment, both confirm this empirically: "it unloads
 *    the SPA and lands cleanly on [the destination], no guard"). A
 *    same-document `page.goBack()` after an earlier client-side visit to a
 *    rail route IS the history POP the guard intercepts, so that — the same
 *    substitution 8.9.4 already made for this identical spec ref — is what
 *    Test 5 uses instead.
 */
import type { Page } from '@playwright/test'

import { expect, test, type DemoClient } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'

/**
 * `demo.setClock` is an OFFSET added to the real wall clock (D35's
 * absolute-offset contract, `clock.ts`'s own header comment), not a frozen
 * virtual instant — so any REAL time a `page.reload()` itself consumes
 * (navigation, JS bundle re-parse, `AppBootstrap`'s own `GET /me`+session
 * refetch before `timer-digits` reappears) lands on top of whatever
 * `advance()` last set, on both the client's re-derived remaining time and
 * the server's own `remainingSeconds`. Confirmed empirically: the two reload
 * tests below saw 4-12 REAL seconds pass this way against the acceptance
 * project's built server, varying run to run. A ±1 s tolerance around a
 * STATIC `expectedRemaining` (as if reload were instantaneous) is therefore
 * unrealistic; the actual invariant these tests exist to prove — client and
 * server AGREE after reload (D20) — is the separate, still-tight `±1 s`
 * comparison directly above each of these checks. This slack only loosens
 * the lower bound (more real time passing can only ever REDUCE remaining,
 * never increase it, so the upper bound stays a tight `+1`).
 */
const RELOAD_LATENCY_SLACK_SECONDS = 30

// ---------------------------------------------------------------------------
// Local helpers.
// ---------------------------------------------------------------------------

/** Parses `TimerDisplay`'s `mm:ss` text (`lib/clock/remaining.ts`'s `formatRemaining`) into whole seconds. */
function parseRemainingSeconds(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`refresh: could not parse mm:ss from "${text}"`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

async function readRemainingSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId('timer-digits').innerText()
  return parseRemainingSeconds(text)
}

/** The `Off-task` tally `<dd>` (`Tallies.tsx`'s own `dt`/`dd` pairing — three separate elements, never a summed figure). */
function offTaskTally(page: Page) {
  return page.locator("dt:text-is('Off-task') + dd")
}

/**
 * Starts working-day's still-open practice block from a fresh `/today`
 * (fills the intended-output field, clicks Start) and resolves once Focus
 * has actually mounted, returning the new session's id. Assumes the caller
 * already called `demo.load('working-day')`.
 */
async function startWorkingDayBlock(
  page: Page,
  demo: DemoClient,
  intendedOutput = 'Verify reload recovers the session',
): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('refresh: GET /sessions/active returned null right after starting the practice block')
  }
  return active.id
}

/**
 * `demo.readyProgram()` then starts baseline A from Today through the real
 * Ready screen (`Start with your baseline` -> Ready's own `Start`),
 * resolving once Running has actually mounted (its `Record off-task
 * episode` control is visible — Ready itself has no event controls at all,
 * matching `e2e/helpers/session.ts`'s own `startBaselineA` precedent).
 */
async function startReadyBenchmark(page: Page, demo: DemoClient): Promise<{ sessionId: string }> {
  const { slots } = await demo.readyProgram()
  const slotA = slots.find((slot) => slot.phase === 'baseline' && slot.label === 'A')
  if (slotA === undefined) {
    throw new Error('refresh: readyProgram() did not return a baseline A slot')
  }

  await page.goto('/today')
  await page.getByRole('link', { name: 'Start with your baseline' }).click()
  await page.waitForURL(`**/benchmark/${slotA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('button', { name: 'Record off-task episode' }).waitFor({ state: 'visible' })

  const active = await demo.active()
  if (active === null) {
    throw new Error('refresh: GET /sessions/active returned null after starting the benchmark')
  }
  return { sessionId: active.id }
}

/**
 * Reads `sessionId`'s rows straight out of the real IndexedDB outbox
 * (`apps/web/src/lib/outbox/store.ts`'s own database/store/index names,
 * duplicated here as literal strings — this task may not import an
 * `apps/web` source module into a Node-side spec file; mirrors
 * `e2e/recovery.spec.ts`'s own same-named helper). An outbox never opened by
 * this page reads as zero rows, not an error.
 */
async function readOutboxRowsForSession(
  page: Page,
  sessionId: string,
): Promise<ReadonlyArray<{ readonly clientEventId: string }>> {
  return page.evaluate((sid) => {
    return new Promise<ReadonlyArray<{ clientEventId: string }>>((resolve, reject) => {
      const openRequest = indexedDB.open('attention-lab-outbox', 1)
      openRequest.onerror = () => reject(openRequest.error ?? new Error('refresh: indexedDB.open failed'))
      openRequest.onsuccess = () => {
        const db = openRequest.result
        if (!db.objectStoreNames.contains('events')) {
          db.close()
          resolve([])
          return
        }
        const tx = db.transaction('events', 'readonly')
        const index = tx.objectStore('events').index('bySession')
        const getAllRequest = index.getAll(IDBKeyRange.only(sid))
        getAllRequest.onsuccess = () => {
          db.close()
          resolve(getAllRequest.result as ReadonlyArray<{ clientEventId: string }>)
        }
        getAllRequest.onerror = () => {
          db.close()
          reject(getAllRequest.error ?? new Error('refresh: outbox getAll failed'))
        }
      }
    })
  }, sessionId)
}

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Test 1 — practice: reload mid-block shows the correct remaining time.
// ---------------------------------------------------------------------------

test('practice: reloading 6 minutes into a running block shows the correct remaining time, matching GET /sessions/active within 1 s', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('refresh: working-day scenario has no governing revision')
  }
  const targetSeconds = current.revision.settings.practiceTargetSeconds

  await advance(page, demo, 360)
  await page.reload()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const [clientRemaining, serverSession] = await Promise.all([readRemainingSeconds(page), demo.session(sessionId)])
  const serverRemaining = serverSession.timing.remainingSeconds
  const expectedRemaining = targetSeconds - 360

  expect(Math.abs(clientRemaining - serverRemaining)).toBeLessThanOrEqual(1)
  expect(clientRemaining).toBeGreaterThanOrEqual(expectedRemaining - RELOAD_LATENCY_SLACK_SECONDS)
  expect(clientRemaining).toBeLessThanOrEqual(expectedRemaining + 1)

  expect(serverSession.lifecycle).toBe('running')
})

// ---------------------------------------------------------------------------
// Test 2 — benchmark: a saved event and a buffered event both survive
// reload; the buffered one is replayed exactly once.
// ---------------------------------------------------------------------------

test('benchmark: a saved event and a buffered event both survive reload, and the buffered one is replayed exactly once', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { sessionId } = await startReadyBenchmark(page, demo)

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')

  // Record at 07:42 elapsed — this one goes straight through to the server.
  await advance(page, demo, 7 * 60 + 42)
  await page.getByRole('button', { name: 'Record off-task episode' }).click()
  // NOT `expect(syncStatus).toContainText('Saved')` as the synchronization
  // gate here: the outbox is EMPTY before this click too (a fresh session,
  // nothing recorded yet), so `syncStatus` already reads "Saved" from mount
  // — Playwright's own auto-retry is satisfied on the FIRST check when an
  // assertion already holds, so this would pass on that stale prior text
  // without ever waiting for the click's own flush to actually land
  // server-side (confirmed empirically: reproduced this exact race —
  // `demo.session()` right after read zero off_task events). Poll server
  // truth directly instead, the same pattern this file's own later tally
  // check already uses.
  await expect
    .poll(async () => (await demo.session(sessionId)).events.some((event) => event.type === 'off_task' && event.voidedAt === null))
    .toBe(true)
  await expect(syncStatus).toContainText('Saved')

  const afterFirstRecord = await demo.session(sessionId)
  const savedEvent = afterFirstRecord.events.find((event) => event.type === 'off_task' && event.voidedAt === null)
  if (savedEvent === undefined) {
    throw new Error('refresh: expected a saved off_task event after the first Record click')
  }
  expect(savedEvent.elapsedMs).toBeGreaterThanOrEqual(462_000 - 1000)
  expect(savedEvent.elapsedMs).toBeLessThanOrEqual(462_000 + 1000)

  // A second record while the events route is aborted stays Pending —
  // written to the outbox, never reaching the server.
  await page.route('**/api/v1/sessions/*/events', (route) => route.abort())
  await page.getByRole('button', { name: 'Record off-task episode' }).click()
  await expect(syncStatus).toContainText('Pending')
  await page.unroute('**/api/v1/sessions/*/events')

  const bufferedBeforeReload = await readOutboxRowsForSession(page, sessionId)
  expect(bufferedBeforeReload.length).toBeGreaterThan(0)

  await advance(page, demo, 360)
  await page.reload()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  // 1200 s target - (462 + 360) s elapsed = 378 s = 06:18.
  const [clientRemaining, serverSessionAfterReload] = await Promise.all([
    readRemainingSeconds(page),
    demo.session(sessionId),
  ])
  const expectedRemaining = 1200 - (462 + 360)
  expect(Math.abs(clientRemaining - serverSessionAfterReload.timing.remainingSeconds)).toBeLessThanOrEqual(1)
  expect(clientRemaining).toBeGreaterThanOrEqual(expectedRemaining - RELOAD_LATENCY_SLACK_SECONDS)
  expect(clientRemaining).toBeLessThanOrEqual(expectedRemaining + 1)

  // SessionModeProvider's boot-time outbox replay (D6) flushes the buffered
  // row — Playwright's own `toHaveText` retries until this settles.
  await expect(offTaskTally(page)).toHaveText('2')

  await expect
    .poll(async () => {
      const session = await demo.session(sessionId)
      return session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null).length
    })
    .toBe(2)

  const finalSession = await demo.session(sessionId)
  const nonVoidedOffTask = finalSession.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)
  expect(nonVoidedOffTask).toHaveLength(2)
  const distinctIds = new Set(nonVoidedOffTask.map((event) => event.clientEventId))
  expect(distinctIds.size).toBe(2)

  await expect.poll(() => readOutboxRowsForSession(page, sessionId).then((rows) => rows.length)).toBe(0)
})

// ---------------------------------------------------------------------------
// Test 3 — reload after the benchmark deadline: awaiting review, never
// finalized, no review submitted.
// ---------------------------------------------------------------------------

test('reload after the benchmark deadline shows the close-your-material prompt, never finalized, with no review submitted', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { sessionId } = await startReadyBenchmark(page, demo)

  // Past the 1200 s target (D24: the deadline is confirmed by an `end`
  // transition, never by GET — this reload proves the client shows the
  // deadline state locally while the server-side lifecycle only advances on
  // the NEXT transition, per D5's server-timestamps-plus-client-display
  // split).
  await advance(page, demo, 1250)
  await page.reload()

  await expect(page.getByText('Close your reading material')).toBeVisible()

  const main = page.locator('main')
  await expect(main).not.toContainText(/\bcompleted\b/i)

  const session = await demo.session(sessionId)
  // D31: `review` is never absent/null — the row exists from session start.
  // "No review" is read here as "nothing was ever submitted to it".
  expect(session.review.finalizedAt).toBeNull()
  expect(session.review.outputQuality).toBeNull()
  expect(['running', 'awaiting_review']).toContain(session.lifecycle)
})

// ---------------------------------------------------------------------------
// Test 4 — two consecutive reloads do not duplicate the replayed event.
// ---------------------------------------------------------------------------

test('two consecutive reloads do not duplicate the replayed event', async ({ page, demo }) => {
  await installClock(page)
  const { sessionId } = await startReadyBenchmark(page, demo)

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')

  await page.getByRole('button', { name: 'Record off-task episode' }).click()
  await expect(syncStatus).toContainText('Saved')

  await page.route('**/api/v1/sessions/*/events', (route) => route.abort())
  await page.getByRole('button', { name: 'Record off-task episode' }).click()
  await expect(syncStatus).toContainText('Pending')
  await page.unroute('**/api/v1/sessions/*/events')

  const bufferedBeforeReload = await readOutboxRowsForSession(page, sessionId)
  expect(bufferedBeforeReload.length).toBeGreaterThan(0)

  // First reload: the boot-time outbox replay (D6) flushes the buffered row
  // — the server ends up with both events.
  await page.reload()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  await expect
    .poll(async () => {
      const session = await demo.session(sessionId)
      return session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null).length
    })
    .toBe(2)
  await expect.poll(() => readOutboxRowsForSession(page, sessionId).then((rows) => rows.length)).toBe(0)

  // Second, consecutive reload: the outbox already has nothing left to
  // replay — proves the replay is a one-time flush, not a resend of
  // whatever it already flushed.
  await page.reload()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const finalSession = await demo.session(sessionId)
  const nonVoidedOffTask = finalSession.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)
  expect(nonVoidedOffTask).toHaveLength(2)
  const distinctIds = new Set(nonVoidedOffTask.map((event) => event.clientEventId))
  expect(distinctIds.size).toBe(2)

  const outboxAfterSecondReload = await readOutboxRowsForSession(page, sessionId)
  expect(outboxAfterSecondReload).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Test 5 — leaving a session by URL: the leave guard, and Return to session.
// ---------------------------------------------------------------------------

test('leaving a session by URL during a running practice shows the leave guard, and Return to session lands back on /focus/:id unchanged', async ({
  page,
  demo,
}) => {
  await demo.load('working-day')

  // See this file's header comment: a same-document `goBack()` after an
  // earlier client-side visit to Progress is what actually exercises
  // "leaving a session by URL" — a real `page.goto()` is a fresh browser
  // navigation `SessionLeaveGuard` never sees.
  await page.goto('/today')
  await page.getByRole('link', { name: 'Progress', exact: true }).click()
  await page.waitForURL('**/progress')
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await page.waitForURL('**/today')

  const sessionId = await startWorkingDayBlock(page, demo)
  const before = await demo.session(sessionId)

  await page.goBack()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('A session is in progress')
  await expect(dialog.getByRole('button', { name: 'Return to session', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Leave anyway', exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/focus/${sessionId}$`))

  const duringGuard = await demo.session(sessionId)
  expect(duringGuard.lifecycle).toBe(before.lifecycle)
  expect(duringGuard.version).toBe(before.version)

  await dialog.getByRole('button', { name: 'Return to session', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/focus/${sessionId}$`))

  const after = await demo.session(sessionId)
  expect(after.lifecycle).toBe(before.lifecycle)
  expect(after.version).toBe(before.version)
})
