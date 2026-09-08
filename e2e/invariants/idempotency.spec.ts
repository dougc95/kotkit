/**
 * Task 9.2.4 — Invariant: idempotent start and finalize under lost responses
 * and mismatches (design.md D6, D9, D18-D21; specs/session-recovery:
 * "Finalization is atomic and idempotent" / "Event count mismatch" /
 * "Finalize retried" / "Late event", "Starting a session requires the
 * server" / "Start retried after timeout" / "Start while offline";
 * specs/benchmark-assessment: "Finalized attempts are immutable; amendments
 * are append-only").
 *
 * Six independent tests against `working-day`'s still-open block 2 (Day 4,
 * 15 min/900 s target — 9.1.2's own header comment: `readyProgram()` never
 * reaches a practice-startable Today, so every test here loads
 * `demo.load('working-day')` instead), run in file order under this
 * project's `workers: 1`/`fullyParallel: false` (`e2e/playwright.config.ts`)
 * — `test.describe.configure({ mode: 'serial' })` below additionally stops
 * the file at the first failure, which matters specifically because test (2)
 * reuses the literal 409 body test (1) captures over the wire (its own
 * brief: "the captured body is the reference the mock in test 2 imitates").
 *
 * Two server-truth facts this whole file leans on (`apps/api/src/services/
 * review.ts`, `apps/api/src/idempotency/withIdempotency.ts`):
 *  - a REJECTED finalize (any 4xx, `event_count_mismatch` included) writes no
 *    idempotency receipt, so the identical `Idempotency-Key` is accepted
 *    fresh once the request that follows actually matches server truth
 *    (D21) — never `idempotency_mismatch`, since nothing was ever recorded
 *    to conflict with.
 *  - `finalizeWithSync` (`apps/web/src/lib/outbox/finalize.ts`) builds its
 *    FIRST attempt's `lastBatch` from whatever the local outbox still holds
 *    unsent, so a still-Pending row is not, by itself, why a real
 *    `event_count_mismatch` would ever occur against an unmocked server — it
 *    only shows up here because test (2)'s injected 409 short-circuits the
 *    first call before the real server ever sees it, exactly mirroring test
 *    (1)'s own raw-API sequence (4 really stored, 1 still Pending) one layer
 *    up, through the real UI.
 */
import type { APIResponse, Page } from '@playwright/test'
import type { EventInputValue, FinalizeResponseValue } from '@attention-lab/shared'

import { expect, test } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

// ---------------------------------------------------------------------------
// Local helpers — this file's own (a `.spec.ts` file may not import another
// `.spec.ts` file, per `e2e/helpers/session.ts`'s own header comment on why
// `startBaselineA` had to move out of `benchmark-running.spec.ts`), mirroring
// `practice-review.spec.ts`/`recovery.spec.ts`'s own locally-defined
// `startBlockTwo`/`startWorkingDayBlock`.
// ---------------------------------------------------------------------------

/** Working-day's still-open block 2 (Day 4, revision 2): starts it from a fresh /today and resolves once Focus has mounted, returning the new session's id. */
async function startBlockTwo(page: Page, intendedOutput: string): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`idempotency: could not read a session id from the URL "${page.url()}"`)
  }
  return sessionId
}

/** Throws with the URL/status/body when `response`'s status is not `status` — the same "name the actual HTTP call" convention `support/demo.ts`'s own `expectStatus` uses, duplicated here since that one is not exported. */
async function expectResponseStatus(response: APIResponse, status: number): Promise<void> {
  if (response.status() !== status) {
    const bodyText = await response.text().catch(() => '<unreadable body>')
    throw new Error(`${response.url()} -> ${response.status()} (expected ${status}): ${bodyText}`)
  }
}

/** One `off_task` batch item, `elapsedMs` after `startedAt` — small, fixed offsets (never derived from real wall-clock "now"), safely inside `EVENT_OFFSET_TOLERANCE_MS` (5 s) of whatever real time a raw sequential API call actually took. */
function offTaskEvent(startedAt: string, elapsedMs: number, clientEventId: string = crypto.randomUUID()): EventInputValue {
  return {
    clientEventId,
    type: 'off_task',
    elapsedMs,
    occurredAt: new Date(new Date(startedAt).getTime() + elapsedMs).toISOString(),
  }
}

