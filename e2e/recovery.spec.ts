/**
 * Task 8.10.8 (design.md D5, D6, D9, D17, D18, D20, D21, D24-D26, D28, D38;
 * specs/session-recovery: "Pending, saved and could-not-save are distinct",
 * "Events are buffered, deduplicated and acknowledged", "Starting a session
 * requires the server" / "Start while offline", "Clock gaps are detected
 * and resolved by the user" / "Laptop slept during a benchmark" / "Deadline
 * passed during sleep", "Reload recovers the active session" / "Refresh
 * during practice" / "Refresh after target passed", "Stale writes conflict
 * instead of overwriting" / "Two tabs end a session", "Abandon and
 * save-incomplete are always available", "Recovery buffer is bounded and
 * purged"; specs/practice-sessions: "One unfinished session per user" /
 * "Second tab"; specs/app-shell: "Implementation details are not
 * user-facing" / "Sync state display"). The LAST spec in this chain — ten
 * sub-cases, each its own independent `test()` (workers: 1, so they run
 * strictly in sequence against the one shared local-demo principal; no test
 * depends on another's leftover state — every test either `demo.reset()`s
 * for a fresh benchmark program or `demo.load('working-day')`s, both of
 * which fully replace the principal's prior program data).
 *
 * Reuses, never redefines: `test`/`expect`/`DemoClient` from
 * `./support/demo.js` (7.1.5); `advance`/`installClock`/`sleep` from
 * `./support/clock.js` (7.1.5 — `sleep`'s own doc comment is exactly the
 * "laptop slept" simulation tests 3-5 need: `page.clock.setSystemTime` with
 * no timers run, the matching `demo.setClock` offset, then `runFor(5000)`
 * so the real 5 s heartbeat, not this file, is what notices the gap);
 * `startBaselineA` from `./benchmark-running.spec.js` (8.3.4's own export —
 * setup through the real PlanForm/ReadinessForm screens, then Ready's Start,
 * resolving once Running has actually mounted).
 *
 * Two ways this file reads local browser state no earlier spec has needed:
 *  - `readOutboxRowsForSession` opens the real IndexedDB outbox
 *    (`apps/web/src/lib/outbox/store.ts`'s own `attention-lab-outbox`
 *    database / `events` store / `bySession` index) directly from
 *    `page.evaluate`, rather than importing that module (an `apps/web`
 *    source file this task may not edit or import into a Node-side test
 *    file) — the same "read the real mechanism's own storage shape" approach
 *    `store.test.ts` itself uses, just from the browser side.
 *  - Two-context tests (8, 9) use `browser.newContext()` for the "second
 *    tab": `context.setOffline` and IndexedDB are both scoped to a single
 *    `BrowserContext`, so a genuinely independent tab needs its own context,
 *    not just a second `page` in the same one. The `demo` fixture's own
 *    `APIRequestContext` is independent of any page's `BrowserContext`
 *    (`support/demo.ts`'s own header comment), so `context.setOffline(true)`
 *    on a `page` never blocks a `demo.*` call — every offline test below
 *    relies on that separation to keep asserting server truth while the
 *    page itself cannot reach the network.
 *
 * `PracticeReview`/`AbandonSession`/`CheckinForm`/`Focus`'s 404 case all
 * navigate with `{ state: { notice } }` that no component in this build
 * actually renders as visible text (`practice-review.spec.ts`'s own header
 * comment documents this as a systemic, pre-existing gap, not something a
 * later spec should paper over by asserting non-existent DOM text). Test 10
 * follows that exact same file's own precedent: it reads the real fact —
 * that `AbandonSession` really did navigate to `/today` carrying
 * `{ notice: 'Session abandoned.' }` — via `window.history.state`'s `usr`
 * field (the same layer React Router itself stores it on), not a rendered
 * banner.
 */
import type { Page } from '@playwright/test'
import type { CreateSessionBodyValue } from '@attention-lab/shared'

import { expect, test, type DemoClient } from './support/demo.js'
import { advance, installClock, sleep } from './support/clock.js'
import { startBaselineA } from './helpers/session.js'

