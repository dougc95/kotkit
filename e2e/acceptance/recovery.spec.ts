/**
 * Task 9.1.8 (design.md D5, D6, D9, D16-D21, D24; specs/session-
 * recovery: "Events are buffered, deduplicated and acknowledged" / "Batch
 * retried", "Pending, saved and could-not-save are distinct" / "Connection
 * lost mid-session", "Local storage unavailable", "Acknowledged after
 * retry", "Recovery buffer is bounded and purged" / "Buffer after sync";
 * specs/practice-sessions: "Session review saves honest outcomes" / "Early
 * finish"; specs/app-shell: "Implementation details are not user-facing" /
 * "Sync state display"; specs/identity-realm: "Demo-only controls exist
 * only in demo mode" / "Load a demonstration scenario"). Drives the real
 * Today -> Focus -> PracticeReview screens against the `recovery` demo
 * scenario (`packages/shared/src/fixtures/demoScenarios.ts`: a practice
 * block already `running` at load time, started 420 s before load with a
 * 600 s target — no events on disk, since D35's fixture comment is explicit
 * that "the unsynced batch is created client-side by the journey, 9.1.8"),
 * through the seven named cases the brief lists, each its own independent
 * `test()` against a freshly reloaded scenario (`test.beforeEach` below).
 *
 * Helpers below are this file's own, local, unexported copies of the same
 * small pieces `e2e/recovery.spec.ts` (Group 8's dev-server suite) and
 * `e2e/acceptance/working-day.spec.ts` (9.1.5) already established —
 * `parseRemainingSeconds`/`readRemainingSeconds`, and reading the outbox's
 * real IndexedDB shape (`apps/web/src/lib/outbox/store.ts`'s own database/
 * store/index names, `attention-lab-outbox` / `events` / `bySession`)
 * directly from `page.evaluate` rather than importing that `apps/web`
 * source module — kept local per this workflow's file-ownership rule
 * (neither of those two files exports anything this task could reuse
 * without editing them).
 */
import type { Locator, Page } from '@playwright/test'

import { expect, test, type DemoClient } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'
import { expectNoPunitiveCopy, expectNoTechnicalIds } from '../support/copy.js'

test.beforeEach(async ({ demo }) => {
  await demo.load('recovery')
})

// ---------------------------------------------------------------------------
// Shared local helpers
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
 * Reads `GET /sessions/active` (the scenario's own running practice
 * session, per `test.beforeEach`'s fresh `demo.load('recovery')`) and
 * navigates straight to its `/focus/:id`, resolving once the timer has
 * actually mounted. Every case except #1 (which drives the real Today ->
 * Focus link) and #6 (which must install its `indexedDB` override before
 * the first navigation) uses this.
 */
async function gotoRunningFocus(page: Page, demo: DemoClient): Promise<string> {
  const active = await demo.active()
  if (active === null) {
    throw new Error('recovery: demo.active() returned null — expected the recovery scenario\'s running practice session')
  }
  await page.goto(`/focus/${active.id}`)
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return active.id
}

/** One outbox row as `store.ts`'s `OutboxRecord` stores it, minus the store-only `sessionId`/`createdAt` fields. */
interface CapturedOutboxRow {
  readonly clientEventId: string
  readonly type: string
  readonly elapsedMs: number
  readonly occurredAt: string
  readonly details?: Record<string, unknown>
}

/**
 * Reads `sessionId`'s rows straight out of the real IndexedDB outbox. An
 * outbox that was never opened by this page (nothing was ever recorded) is
 * read as zero rows, not an error — mirrors `e2e/recovery.spec.ts`'s own
 * `readOutboxRowsForSession`, extended to return every field (not just
 * `clientEventId`) so a caller can rebuild the exact batch that was sent.
 */
async function readOutboxRowsForSession(page: Page, sessionId: string): Promise<readonly CapturedOutboxRow[]> {
  return page.evaluate((sid) => {
    return new Promise<CapturedOutboxRow[]>((resolve, reject) => {
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
          const rows = getAllRequest.result as ReadonlyArray<{
            clientEventId: string
            type: string
            elapsedMs: number
            occurredAt: string
            details?: Record<string, unknown>
          }>
          resolve(
            rows.map((row) => ({
              clientEventId: row.clientEventId,
              type: row.type,
              elapsedMs: row.elapsedMs,
              occurredAt: row.occurredAt,
              ...(row.details !== undefined ? { details: row.details } : {}),
            })),
          )
        }
        getAllRequest.onerror = () => {
          db.close()
          reject(getAllRequest.error ?? new Error('recovery: outbox getAll failed'))
        }
      }
    })
  }, sessionId)
}