/** The D18 error envelope shape, read off a raw (non-2xx) `APIResponse` body. */
interface ErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
  readonly retryable: boolean
  readonly requestId: string
}

/** Matches `.../sessions/{id}/events` (POST) — never `.../events/{clientEventId}/void`, which the trailing `$` excludes. */
const EVENTS_ROUTE = /\/api\/v1\/sessions\/[^/]+\/events$/
/** Matches `.../sessions/{id}/finalize` (POST). */
const FINALIZE_ROUTE = /\/api\/v1\/sessions\/[^/]+\/finalize$/
/** Matches `.../sessions` (POST) — the create route itself, never `.../sessions/active` or `.../sessions/{id}`. */
const SESSIONS_CREATE_ROUTE = /\/api\/v1\/sessions$/

/**
 * Set by test (1), read by test (2) — the exact wire body a real 409
 * `event_count_mismatch` produced, reused verbatim as test (2)'s mock
 * fulfillment (this file's own header comment; the task brief's own "the
 * captured body is the reference the mock in test 2 imitates"). `serial`
 * mode above means test (2) never runs at all if test (1) failed to set
 * this, but the explicit guard in test (2) still names the real reason
 * rather than a bare `undefined` access.
 */
let capturedMismatchBody: ErrorEnvelope | undefined

// ---------------------------------------------------------------------------
// (1) Server truth: a raw-API event-count mismatch, then the same key
// retried once the missing event actually lands.
// ---------------------------------------------------------------------------

test('server truth: 4 stored, finalize claims 5 -> 409 event_count_mismatch with {expected: 5, stored: 4}, retryable and a requestId; the missing event then a retry with the same key -> 200 and one review', async ({
  page,
  demo,
}) => {
  await installClock(page)

  const sessionId = await startBlockTwo(page, 'Draft the weekly status update')
  const started = await demo.session(sessionId)

  const firstFour = {
    events: [1000, 1500, 2000, 2500].map((elapsedMs) => offTaskEvent(started.startedAt, elapsedMs)),
  }
  const firstFourResponse = await page.request.post(`/api/v1/sessions/${sessionId}/events`, { data: firstFour })
  await expectResponseStatus(firstFourResponse, 200)
  const firstFourJson = (await firstFourResponse.json()) as { accepted: string[]; duplicates: string[] }
  expect(firstFourJson.accepted).toHaveLength(4)

  const endResponse = await page.request.post(`/api/v1/sessions/${sessionId}/transitions`, {
    data: { type: 'end', expectedVersion: started.version },
  })
  await expectResponseStatus(endResponse, 200)

  const key = crypto.randomUUID()
  const finalizeBody = { expectedEventCount: 5, review: { outputQuality: 'yes' as const } }

  const firstFinalize = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': key },
    data: finalizeBody,
  })
  expect(firstFinalize.status()).toBe(409)
  const mismatchBody = (await firstFinalize.json()) as ErrorEnvelope
  expect(mismatchBody.code).toBe('event_count_mismatch')
  expect(mismatchBody.details).toEqual({ expected: 5, stored: 4 })
  expect(mismatchBody.retryable).toBe(true)
  expect(typeof mismatchBody.requestId).toBe('string')
  expect(mismatchBody.requestId.length).toBeGreaterThan(0)

  // Reused verbatim by test (2) below as its mocked finalize response.
  capturedMismatchBody = mismatchBody

  const fifthResponse = await page.request.post(`/api/v1/sessions/${sessionId}/events`, {
    data: { events: [offTaskEvent(started.startedAt, 3000)] },
  })
  await expectResponseStatus(fifthResponse, 200)
  const fifthJson = (await fifthResponse.json()) as { accepted: string[]; duplicates: string[] }
  expect(fifthJson.accepted).toHaveLength(1)

  const retryFinalize = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': key },
    data: finalizeBody,
  })
  await expectResponseStatus(retryFinalize, 200)
  const retryJson = (await retryFinalize.json()) as FinalizeResponseValue
  expect(retryJson.review.finalizedAt).not.toBeNull()

  const finalSession = await demo.session(sessionId)
  expect(finalSession.lifecycle).toBe('finalized')
  expect(finalSession.eventCount).toBe(5)
  expect(finalSession.review.finalizedAt).not.toBeNull()
  expect(finalSession.review.outputQuality).toBe('yes')
})

