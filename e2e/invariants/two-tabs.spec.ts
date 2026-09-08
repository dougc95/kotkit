/**
 * Task 9.2.7 (design.md D16, D18, D19, D37; specs/practice-sessions: "One
 * unfinished session per user" / "Second tab", "Start while awaiting
 * review"; specs/session-recovery: "Stale writes conflict instead of
 * overwriting" / "Two tabs end a session"; specs/practice-sessions:
 * "Optional agent waiting plan" / "Save a plan mid-session", "Stale plan
 * write"; specs/daily-checkin: "One check-in per program day" / "Stale
 * save"). Five independent invariant checks, each its own `test()`, against
 * D37's single-origin acceptance harness (9.1.1). A second tab is always
 * `page.context().newPage()` — the SAME `BrowserContext` as the first page,
 * per this task's own brief — with `installClock` run on it too wherever a
 * session timer is involved (tests 1, 2, 3, 5; the check-in screen in test 4
 * runs no timer of its own, matching `checkin.spec.ts`'s own precedent of
 * never installing one there).
 *
 * Two of the five tests end a session or a check-in through a RAW API call
 * (`pageB.request.post`/`.get`) rather than the real screen's own mutation —
 * this is deliberate, not a shortcut: it is what actually produces a
 * genuinely STALE `expectedVersion` from a tab that never re-subscribed to
 * the winning write, as opposed to `recovery.spec.ts`'s own two-tab cases
 * (8.10.8), which drive both tabs through the UI and therefore exercise the
 * client's OWN 409 handling (`TransitionControls`'s `staleNotice` render).
 * This file complements that: task 2 below proves the SERVER's own 409
 * `stale_version` (D19) envelope and its `details.current` (D18) directly,
 * then separately proves that a plain `page.reload()` (a fresh `GET
 * /sessions/active`, not a client-side conflict handler) is what makes the
 * SAME tab see the session as ended — grounded in `ActiveSessionCard.tsx`'s
 * own `destinationFor` (practice + `awaiting_review` -> "Finish your
 * pending review" -> `/review/:id`) and `Today.tsx`'s own `activeQuery.data
 * ? <ActiveSessionCard/> : <NextAction/>` branch, not a component this file
 * invented.
 *
 * `AgentPanel.tsx`'s own header comment already documents test 3's exact
 * mechanics: `agent_plans` has no row until the first `PUT` creates it, so
 * BOTH tabs' first save carries the "0 means create" `expectedVersion: 0`
 * when neither has saved yet — the loser's 409 is therefore a genuine
 * version collision, not a contrived stale ID. The brief's own shorthand
 * "`session(id).plan.waitingTask`" is read against the real 2.7 contract
 * field name, `agentPlan` (D20's own "`agentPlan | null`"), not a literal
 * `plan` property that does not exist on `SessionResponseValue`.
 */
import type { Page } from '@playwright/test'
import type {
  CreateSessionBodyValue,
  DayResponseValue,
  SessionResponseValue,
  TransitionBodyValue,
} from '@attention-lab/shared'

import { expect, test, type DemoClient } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Local helpers — this file's own; no other Group 9 task's own support file
// is guaranteed to exist yet at the time this one runs (see this task's own
// brief note on concurrent authorship), so nothing here is imported from a
// sibling spec.
// ---------------------------------------------------------------------------

/**
 * Starts `working-day`'s still-open block 2 from a fresh `/today` (fills the
 * intended-output field, clicks Start) and resolves once Focus has actually
 * mounted, returning the new session's id. Mirrors `recovery.spec.ts`'s own
 * `startWorkingDayBlock` (8.10.8) and `today-start-practice.spec.ts`'s
 * inline equivalent (8.2.6) — the established convention for this exact
 * scenario, duplicated here rather than imported (file-ownership rule).
 */
async function startWorkingDayBlock(
  page: Page,
  demo: DemoClient,
  intendedOutput = 'Two-tab invariant block',
): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('two-tabs: GET /sessions/active returned null right after starting the practice block')
  }
  return active.id
}

/**
 * The one-click path from a fresh `/today` to `/checkin/:date` (mirrors
 * `checkin.spec.ts`'s own `openCheckinFromToday`, 8.7.3) — never computed
 * independently, so it works for whatever "today" the demo clock currently
 * reads.
 */
async function openCheckinFromToday(page: Page): Promise<string> {
  await page.goto('/today')
  await page.getByRole('link', { name: 'Open check-in' }).click()
  await page.waitForURL(/\/checkin\/\d{4}-\d{2}-\d{2}$/)
  const match = /\/checkin\/(\d{4}-\d{2}-\d{2})$/.exec(page.url())
  if (match?.[1] === undefined) {
    throw new Error(`two-tabs: could not parse a check-in date from ${page.url()}`)
  }
  return match[1]
}