// ---------------------------------------------------------------------------
// Local helpers — this file's own, not shared with any other spec (only
// `startBaselineA`, imported above, is a cross-file reuse per 8.3.4's brief).
// ---------------------------------------------------------------------------

/** Parses `TimerDisplay`'s `mm:ss` text (`lib/clock/remaining.ts`'s `formatRemaining`) into whole seconds. */
function parseRemainingSeconds(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`recovery: could not parse mm:ss from "${text}"`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

async function readRemainingSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId('timer-digits').innerText()
  return parseRemainingSeconds(text)
}

/**
 * Starts working-day's still-open block 2 from a fresh `/today` (fills the
 * intended-output field, clicks Start) and resolves once Focus has actually
 * mounted, returning the new session's id. Assumes the caller already
 * called `demo.load('working-day')`.
 */
async function startWorkingDayBlock(
  page: Page,
  demo: DemoClient,
  intendedOutput = 'Draft the notes for the retro',
): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('recovery: GET /sessions/active returned null right after starting the practice block')
  }
  return active.id
}

/**
 * Reads `sessionId`'s rows straight out of the real IndexedDB outbox
 * (`apps/web/src/lib/outbox/store.ts`'s own database/store/index names,
 * duplicated here as literal strings rather than imported — this task may
 * not import an `apps/web` source module into a Node-side spec file). An
 * outbox that was never opened by this page (nothing was ever recorded) is
 * read as zero rows, not an error.
 */
async function readOutboxRowsForSession(
  page: Page,
  sessionId: string,
): Promise<ReadonlyArray<{ readonly clientEventId: string }>> {
  return page.evaluate((sid) => {
    return new Promise<ReadonlyArray<{ clientEventId: string }>>((resolve, reject) => {
      const openRequest = indexedDB.open('attention-lab-outbox', 1)
      openRequest.onerror = () => reject(openRequest.error ?? new Error('recovery: indexedDB.open failed'))
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
          reject(getAllRequest.error ?? new Error('recovery: outbox getAll failed'))
        }
      }
    })
  }, sessionId)
}

// ---------------------------------------------------------------------------
// Test 1 — connection lost mid-session (Pending/Retry/Saved; countdown keeps
// moving; server ends up with exactly two non-voided events).
// ---------------------------------------------------------------------------

test('connection lost mid-session: two off-task records stay Pending with Retry, the countdown keeps decreasing, and Retry after reconnect reaches Saved with exactly two events server-side', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Saved')

  await page.context().setOffline(true)

  const remainingBeforeOffline = await readRemainingSeconds(page)

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  await recordOffTask.click()
  await recordOffTask.click()

  // Tally updates optimistically, synchronous with dispatch (D6) — never
  // waiting on the (currently offline, and therefore never resolving)
  // network round trip.
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2', { timeout: 100 })

  await expect(syncStatus).toContainText('Pending')
  const retryButton = syncStatus.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  // The countdown derives from lib/clock's own anchor + the fake page clock
  // (D5) — being offline never freezes it; only the SERVER round trip is
  // blocked.
  await advance(page, demo, 5)
  const remainingAfterAdvance = await readRemainingSeconds(page)
  expect(remainingAfterAdvance).toBeLessThan(remainingBeforeOffline)

  await page.context().setOffline(false)
  await retryButton.click()
  await expect(syncStatus).toContainText('Saved')

  const session = await demo.session(sessionId)
  const nonVoidedOffTask = session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)
  expect(nonVoidedOffTask).toHaveLength(2)
})

// ---------------------------------------------------------------------------
// Test 2 — starting a session while offline.
// ---------------------------------------------------------------------------