// ---------------------------------------------------------------------------
// (2) Browser: the real client resolves the same 409 on its own, retrying
// with the same key.
// ---------------------------------------------------------------------------

test('browser: a 409 on the first finalize makes the client flush its outbox and retry with the same Idempotency-Key; one finalized session with five events and no error left on screen', async ({
  page,
  demo,
}) => {
  const mismatchBody = capturedMismatchBody
  if (mismatchBody === undefined) {
    throw new Error('idempotency.spec.ts: test (1) must run first and capture a 409 event_count_mismatch body to reuse here')
  }

  await installClock(page)

  const sessionId = await startBlockTwo(page, 'Summarize the incident review notes')

  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  const offTaskTally = page.locator('dt:text-is("Off-task") + dd')

  // Four real, unmocked clicks — each syncs immediately (D6).
  for (let i = 0; i < 4; i++) {
    await recordOffTask.click()
    await expect(syncStatus).toContainText('Saved')
  }
  await expect(offTaskTally).toHaveText('4')

  // A fifth click while the events route is aborted stays Pending — the
  // local outbox now holds exactly the one row real server truth (4 stored)
  // does not yet have, mirroring test (1)'s own raw-API setup one layer up.
  await page.route(EVENTS_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.abort()
  })
  await recordOffTask.click()
  await expect(offTaskTally).toHaveText('5')
  await expect(syncStatus).toContainText('Pending')

  // Registered before navigating (route handlers persist across
  // navigation): the first call to finalize is fully intercepted — never
  // reaching the real server at all — with test (1)'s own captured 409
  // body; every later call is real.
  const idempotencyKeysSeen: string[] = []
  await page.route(FINALIZE_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const key = await route.request().headerValue('idempotency-key')
    idempotencyKeysSeen.push(key ?? '')
    if (idempotencyKeysSeen.length === 1) {
      await route.fulfill({ status: 409, json: mismatchBody })
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  // `PracticeReview` flushes this session's outbox once on mount (a React
  // effect, not synchronized with `waitForURL` above) — whether THAT attempt
  // fires before or after the next line's `unroute` is a genuine race, not
  // something this test controls: it can still be blocked (route aborted)
  // and fail silently, leaving event 5 for `finalizeWithSync`'s own
  // mismatch-triggered flush to pick up, OR it can win the race and flush
  // event 5 itself. Confirmed empirically both ways happen across runs. Both
  // are correct application behavior — `finalizeWithSync`'s own internal
  // retry AND `useFinalizeSession.ts`'s outer mismatch-retry loop (7.3.5)
  // exist as exactly this kind of defense-in-depth — so this test asserts
  // the invariant the brief actually describes ("retry with an identical
  // Idempotency-Key, reaching one finalized session"), not a fixed call
  // count: at least the one known retry, every one under the same key.
  await page.unroute(EVENTS_ROUTE)

  await page.getByRole('radio', { name: 'Yes', exact: true }).click()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()

  await page.waitForURL('**/today')

  expect(idempotencyKeysSeen.length).toBeGreaterThanOrEqual(2)
  expect(idempotencyKeysSeen[0]).not.toBe('')
  expect(new Set(idempotencyKeysSeen).size).toBe(1)

  // No lingering error text on the page the client landed on.
  await expect(page.getByText('Some entries have not been saved yet')).toHaveCount(0)
  await expect(page.getByText('The review could not be saved. Retry.')).toHaveCount(0)

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('finalized')
  expect(session.eventCount).toBe(5)
  expect(session.review.finalizedAt).not.toBeNull()
})

// ---------------------------------------------------------------------------
// (3) Replaying finalize with the same key returns the recorded result.
// ---------------------------------------------------------------------------

test('replaying finalize with the same key returns the recorded result: finalizedAt and every version stay unchanged', async ({
  page,
  demo,
}) => {
  await installClock(page)

  const sessionId = await startBlockTwo(page, 'Note the follow-ups from the sync')
  const started = await demo.session(sessionId)

  const endResponse = await page.request.post(`/api/v1/sessions/${sessionId}/transitions`, {
    data: { type: 'end', expectedVersion: started.version },
  })
  await expectResponseStatus(endResponse, 200)

  const key = crypto.randomUUID()
  const finalizeBody = { expectedEventCount: 0, review: { outputQuality: 'partly' as const } }

  const firstFinalize = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': key },
    data: finalizeBody,
  })
  await expectResponseStatus(firstFinalize, 200)
  const firstJson = (await firstFinalize.json()) as FinalizeResponseValue
  expect(firstJson.review.finalizedAt).not.toBeNull()

  const replay = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': key },
    data: finalizeBody,
  })
  await expectResponseStatus(replay, 200)
  const replayJson = (await replay.json()) as FinalizeResponseValue

  expect(replayJson.review.finalizedAt).toBe(firstJson.review.finalizedAt)
  expect(replayJson.review.version).toBe(firstJson.review.version)
  expect(replayJson.session.version).toBe(firstJson.session.version)
  expect(replayJson.session.lifecycle).toBe('finalized')

  const session = await demo.session(sessionId)
  expect(session.review.finalizedAt).toBe(firstJson.review.finalizedAt)
  expect(session.review.version).toBe(firstJson.review.version)
  expect(session.version).toBe(firstJson.session.version)
})