/**
 * Attaches a `MutationObserver` (via `page.evaluate` against an already-
 * resolved `ElementHandle`, task brief's own wording) to the "Off-task"
 * tally's `<dd>`, stamping `performance.now()` into a page-global array on
 * every mutation — `clickRecordAndMeasureLatencyMs` below reads it back to
 * compute a click-to-render delta.
 */
async function armOffTaskTallyObserver(page: Page): Promise<void> {
  const handle = await page.locator('dt:text-is("Off-task") + dd').elementHandle()
  if (handle === null) {
    throw new Error('recovery: could not find the Off-task tally element to observe')
  }
  await page.evaluate((el) => {
    const state = window as typeof window & { __offTaskTallyStamps?: number[] }
    state.__offTaskTallyStamps = []
    const observer = new MutationObserver(() => {
      state.__offTaskTallyStamps?.push(performance.now())
    })
    observer.observe(el, { childList: true, characterData: true, subtree: true })
  }, handle)
}

/**
 * Stamps `performance.now()` immediately before clicking `button`, waits
 * for `armOffTaskTallyObserver`'s observer to record a new mutation, and
 * returns the delta in milliseconds between the click and that mutation —
 * "local tally feedback SHALL appear within 100 ms regardless of network
 * state" (design.md's non-functional table), read literally.
 */
async function clickRecordAndMeasureLatencyMs(page: Page, button: Locator): Promise<number> {
  const beforeCount = await page.evaluate(
    () => (window as typeof window & { __offTaskTallyStamps?: number[] }).__offTaskTallyStamps?.length ?? 0,
  )
  const clickStartMs = await page.evaluate(() => performance.now())
  await button.click()
  await page.waitForFunction((count) => {
    const stamps = (window as typeof window & { __offTaskTallyStamps?: number[] }).__offTaskTallyStamps
    return (stamps?.length ?? 0) > count
  }, beforeCount)
  return page.evaluate((startMs) => {
    const stamps = (window as typeof window & { __offTaskTallyStamps?: number[] }).__offTaskTallyStamps ?? []
    const last = stamps[stamps.length - 1]
    return (last ?? startMs) - startMs
  }, clickStartMs)
}

// ---------------------------------------------------------------------------
// 1. Focus resumes the scenario session instead of offering a new start.
// ---------------------------------------------------------------------------