test('start while offline: Start fails with the could-not-start message and stays on /today; Retry after reconnect reaches Focus with exactly one active session', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')

  await page.goto('/today')
  // Wait for Today to have actually finished its own bootstrap (GET /me,
  // AppBootstrap's own gate, 7.1.2) BEFORE going offline — going offline
  // while that first fetch is still in flight can abort it outright and
  // strand the whole app on AppBootstrap's "Loading" screen forever, which
  // is a test-setup race, not the offline-start behavior this case is
  // actually about.
  await expect(page.getByLabel('What will you produce?')).toBeVisible()

  await page.context().setOffline(true)

  await page.getByLabel('What will you produce?').fill('Draft the outline for the newsletter piece')
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  // useStartSession retries a NetworkError twice more, 1 s apart (7.4.4) —
  // under the installed fake clock those two 1 s delays only fire once the
  // clock is advanced past them. demo's own APIRequestContext (a separate
  // BrowserContext from `page`'s) is unaffected by `page.context().
  // setOffline`, so `advance` can still move the server's demo clock while
  // `page` itself cannot reach the network at all.
  await advance(page, demo, 3)

  await expect(page.getByText('The session could not be started')).toBeVisible()
  expect(page.url()).toContain('/today')
  expect(await demo.active()).toBeNull()

  await page.context().setOffline(false)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  expect(active).not.toBeNull()
  expect(active?.kind).toBe('practice')
})

// ---------------------------------------------------------------------------
// Test 3 — laptop slept during a benchmark: "Not sure" resolves to uncertain.
// ---------------------------------------------------------------------------

test('laptop slept during a benchmark: Not sure resolves to uncertain, shows the Timing uncertain chip, and the finalized summary lists the timer_uncertain reason', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.reset()
  const { sessionId } = await startBaselineA(page, demo)

  await advance(page, demo, 3 * 60)
  await sleep(page, demo, 5 * 60)

  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Not sure', exact: true }).click()

  await expect(page.getByText('Timing uncertain')).toBeVisible()

  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await page.getByRole('button', { name: 'Start recall', exact: true }).click()
  await page.getByLabel('Point 1').fill('The introduction argued for a single thesis.')
  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  await page.locator('#point-0-accurate').click()
  await page.getByLabel('Off-task episodes (S)').fill('0')
  await page.getByLabel('These conditions are correct').check()
  await page.locator('#materially-disrupted-no').click()
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()

  const summary = page.getByTestId('eligibility-summary')
  await expect(summary).toBeVisible()
  await expect(summary.getByText('Timing could not be confirmed for this session.')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.exclusionReasons).toContain('timer_uncertain')
})

// ---------------------------------------------------------------------------
// Test 4 — laptop slept during a benchmark: "Yes, it continued" variant.
// ---------------------------------------------------------------------------

test('laptop slept during a benchmark: Yes, it continued shows no uncertain chip and the finalized summary never lists the timer_uncertain reason', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.reset()
  const { sessionId } = await startBaselineA(page, demo)

  await advance(page, demo, 3 * 60)
  await sleep(page, demo, 5 * 60)

  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()

  await expect(page.getByText('Timing uncertain')).toHaveCount(0)

  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await page.getByRole('button', { name: 'Start recall', exact: true }).click()
  await page.getByLabel('Point 1').fill('The introduction argued for a single thesis.')
  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  await page.locator('#point-0-accurate').click()
  await page.getByLabel('Off-task episodes (S)').fill('0')
  await page.getByLabel('These conditions are correct').check()
  await page.locator('#materially-disrupted-no').click()
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()

  const summary = page.getByTestId('eligibility-summary')
  await expect(summary).toBeVisible()
  await expect(summary.getByText('Timing could not be confirmed for this session.')).toHaveCount(0)

  const session = await demo.session(sessionId)
  expect(session.exclusionReasons).not.toContain('timer_uncertain')
})

// ---------------------------------------------------------------------------
// Test 5 — deadline passed during sleep.
// ---------------------------------------------------------------------------

test('deadline passed during sleep: Yes, it continued reaches an awaiting-review state with no completed text anywhere', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.reset()
  const { sessionId } = await startBaselineA(page, demo)

  await sleep(page, demo, 21 * 60)

  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()

  await expect(page.getByText(/awaiting review/i)).toBeVisible()

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/\bcompleted\b/i)

  const session = await demo.session(sessionId)
  expect(session.lifecycle).not.toBe('finalized')
})