/** `GET /programs/{id}/days/{date}` through a page's own request context (mirrors `checkin.spec.ts`'s own `getDay`). */
async function getDay(page: Page, programId: string, date: string): Promise<DayResponseValue> {
  const response = await page.request.get(`/api/v1/programs/${programId}/days/${date}`)
  if (!response.ok()) {
    throw new Error(`two-tabs: GET days/${date} -> ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as DayResponseValue
}

// ---------------------------------------------------------------------------
// Test 1 — second tab on Today shows the existing session, no Start.
// ---------------------------------------------------------------------------

test('second tab on Today during a running practice shows the existing session and no start control; following it lands on /focus/:id with the same id', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  const pageB = await page.context().newPage()
  await installClock(pageB)
  await pageB.goto('/today')

  const card = pageB.getByTestId('active-session-card')
  await expect(card).toBeVisible()
  await expect(card.getByText('Practice session in progress')).toBeVisible()

  const returnLink = card.getByRole('link', { name: 'Return to your session' })
  await expect(returnLink).toHaveAttribute('href', `/focus/${sessionId}`)
  // Scoped to the card itself (`ActiveSessionCard`, 8.2.5's own surface) —
  // `BlockCard`'s own `StartPracticeForm` still renders elsewhere on Today
  // for the now-in-progress block (a click there would just get a silently
  // swallowed 409 `active_session_exists`, per 8.2.2's own brief), so "no
  // start control" is checked against the card, not the whole page — the
  // same scoping `today-start-practice.spec.ts` (8.2.6) already established.
  await expect(card.getByRole('button', { name: /start/i })).toHaveCount(0)

  await returnLink.click()
  await pageB.waitForURL(`**/focus/${sessionId}`)
  await expect(pageB.getByTestId('timer-digits')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 2 — two tabs end the same session: stale conflict, single version
// bump, then a reload shows the pending review.
// ---------------------------------------------------------------------------

test("two tabs end the session with the same version: tab A's Finish early wins, tab B's stale end is refused with 409 stale_version carrying the current session, the version advances exactly once, and reloading shows tab B the pending review", async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)
  const beforeEnd = await demo.session(sessionId)

  const pageB = await page.context().newPage()
  await installClock(pageB)
  await pageB.goto('/today')
  await expect(pageB.getByTestId('active-session-card')).toBeVisible()

  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  const afterEnd = await demo.session(sessionId)
  expect(afterEnd.lifecycle).toBe('awaiting_review')
  expect(afterEnd.version).toBe(beforeEnd.version + 1)

  // Tab B never saw tab A's write — it still holds the version from before
  // the block started, so this genuinely is the stale end tab A already beat.
  const staleBody: TransitionBodyValue = { expectedVersion: beforeEnd.version, type: 'end' }
  const response = await pageB.request.post(`/api/v1/sessions/${sessionId}/transitions`, { data: staleBody })
  expect(response.status()).toBe(409)
  const json = (await response.json()) as { code?: string; details?: { current?: SessionResponseValue } }
  expect(json.code).toBe('stale_version')
  expect(json.details?.current?.id).toBe(sessionId)
  expect(json.details?.current?.lifecycle).toBe('awaiting_review')
  expect(json.details?.current?.version).toBe(afterEnd.version)

  // Exactly one end transition ever landed: B's stale attempt never
  // re-applied on top of A's already-successful one.
  const afterStaleAttempt = await demo.session(sessionId)
  expect(afterStaleAttempt.version).toBe(beforeEnd.version + 1)

  // Tab B's raw call never touched its own React Query cache — only a fresh
  // GET (via reload) makes it see the real, current session. `Today.tsx`'s
  // own `activeQuery.data ? <ActiveSessionCard/> : <NextAction/>` branch and
  // `ActiveSessionCard.tsx`'s own `destinationFor` (practice + awaiting_
  // review -> "Finish your pending review" -> `/review/:id`) are what
  // actually render this, not a conflict-handler this file invented.
  await pageB.reload()
  const reviewLink = pageB.getByRole('link', { name: 'Finish your pending review' })
  await expect(reviewLink).toBeVisible()
  await expect(reviewLink).toHaveAttribute('href', `/review/${sessionId}`)
  await expect(pageB.getByText('Practice session awaiting review')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 3 — stale agent plan write.
// ---------------------------------------------------------------------------

test("stale plan write: tab A saves the agent plan first, tab B (opened earlier, so its own draft implies the same not-yet-created version) is refused with 409 stale_version, and tab A's text survives server-side", async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  const pageB = await page.context().newPage()
  await installClock(pageB)
  await pageB.goto(`/focus/${sessionId}`)
  await expect(pageB.getByTestId('timer-digits')).toBeVisible()

  // Both tabs mount `AgentPanel` from a `session.agentPlan` that is still
  // `null` at this point — neither has saved yet, so both imply the same
  // `expectedVersion: 0` ("0 means create", `AgentPlanBody`'s own contract).
  await pageB.getByRole('button', { name: 'Waiting on an agent?' }).click()
  await pageB.getByLabel('Useful task while waiting').fill("Tab B's task")

  await page.getByRole('button', { name: 'Waiting on an agent?' }).click()
  await page.getByLabel('Useful task while waiting').fill("Tab A's task")
  await page.getByRole('button', { name: 'Save plan', exact: true }).click()

  // Tab A's write really did land server-side before tab B's own save fires.
  await expect
    .poll(async () => (await demo.session(sessionId)).agentPlan?.waitingTask)
    .toBe("Tab A's task")

  await pageB.getByRole('button', { name: 'Save plan', exact: true }).click()

  await expect(pageB.getByText('Another tab saved a newer plan')).toBeVisible()
  await expect(pageB.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  // `AgentPanel`'s own stale handler locks the fields and replaces the draft
  // with the plan that actually won — never offering to re-send B's edit.
  await expect(pageB.getByLabel('Useful task while waiting')).toBeDisabled()
  await expect(pageB.getByLabel('Useful task while waiting')).toHaveValue("Tab A's task")

  const session = await demo.session(sessionId)
  expect(session.agentPlan?.waitingTask).toBe("Tab A's task")
})

// ---------------------------------------------------------------------------
// Test 4 — stale check-in save.
// ---------------------------------------------------------------------------

test("stale check-in save: two tabs open /checkin/:date for today; tab A saves sleep 420 first, tab B's stale sleep 400 is rejected and shows the current values", async ({
  page,
  demo,
}) => {
  // No session timer is involved on this screen — `checkin.spec.ts` (8.7.3)
  // never installs the fake clock for the same reason, so this test doesn't
  // either.
  await demo.load('working-day')
  const current = await demo.current()
  if (current.program === null) {
    throw new Error('two-tabs: GET /programs/current has no program after loading working-day')
  }
  const programId = current.program.id

  const date = await openCheckinFromToday(page)

  const pageB = await page.context().newPage()
  await pageB.goto(`/checkin/${date}`)
  await expect(pageB.getByLabel('Sleep minutes')).toBeVisible()

  await page.getByLabel('Sleep minutes').fill('420')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL('**/today')

  // Tab B still holds the version it loaded with, before A's save — its own
  // save is genuinely stale, not a contrived conflict.
  await pageB.getByLabel('Sleep minutes').fill('400')
  await pageB.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(pageB).toHaveURL(new RegExp(`/checkin/${date}$`))
  await expect(pageB.getByText('This check-in was updated elsewhere; showing the current values')).toBeVisible()
  await expect(pageB.getByRole('button', { name: 'Re-apply my values', exact: true })).toBeVisible()
  // `CheckinForm`'s own stale handler reloads the WHOLE draft from the
  // server's current day (`dispatch({type:'loaded', day: current})`), so the
  // Sleep field itself now reads the value that actually won.
  await expect(pageB.getByLabel('Sleep minutes')).toHaveValue('420')

  const day = await getDay(page, programId, date)
  expect(day.checkin.sleepMinutes).toBe(420)
})

// ---------------------------------------------------------------------------
// Test 5 — start while awaiting review.
// ---------------------------------------------------------------------------

test('start while awaiting review: after advance(900) reaches the deadline and Review is clicked, a second page on /today offers the pending review with no Start, and POST /sessions is refused with 409 active_session_exists naming the session', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')
  const sessionId = await startWorkingDayBlock(page, demo)

  // Day 4's block 2 target is 900s (revision 2, effective Day 4) — advancing
  // exactly that far reaches the deadline (`elapsedSeconds >= targetSeconds`).
  await advance(page, demo, 900)

  await expect(page.getByText('Block time reached — save your review to record it')).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  const ended = await demo.session(sessionId)
  expect(ended.lifecycle).toBe('awaiting_review')

  const pageB = await page.context().newPage()
  await installClock(pageB)
  await pageB.goto('/today')

  const card = pageB.getByTestId('active-session-card')
  await expect(card).toBeVisible()
  const reviewLink = card.getByRole('link', { name: 'Finish your pending review' })
  await expect(reviewLink).toHaveAttribute('href', `/review/${sessionId}`)
  await expect(card.getByRole('button', { name: /start/i })).toHaveCount(0)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('two-tabs: GET /programs/current has no program after loading working-day')
  }
  const startBody: CreateSessionBodyValue = {
    programId: current.program.id,
    kind: 'practice',
    intendedOutput: 'A second attempt while a review is pending',
    targetSeconds: 900,
  }
  const response = await pageB.request.post('/api/v1/sessions', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: startBody,
  })
  expect(response.status()).toBe(409)
  const json = (await response.json()) as { code?: string; details?: { activeSessionId?: string } }
  expect(json.code).toBe('active_session_exists')
  expect(json.details?.activeSessionId).toBe(sessionId)
})