// ---------------------------------------------------------------------------
// (4) A late event after finalize is stored with a reconciliation warning;
// the already-finalized review never changes.
// ---------------------------------------------------------------------------

test('a late event after finalize is stored with a reconciliation warning and the review is unchanged', async ({
  page,
  demo,
}) => {
  await installClock(page)

  const sessionId = await startBlockTwo(page, 'Capture the blockers list')
  const started = await demo.session(sessionId)

  const endResponse = await page.request.post(`/api/v1/sessions/${sessionId}/transitions`, {
    data: { type: 'end', expectedVersion: started.version },
  })
  await expectResponseStatus(endResponse, 200)

  const finalizeResponse = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { expectedEventCount: 0, review: { outputQuality: 'yes', episodeCount: 0, countMethod: 'event' } },
  })
  await expectResponseStatus(finalizeResponse, 200)

  const beforeLateEvent = await demo.session(sessionId)
  expect(beforeLateEvent.lifecycle).toBe('finalized')
  // An explicit, reported 0 — not a blank coalesced to 0 (CLAUDE.md's
  // "Unknown != zero"): this test deliberately reports a count so the "late
  // event never edits it" assertion below is unambiguous either way.
  expect(beforeLateEvent.review.episodeCount).toBe(0)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('idempotency: GET /programs/current returned no program after loading working-day')
  }
  const reportBefore = await demo.report(current.program.id)

  const lateClientEventId = crypto.randomUUID()
  const lateEventResponse = await page.request.post(`/api/v1/sessions/${sessionId}/events`, {
    data: { events: [offTaskEvent(started.startedAt, 500, lateClientEventId)] },
  })
  await expectResponseStatus(lateEventResponse, 200)
  const lateEventJson = (await lateEventResponse.json()) as { accepted: string[]; duplicates: string[] }
  // Stored, never silently dropped (D21) — appendEvents has no lifecycle
  // gate at all, only ownership.
  expect(lateEventJson.accepted).toEqual([lateClientEventId])

  const afterLateEvent = await demo.session(sessionId)
  const lateEvent = afterLateEvent.events.find((event) => event.clientEventId === lateClientEventId)
  if (lateEvent === undefined) {
    throw new Error('idempotency: the late event was accepted but is missing from GET /sessions/{id}')
  }
  // The per-event stored flag (task 5.3.1/D21) — the real, checkable
  // reconciliation-warning mechanism; see this file's own header comment on
  // why the *batch response's* own optional `reconciliationWarning` field is
  // not asserted here.
  expect((lateEvent.details as { reconciliation_warning?: boolean }).reconciliation_warning).toBe(true)

  expect(afterLateEvent.review.episodeCount).toBe(0)
  expect(afterLateEvent.review.version).toBe(beforeLateEvent.review.version)
  expect(afterLateEvent.review.finalizedAt).toBe(beforeLateEvent.review.finalizedAt)

  const reportAfter = await demo.report(current.program.id)
  expect(reportAfter.practice).toHaveLength(reportBefore.practice.length)
  const practiceRow = reportAfter.practice.find((row) => row.sessionId === sessionId)
  if (practiceRow === undefined) {
    throw new Error('idempotency: the finalized practice session is missing from the report')
  }
  expect(practiceRow.episodeCount).toBe(0)
})