// ---------------------------------------------------------------------------
// Test 6 — refresh during practice: the buffered event survives reload and
// is replayed exactly once.
// ---------------------------------------------------------------------------

test('refresh during practice: a reload restores the session, the timer reads the correct elapsed time, and the buffered event is replayed exactly once', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  await advance(page, demo, 6 * 60)

  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Record off-task episode' }).click()

  const bufferedRows = await readOutboxRowsForSession(page, sessionId)
  expect(bufferedRows.length).toBeGreaterThan(0)
  const bufferedClientEventId = bufferedRows[0]?.clientEventId
  if (bufferedClientEventId === undefined) {
    throw new Error('recovery: expected a buffered outbox row with a clientEventId')
  }

  await page.context().setOffline(false)

  const replayRequestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes(`/sessions/${sessionId}/events`),
  )
  await page.reload()
  const replayRequest = await replayRequestPromise
  const replayBody = replayRequest.postDataJSON() as { events: ReadonlyArray<{ clientEventId: string }> }
  expect(replayBody.events.map((event) => event.clientEventId)).toContain(bufferedClientEventId)

  await expect(page.getByTestId('timer-digits')).toBeVisible()
  // Compared against the SERVER's own `timing.remainingSeconds` (D20) rather
  // than a value precomputed from the `advance()` call above: the installed
  // clock (D5's "server timestamps + monotonic display") is not paused, so
  // real wall-clock time keeps advancing identically on both sides while the
  // reload's own network/boot latency plays out — matching the established
  // "agrees within N s of the server's own field" convention (9.1.2's own
  // brief) rather than asserting against a fixed guess that reload latency
  // would otherwise make flaky.
  await expect
    .poll(async () => {
      const [clientRemaining, serverSession] = await Promise.all([readRemainingSeconds(page), demo.session(sessionId)])
      return Math.abs(clientRemaining - serverSession.timing.remainingSeconds)
    })
    .toBeLessThanOrEqual(2)

  const afterReload = await demo.session(sessionId)
  const matching = afterReload.events.filter((event) => event.clientEventId === bufferedClientEventId)
  expect(matching).toHaveLength(1)
})

// ---------------------------------------------------------------------------
// Test 7 — refresh after the target passed: awaiting review, never completed.
// ---------------------------------------------------------------------------

test('refresh after target passed: reloading past the deadline shows an awaiting-review state with no completed text', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  await advance(page, demo, 16 * 60)
  await page.reload()

  await expect(page.getByText(/awaiting review/i)).toBeVisible()

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/\bcompleted\b/i)

  const session = await demo.session(sessionId)
  expect(session.lifecycle).not.toBe('finalized')
})

// ---------------------------------------------------------------------------
// Test 8 — second tab: an existing session blocks a new start with 409.
// ---------------------------------------------------------------------------

test('second tab: a running session shows Return with no Start on a second tab, and starting a new one there is refused with 409 active_session_exists', async ({
  page,
  browser,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await installClock(pageB)
  await pageB.goto('/today')

  const card = pageB.getByTestId('active-session-card')
  await expect(card).toBeVisible()
  await expect(card.getByRole('link', { name: 'Return to your session' })).toHaveAttribute(
    'href',
    `/focus/${sessionId}`,
  )
  await expect(card.getByRole('button', { name: /start/i })).toHaveCount(0)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('recovery: GET /programs/current has no program after loading working-day')
  }
  const body: CreateSessionBodyValue = {
    programId: current.program.id,
    kind: 'practice',
    intendedOutput: 'A second, unrelated attempt',
    targetSeconds: 900,
  }
  const response = await pageB.request.post('/api/v1/sessions', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: body,
  })
  expect(response.status()).toBe(409)
  const json = (await response.json()) as { code?: string }
  expect(json.code).toBe('active_session_exists')

  await contextB.close()
})

// ---------------------------------------------------------------------------
// Test 9 — two tabs end the same session: the second gets a stale conflict.
// ---------------------------------------------------------------------------