test('Focus resumes the scenario session instead of offering a new start', async ({ page, demo }) => {
  const active = await demo.active()
  if (active === null) {
    throw new Error('recovery: demo.active() returned null right after loading the recovery scenario')
  }

  await page.goto('/today')

  const card = page.getByTestId('active-session-card')
  await expect(card).toBeVisible()
  const returnLink = card.getByRole('link', { name: 'Return to your session' })
  await expect(returnLink).toHaveAttribute('href', `/focus/${active.id}`)
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)

  await returnLink.click()
  await page.waitForURL(`**/focus/${active.id}`)
  await expect(page.getByTestId('timer-digits')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. Offline: two records show Pending with Retry, the timer keeps
//    counting, each tally update renders within 100 ms, and the server has
//    neither event yet.
// ---------------------------------------------------------------------------

test('offline: two records show Pending with Retry, the timer keeps counting, and each tally update renders within 100 ms while the server still holds neither event', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const sessionId = await gotoRunningFocus(page, demo)

  await armOffTaskTallyObserver(page)
  await page.context().setOffline(true)

  const remainingBefore = await readRemainingSeconds(page)

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  const firstDeltaMs = await clickRecordAndMeasureLatencyMs(page, recordOffTask)
  expect(firstDeltaMs).toBeLessThan(100)
  const secondDeltaMs = await clickRecordAndMeasureLatencyMs(page, recordOffTask)
  expect(secondDeltaMs).toBeLessThan(100)

  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2')

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Pending')
  await expect(syncStatus.getByRole('button', { name: 'Retry' })).toBeVisible()

  // Offline blocks only the network round trip (D6) — the countdown itself
  // derives from the installed fake clock plus the server-truth fields
  // already on hand, so it keeps moving.
  await advance(page, demo, 10)
  const remainingAfter = await readRemainingSeconds(page)
  const decreasedBy = remainingBefore - remainingAfter
  expect(decreasedBy).toBeGreaterThanOrEqual(9)
  expect(decreasedBy).toBeLessThanOrEqual(11)

  const session = await demo.session(sessionId)
  expect(session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// 3. Retry after reconnect reaches Saved; the server holds exactly two
//    events; the outbox is empty.
// ---------------------------------------------------------------------------

test('Retry after reconnect reaches Saved; the server holds exactly two events; the outbox is empty', async ({
  page,
  demo,
}) => {
  const sessionId = await gotoRunningFocus(page, demo)
  await page.context().setOffline(true)

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  await recordOffTask.click()
  await recordOffTask.click()

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Pending')

  await page.context().setOffline(false)
  // Not a plain `.click()`: the local demo server acknowledges the retry's
  // batch (and the button unmounts once `state` flips to 'saved') faster
  // than Playwright's own multi-frame stability check can confirm the click
  // — confirmed empirically (request-timestamped logging showed the retry
  // batch's response landing ~20 ms after the click began, well under
  // Playwright's actionability-polling window), so `.click()` chases a
  // target that keeps detaching underneath it and times out even though the
  // retry genuinely ran. `dispatchEvent` fires the DOM click directly,
  // skipping that stability polling.
  await syncStatus.getByRole('button', { name: 'Retry' }).dispatchEvent('click')
  await expect(syncStatus).toContainText('Saved')

  const session = await demo.session(sessionId)
  const nonVoidedOffTask = session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)
  expect(nonVoidedOffTask).toHaveLength(2)
  expect(new Set(nonVoidedOffTask.map((event) => event.clientEventId)).size).toBe(2)

  const outboxRows = await readOutboxRowsForSession(page, sessionId)
  expect(outboxRows).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// 4. Re-sending the same batch stores nothing twice.
// ---------------------------------------------------------------------------

test('re-sending the same batch stores nothing twice', async ({ page, demo }) => {
  const sessionId = await gotoRunningFocus(page, demo)
  await page.context().setOffline(true)

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  await recordOffTask.click()
  await recordOffTask.click()

  // Captured while still offline/Pending — once Retry succeeds the outbox
  // is empty (test 3), so this is the only point the exact batch this test
  // re-sends can be read back from.
  const bufferedRows = await readOutboxRowsForSession(page, sessionId)
  expect(bufferedRows).toHaveLength(2)

  await page.context().setOffline(false)
  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await syncStatus.getByRole('button', { name: 'Retry' }).click()
  await expect(syncStatus).toContainText('Saved')

  const afterRetry = await demo.session(sessionId)
  expect(afterRetry.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)).toHaveLength(2)

  const resendResponse = await page.request.post(`/api/v1/sessions/${sessionId}/events`, {
    data: {
      events: bufferedRows.map((row) => ({
        clientEventId: row.clientEventId,
        type: row.type,
        elapsedMs: row.elapsedMs,
        occurredAt: row.occurredAt,
        ...(row.details !== undefined ? { details: row.details } : {}),
      })),
    },
  })
  expect(resendResponse.status()).toBe(200)
  const resendJson = (await resendResponse.json()) as { accepted: string[]; duplicates: string[] }
  expect(resendJson.accepted).toEqual([])
  expect(new Set(resendJson.duplicates)).toEqual(new Set(bufferedRows.map((row) => row.clientEventId)))

  const finalSession = await demo.session(sessionId)
  expect(finalSession.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)).toHaveLength(2)
})

// ---------------------------------------------------------------------------
// 5. Sync state is plain words and carries no technical identifier, both
//    when everything is Saved and while a batch is Pending.
// ---------------------------------------------------------------------------

const PLAIN_SYNC_STATE_WORDS = ['Pending', 'Saved', 'Entries could not be saved on this device']

test('sync state is plain words and carries no technical identifier', async ({ page, demo }) => {
  await gotoRunningFocus(page, demo)
  const syncStatus = page.locator('[role="status"][aria-live="polite"]')

  await expect(syncStatus).toContainText('Saved')
  const savedText = (await syncStatus.innerText()).trim()
  expect(PLAIN_SYNC_STATE_WORDS).toContain(savedText)
  await expectNoTechnicalIds(syncStatus)

  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Record off-task episode' }).click()
  await expect(syncStatus).toContainText('Pending')
  const pendingStateWord = (await syncStatus.innerText()).trim().split('\n')[0] ?? ''
  expect(PLAIN_SYNC_STATE_WORDS).toContain(pendingStateWord)
  await expectNoTechnicalIds(syncStatus)
})

// ---------------------------------------------------------------------------
// 6. IndexedDB refused: "could not be saved on this device" with a
//    keep-trying-the-server control; the event still reaches the server.
// ---------------------------------------------------------------------------

test('IndexedDB refused: could not be saved on this device shows a keep-trying-the-server control, and the event still reaches the server', async ({
  page,
  demo,
}) => {
  // Installed before the first navigation (must be a NEW page, per this
  // task's own brief) so both the boot-time replay and every later
  // `enqueue()` call see a refusing `indexedDB.open`.
  await page.addInitScript(() => {
    window.indexedDB.open = () => {
      throw new Error('recovery: indexedDB refused (test double)')
    }
  })

  const sessionId = await gotoRunningFocus(page, demo)

  await page.getByRole('button', { name: 'Record off-task episode' }).click()

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Entries could not be saved on this device')
  const keepTrying = syncStatus.getByRole('button', { name: 'Keep trying the server directly' })
  await expect(keepTrying).toBeVisible()

  await keepTrying.click()

  // `sendDirectNow()` posts straight to the server, bypassing IndexedDB
  // entirely (`lib/outbox/flush.ts`'s `sendDirect`) — the click itself
  // resolves before that network round trip necessarily has, so this polls
  // server truth rather than asserting a specific follow-up sync-state word
  // (with `indexedDB.open` refused for every call, not just the one this
  // draft's own local write hit, the mount-time replay this session's
  // `SyncStatus` also attempted at load has itself already failed against
  // the same double — this test's own contract is only the brief's own
  // three claims: the could-not-save copy, the keep-trying control, and the
  // event actually reaching the server, which this proves directly).
  await expect
    .poll(async () => {
      const session = await demo.session(sessionId)
      return session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null).length
    })
    .toBe(1)
})

// ---------------------------------------------------------------------------
// 7. Finish early with time remaining: the review prefills S 2 (method
//    event); Save finalizes with completeInterval false and elapsed below
//    target; Today shows the block finished early, never completed, with
//    the next block still available and no punitive copy.
// ---------------------------------------------------------------------------

test('finish early with time remaining: the review prefills S 2 (method event); Save finalizes as an early finish, never completed, with the next block still available and neutral copy', async ({
  page,
  demo,
}) => {
  const sessionId = await gotoRunningFocus(page, demo)

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  await recordOffTask.click()
  await recordOffTask.click()
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2')

  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Saved')

  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  await expect(page.locator('#episode-count')).toHaveValue('2')
  await expect(page.locator('#episode-count-hint')).toHaveText('prefilled from recorded events')

  await page.getByRole('radio', { name: 'Yes', exact: true }).click()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await page.waitForURL('**/today')

  const finalized = await demo.session(sessionId)
  expect(finalized.lifecycle).toBe('finalized')
  expect(finalized.completeInterval).toBe(false)
  expect(finalized.review.episodeCount).toBe(2)
  expect(finalized.review.countMethod).toBe('event')

  if (finalized.endedAt === null) {
    throw new Error('recovery: finalized session has no endedAt')
  }
  const elapsedSeconds =
    (Date.parse(finalized.endedAt) - Date.parse(finalized.startedAt)) / 1000 - finalized.pausedSeconds
  expect(elapsedSeconds).toBeGreaterThanOrEqual(0)
  expect(elapsedSeconds).toBeLessThan(finalized.targetSeconds)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('recovery: GET /programs/current returned no program after finishing the block early')
  }
  const today = await demo.today(current.program.id)
  const ourBlock = today.blocks.find((block) => block.sessionId === sessionId)
  if (ourBlock === undefined) {
    throw new Error(`recovery: no Today block is occupied by session ${sessionId}`)
  }
  expect(ourBlock.status).toBe('partial')
  expect(ourBlock.status).not.toBe('completed')

  const nextBlock = today.blocks.find((block) => block.index !== ourBlock.index)
  if (nextBlock === undefined) {
    throw new Error('recovery: expected a second block on Today')
  }
  expect(nextBlock.status).toBe('not_started')
  expect(today.nextAction).toEqual({ kind: 'practice', block: nextBlock.index })

  const finishedEarlyCard = page.locator(`[data-block-index="${ourBlock.index}"]`)
  await expect(finishedEarlyCard).toContainText('Partial')

  // The next block still available, with neutral copy throughout the page.
  await expect(page.getByLabel('What will you produce?')).toBeVisible()
  await expectNoPunitiveCopy(page)
})