// ---------------------------------------------------------------------------
// (5) Start while offline: no session is created, no timer runs.
// ---------------------------------------------------------------------------

test('start while offline: no timer starts, the screen says the session could not be started, and GET /sessions/active is 204 after reconnecting', async ({
  page,
  demo,
}) => {
  await installClock(page)

  await page.goto('/today')
  await expect(page.getByLabel('What will you produce?')).toBeVisible()

  await page.context().setOffline(true)

  await page.getByLabel('What will you produce?').fill('Draft the offline-start regression note')
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  // useStartSession retries a NetworkError twice more, 1 s apart (7.4.4) —
  // under the installed fake clock those two delays only fire once it is
  // advanced past them. `demo`'s own APIRequestContext is a separate
  // BrowserContext from `page`'s (support/demo.ts's own header comment), so
  // this still reaches the real server while `page` itself cannot.
  await advance(page, demo, 3)

  await expect(page.getByText('The session could not be started')).toBeVisible()
  expect(page.url()).toContain('/today')
  expect(page.url()).not.toMatch(/\/focus\//)
  expect(await demo.active()).toBeNull()

  await page.context().setOffline(false)

  expect(await demo.active()).toBeNull()
})

// ---------------------------------------------------------------------------
// (6) Start whose response was lost: the server genuinely processed it, but
// the client never saw the reply. Pressing Start again reaches the SAME
// session either way — no duplicate is ever created.
// ---------------------------------------------------------------------------

test('start whose response was lost: the screen says the session could not be started and no timer runs; pressing Start again renders the existing session, with exactly one session created', async ({
  page,
  demo,
}) => {
  await installClock(page)

  await page.goto('/today')
  await expect(page.getByLabel('What will you produce?')).toBeVisible()

  await page.route(SESSIONS_CREATE_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    // The request genuinely reaches the server and is processed (D6/D21) —
    // only the RESPONSE never reaches the page, unlike test (5)'s fully
    // offline case, where the request itself never leaves the browser.
    await route.fetch()
    await route.abort()
  })

  await page.getByLabel('What will you produce?').fill('Draft the lost-response regression note')
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await advance(page, demo, 3)

  await expect(page.getByText('The session could not be started')).toBeVisible()
  expect(page.url()).toContain('/today')
  expect(page.url()).not.toMatch(/\/focus\//)

  // The server really did create a session — the client just never learned
  // it. Captured now so "exactly one session exists" can be checked below
  // without a dedicated list-sessions endpoint: the id must stay identical
  // through whatever the retry click below actually does.
  const silentlyCreated = await demo.active()
  if (silentlyCreated === null) {
    throw new Error('idempotency: expected the lost-response POST /sessions to have created a session server-side')
  }
  const sessionId = silentlyCreated.id

  await page.unroute(SESSIONS_CREATE_ROUTE)

  await page.getByRole('button', { name: 'Retry', exact: true }).click()

  // Either outcome is a correct idempotent resolution of the SAME logical
  // start (the task brief's own "same-key replay -> 200, or a fresh key ->
  // 409 active_session_exists"): `StartPracticeForm`'s own textarea/target
  // never changed between clicks, so `useStartSession`'s `bodiesEqual` check
  // is expected to reuse the original key and land on the 200 branch — this
  // still checks the 409/ActiveSessionCard branch defensively in case that
  // reuse does not hold in the build actually under test.
  await expect
    .poll(
      async () => {
        if (page.url().includes(`/focus/${sessionId}`)) return 'focus'
        const cardVisible = await page
          .getByTestId('active-session-card')
          .isVisible()
          .catch(() => false)
        if (cardVisible) return 'active-card'
        return 'pending'
      },
      { timeout: 10_000 },
    )
    .not.toBe('pending')

  if (page.url().includes('/focus/')) {
    expect(page.url()).toContain(`/focus/${sessionId}`)
  } else {
    const card = page.getByTestId('active-session-card')
    await expect(card).toBeVisible()
    await expect(card.getByRole('link', { name: 'Return to your session' })).toHaveAttribute(
      'href',
      `/focus/${sessionId}`,
    )
  }

  const afterRetry = await demo.active()
  expect(afterRetry).not.toBeNull()
  expect(afterRetry?.id).toBe(sessionId)
})