test('two tabs end the same session: the second tab gets a stale-conflict notice and reaches the pending review, with a single end transition recorded server-side', async ({
  page,
  browser,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)
  const beforeEnd = await demo.session(sessionId)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await installClock(pageB)
  await pageB.goto(`/focus/${sessionId}`)
  await expect(pageB.getByTestId('timer-digits')).toBeVisible()

  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  await pageB.getByRole('button', { name: 'Finish early', exact: true }).click()
  await pageB.getByRole('button', { name: 'Finish now', exact: true }).click()

  await expect(pageB.getByText('This session was updated in another tab')).toBeVisible()

  const reviewLink = pageB.getByRole('link', { name: 'Finish your pending review' })
  await expect(reviewLink).toHaveAttribute('href', `/review/${sessionId}`)
  await reviewLink.click()
  await pageB.waitForURL(`**/review/${sessionId}`)

  const afterBoth = await demo.session(sessionId)
  expect(afterBoth.lifecycle).toBe('awaiting_review')
  expect(afterBoth.endedAt).not.toBeNull()
  // Exactly one end transition landed: the version moved by one step, never
  // two, proving B's second attempt was refused rather than silently
  // re-applied.
  expect(afterBoth.version).toBe(beforeEnd.version + 1)

  await contextB.close()
})

// ---------------------------------------------------------------------------
// Test 10 — abandon purges the buffer.
// ---------------------------------------------------------------------------

test('abandon purges the buffer: an offline abandon attempt fails, retrying once back online purges the outbox, ends the session as abandoned, and never shows completed', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Record off-task episode' }).click()

  const bufferedBeforeAbandon = await readOutboxRowsForSession(page, sessionId)
  expect(bufferedBeforeAbandon.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Abandon session' }).click()
  const confirmAbandon = page.getByRole('button', { name: 'Abandon', exact: true })
  await confirmAbandon.click()

  // The transition is a direct network call (never routed through the
  // outbox, 7.3.4's own `abandonWithPurge`), so it fails outright while
  // offline — the dialog stays open with a retry-eligible error, and
  // nothing is purged yet.
  await expect(page.getByText('Could not abandon. Retry.')).toBeVisible()
  expect(await demo.session(sessionId)).toMatchObject({ lifecycle: 'running' })

  await page.context().setOffline(false)
  await confirmAbandon.click()

  await page.waitForURL('**/today')

  // AbandonSession navigates with `{ state: { notice: 'Session abandoned.' } }`
  // (mirrors PracticeReview's own notice, per this file's header comment) —
  // no component in this build renders that notice as visible text, so the
  // real, checkable fact is the browser History entry React Router itself
  // wrote it to.
  const historyState = await page.evaluate(() => window.history.state as { usr?: { notice?: string } } | null)
  expect(historyState?.usr?.notice).toBe('Session abandoned.')

  const remainingRows = await readOutboxRowsForSession(page, sessionId)
  expect(remainingRows).toHaveLength(0)

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('abandoned')

  // "Never shows completed" is about THIS abandoned session specifically,
  // not literal absence of the word anywhere on the page — the working-day
  // fixture's own separate, already-finalized block legitimately reads
  // "Completed" and is unrelated to the session under test here (a scan of
  // the whole page body would false-positive on that fixture data).
  // `deriveBlocks` (apps/api/src/services/program/blocks.ts) drops an
  // abandoned practice session from its candidate list entirely — "an
  // abandoned practice session leaves its slot not_started rather than
  // occupying it" — so the real, precise check is that no block on Today
  // references this session's id at all (confirming it was never
  // mislabeled 'completed' by lingering as some block's occupant).
  const current = await demo.current()
  if (current.program === null) {
    throw new Error('recovery: GET /programs/current returned no program after abandoning a session')
  }
  const today = await demo.today(current.program.id)
  const ourBlock = today.blocks.find((block) => block.sessionId === sessionId)
  expect(ourBlock).toBeUndefined()
})
