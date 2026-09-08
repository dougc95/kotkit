/**
 * Task 9.1.5 (design.md D5, D9, D11, D15, D16, D20, D24, D29, D31, D38;
 * specs/practice-sessions: "Today shows one next action and two blocks" /
 * "Day 4 with one block done" and "Returning user can start in three
 * actions", "Practice requires a short intended output" / "Start without
 * output", "Practice timer and elapsed time" / "Target reached", "Pause and
 * resume are explicit" / "Planned break" and "Paused seconds excluded",
 * "Interruption events with undo and subtypes" / "Agent check that was also
 * off-task" and "One departure, five apps", "Optional agent waiting plan" /
 * "Save a plan mid-session", "Session review saves honest outcomes";
 * specs/session-recovery: "Starting a session requires the server";
 * specs/app-shell: "Navigation exists outside session mode only" /
 * "Navigation hidden during practice", "Copy never punishes or gamifies";
 * specs/research-cards: "Never surfaced in session mode" / "During
 * practice"; specs/identity-realm: "Demo mode is permanently and
 * unmistakably labeled" / "Banner on every screen"). Drives the real Today
 * (8.2.1/8.2.2) -> Focus (8.5.3/8.5.4/8.5.5) -> PracticeReview (8.6.2)
 * screens against the `working-day` demo scenario (Day 4,
 * `packages/shared/src/fixtures/demoScenarios.ts` — both baselines
 * eligible, six practice blocks already qualified across Days 1-3, block 1
 * already finalized for Day 4 at the accepted revision-2 target of 900 s/15
 * min, block 2 not started, no final attempt yet), through the seven named
 * journeys the brief lists, each an independent test against a freshly
 * loaded scenario.
 *
 * `startBlockTwo` (below) is this file's own "fill the intended-output
 * field, click Start, land on a running Focus" helper — the same three
 * lines `e2e/today-start-practice.spec.ts`/`e2e/practice-review.spec.ts`/
 * `e2e/focus-session.spec.ts` (Group 8's own dev-server e2e suites) already
 * use for this exact scenario, kept local to this file per this workflow's
 * file-ownership rule rather than imported from any of them.
 */
import type { Page } from '@playwright/test'
import type { EventResponseValue } from '@attention-lab/shared'

import { expect, test } from '../support/demo.js'
import { advance, installClock } from '../support/clock.js'
import { expectDemoBanner, expectNoPunitiveCopy } from '../support/copy.js'

/** Block 2's target on the working-day scenario's Day 4 (revision 2, effective day 4): 900 s = 15 min. */
const BLOCK_TARGET_SECONDS = 15 * 60

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Starts block 2 from a fresh /today (fills the intended-output field, clicks Start) and returns its session id. */
async function startBlockTwo(page: Page, intendedOutput: string): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`working-day: could not read a session id from the URL "${page.url()}"`)
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return sessionId
}

/** Parses `TimerDisplay`'s `mm:ss` text (`lib/clock/remaining.ts`'s `formatRemaining`) into whole seconds. */
function parseRemainingSeconds(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`working-day: could not parse mm:ss from "${text}"`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

async function readRemainingSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId('timer-digits').innerText()
  return parseRemainingSeconds(text)
}

/** `event.details` is a response-side union (`EventDetailsResponseSchema |
 * ClockGapDetailsResponseSchema`) — only the first branch ever carries
 * `alsoOffTask`, so this reads it duck-typed rather than narrowing the union. */
function alsoOffTaskFlag(event: EventResponseValue): boolean {
  const details = event.details as unknown as Record<string, unknown>
  return details['alsoOffTask'] === true
}

// ---------------------------------------------------------------------------
// 1. Day 4 Today: block 1 completed, block 2 next, 15 min target
// ---------------------------------------------------------------------------

test('Day 4 Today: block 1 completed, block 2 is the next action, target 15 min from the governing revision, no punitive copy', async ({
  page,
  demo,
}) => {
  const current = await demo.current()
  if (current.program === null || current.revision === null) {
    throw new Error('working-day: expected an active program with a governing revision after loading working-day')
  }
  expect(current.day).toBe(4)
  expect(current.revision.settings.practiceTargetSeconds).toBe(900)

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Day 4 of 14' })).toBeVisible()

  const today = await demo.today(current.program.id)
  expect(today.day).toBe(4)
  const block1 = today.blocks.find((block) => block.index === 1)
  const block2 = today.blocks.find((block) => block.index === 2)
  expect(block1?.status).toBe('completed')
  expect(block2?.status).toBe('not_started')
  expect(block2?.targetSeconds).toBe(900)
  expect(today.nextAction.kind).toBe('practice')
  if (today.nextAction.kind === 'practice') {
    expect(today.nextAction.block).toBe(2)
  }

  const blockOneCard = page.locator('[data-block-index="1"]')
  await expect(blockOneCard.locator('[data-status]')).toHaveAttribute('data-status', 'completed')
  await expect(blockOneCard).toContainText('Completed')

  const blockTwoCard = page.locator('[data-block-index="2"]')
  await expect(blockTwoCard.locator('[data-status]')).toHaveAttribute('data-status', 'not_started')
  await expect(blockTwoCard).toContainText('Not started')
  await expect(blockTwoCard).toContainText('15 min')

  await expect(page.getByRole('button', { name: 'Block 2 is next' })).toBeVisible()

  await expectNoPunitiveCopy(page)
})

// ---------------------------------------------------------------------------
// 2. Empty intended output: Start does nothing, field marked required
// ---------------------------------------------------------------------------

test('empty intended output: Start does nothing, the field is marked required, GET /sessions/active stays 204', async ({
  page,
  demo,
}) => {
  expect(await demo.active()).toBeNull()

  await page.goto('/today')

  const blockTwoCard = page.locator('[data-block-index="2"]')
  await blockTwoCard.getByRole('button', { name: 'Start', exact: true }).click()

  await expect(blockTwoCard.getByRole('alert')).toHaveText('Required')
  await expect(blockTwoCard.getByLabel('What will you produce?')).toHaveAttribute('aria-invalid', 'true')

  expect(page.url()).toContain('/today')
  expect(await demo.active()).toBeNull()
})

// ---------------------------------------------------------------------------
// 3. Typed output + Start reaches Focus in <=3 actions, only after the
//    server acknowledged the POST /sessions call.
// ---------------------------------------------------------------------------

test('typing an output then Start reaches a running Focus in at most 3 user actions, only after the server acknowledged', async ({
  page,
  demo,
}) => {
  await page.goto('/today')
  expect(await demo.active()).toBeNull()

  let releaseGate: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  await page.route(/\/api\/v1\/sessions$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await gate
    await route.continue()
  })

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/sessions') && response.request().method() === 'POST',
  )

  const intendedOutput = 'Draft the outline for the newsletter piece'
  let actionCount = 0

  await page.getByLabel('What will you produce?').fill(intendedOutput)
  actionCount += 1
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  actionCount += 1

  expect(actionCount).toBeLessThanOrEqual(3)

  // Held behind the gate: the POST has been dispatched but not yet answered
  // — navigation must not have happened yet (deterministic, not a timing
  // race — the request is held behind our own gate, not a real server, so
  // this window proves "no navigation before acknowledgement" regardless of
  // how fast the real backend would have responded).
  await page.waitForTimeout(300)
  expect(page.url()).toContain('/today')
  expect(await demo.active()).toBeNull()

  releaseGate()
  const response = await responsePromise
  expect(response.status()).toBe(201)

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`working-day: could not read a session id from the URL "${page.url()}"`)
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('working-day: GET /sessions/active returned null right after Start acknowledged')
  }
  expect(active.id).toBe(sessionId)
  expect(active.lifecycle).toBe('running')
  expect(active.intendedOutput).toBe(intendedOutput)
  expect(active.startedAt.length).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// 4. Focus is session mode: no nav landmark, no research link/text, banner
//    still in viewport.
// ---------------------------------------------------------------------------

test('Focus is session mode: no navigation landmark, no link to /research, no research text, banner in viewport', async ({
  page,
}) => {
  await startBlockTwo(page, 'Confirm Focus renders no navigation chrome')

  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /research/i })).toHaveCount(0)

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/research/i)

  await expectDemoBanner(page)
})

// ---------------------------------------------------------------------------
// 5. Agent plan saved mid-session; screen-free break pauses (reason
//    "planned break") and freezes the countdown; Resume; Return to my task
//    closes the panel and the countdown moves again.
// ---------------------------------------------------------------------------

test('agent plan saved mid-session; a screen-free break pauses and freezes the countdown; Resume; Return to my task closes the panel and the countdown moves again', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const sessionId = await startBlockTwo(page, 'Draft the release notes while the agent runs the test suite')

  await page.getByRole('button', { name: 'Waiting on an agent?' }).click()
  const waitingTaskText = 'Skim the changelog draft while the agent finishes'
  await page.getByLabel('Useful task while waiting').fill(waitingTaskText)
  await page.getByRole('button', { name: 'Save plan', exact: true }).click()

  await expect
    .poll(async () => (await demo.session(sessionId)).agentPlan?.waitingTask ?? null)
    .toBe(waitingTaskText)

  await page.getByRole('button', { name: 'Take a screen-free break', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await expect.poll(async () => (await demo.session(sessionId)).lifecycle).toBe('paused')

  const pausedEvent = (await demo.session(sessionId)).events.find(
    (event) => event.type === 'pause' && event.voidedAt === null,
  )
  const pausedDetails = pausedEvent?.details as unknown as Record<string, unknown> | undefined
  expect(pausedDetails?.['reason']).toBe('planned break')

  const remainingAtPause = await readRemainingSeconds(page)
  await advance(page, demo, 240)

  // D5: the countdown derives purely from server-truth fields — paused time
  // is excluded from elapsed, so 240 s passing server-side while paused
  // must not move the display. A small tolerance absorbs only the
  // optimistic-vs-server-confirmed skew at the instant `remainingAtPause`
  // was captured, never accumulated drift from the advance itself.
  await expect
    .poll(async () => Math.abs((await readRemainingSeconds(page)) - remainingAtPause))
    .toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  // Wait for the DOM itself (not just the server) to reflect "running" again
  // — TransitionControls swaps "Paused"/Resume back for the plain "Pause"
  // trigger once the mutation's own response lands — before reading the
  // countdown below, so the second `advance()` measures against the
  // client's already-updated anchor rather than racing its own re-render.
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect.poll(async () => (await demo.session(sessionId)).lifecycle).toBe('running')
  const afterResume = await demo.session(sessionId)
  expect(afterResume.pausedSeconds).toBeGreaterThanOrEqual(240)

  await page.getByRole('button', { name: 'Return to my task', exact: true }).click()
  await expect(page.getByLabel('Useful task while waiting')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Waiting on an agent?' })).toBeVisible()

  const remainingBeforeSecondAdvance = await readRemainingSeconds(page)
  await advance(page, demo, 5)

  await expect
    .poll(async () => remainingBeforeSecondAdvance - (await readRemainingSeconds(page)))
    .toBeGreaterThanOrEqual(3)
})

// ---------------------------------------------------------------------------
// 6. One Record after returning = one episode; an also-off-task agent check
//    tallies off-task 2 / agent checks 1, never 3 (D11).
// ---------------------------------------------------------------------------

test('one Record after returning = one episode; an agent check marked also-off-task gives off-task tally 2 and agent-check tally 1, never 3', async ({
  page,
  demo,
}) => {
  const sessionId = await startBlockTwo(page, 'Summarize the meeting notes before the next call')

  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('1')

  await eventsGroup.getByRole('button', { name: 'Agent check', exact: true }).click()
  const confirmGroup = page.getByRole('group', { name: 'Confirm agent check' })
  await confirmGroup.getByRole('checkbox', { name: 'This was also an off-task episode' }).check()
  await confirmGroup.getByRole('button', { name: 'Log agent check', exact: true }).click()

  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2')
  await expect(page.locator('dt:text-is("Agent checks") + dd')).toHaveText('1')

  const talliedDigits = await page.locator('dl dd').allInnerTexts()
  expect(talliedDigits).not.toContain('3')

  await expect.poll(async () => (await demo.session(sessionId)).tallies.offTask).toBe(2)
  const session = await demo.session(sessionId)
  expect(session.tallies.agentChecks).toBe(1)

  const nonVoidedOffTask = session.events.filter((event) => event.type === 'off_task' && event.voidedAt === null)
  expect(nonVoidedOffTask).toHaveLength(1)

  const nonVoidedAgentChecks = session.events.filter(
    (event) => event.type === 'agent_check' && event.voidedAt === null,
  )
  expect(nonVoidedAgentChecks).toHaveLength(1)
  const agentCheckEvent = nonVoidedAgentChecks[0]
  if (agentCheckEvent === undefined) {
    throw new Error('working-day: expected exactly one non-voided agent_check event')
  }
  expect(alsoOffTaskFlag(agentCheckEvent)).toBe(true)
})

// ---------------------------------------------------------------------------
// 7. A 240 s pause plus 900 s of unpaused time reaches awaiting review (not
//    at 900 wall seconds); the review prefills S 2 (method event), agent
//    checks 1, E blank; Yes finalizes with the exact reported counts and
//    Today shows block 2 completed.
// ---------------------------------------------------------------------------

test('with a 240 s pause, awaiting review arrives after 900 s of unpaused time; the review prefills honestly; Yes finalizes and Today shows block 2 completed', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const sessionId = await startBlockTwo(page, 'Write up the incident retro before end of day')

  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2')

  await eventsGroup.getByRole('button', { name: 'Agent check', exact: true }).click()
  const confirmGroup = page.getByRole('group', { name: 'Confirm agent check' })
  // Left unchecked on purpose: this agent check is NOT also an off-task
  // episode, so it must not add to the off-task tally (D11).
  await confirmGroup.getByRole('button', { name: 'Log agent check', exact: true }).click()
  await expect(page.locator('dt:text-is("Agent checks") + dd')).toHaveText('1')
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('2')

  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await expect.poll(async () => (await demo.session(sessionId)).lifecycle).toBe('paused')

  // Paused time excluded (D5): this 240 s must not count toward the 900 s
  // unpaused target below — "awaiting review arrives after 900 s of
  // unpaused time, not at 900 wall seconds".
  await advance(page, demo, 240)

  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect.poll(async () => (await demo.session(sessionId)).lifecycle).toBe('running')

  // 240 (paused) + 900 (unpaused) = 1140 s advanced in total, matching the
  // brief's own "advance 1140 in total" — yet only the 900 unpaused seconds
  // reach the target.
  await advance(page, demo, BLOCK_TARGET_SECONDS)

  await expect(page.getByText('Block time reached — save your review to record it')).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)

  // S prefilled 2 (from the recorded events, method 'event'); agent checks
  // prefilled 1; E stays BLANK (empty string), never 0 (unknown != zero —
  // no external interruption was ever recorded).
  await expect(page.locator('#episode-count')).toHaveValue('2')
  await expect(page.locator('#episode-count-hint')).toHaveText('prefilled from recorded events')
  await expect(page.locator('#external-count')).toHaveValue('')
  await expect(page.locator('#external-count-hint')).toHaveCount(0)
  await expect(page.locator('#unplanned-agent-checks')).toHaveValue('1')
  await expect(page.locator('#unplanned-agent-checks-hint')).toHaveText('prefilled from recorded events')

  await page.getByRole('radio', { name: 'Yes', exact: true }).click()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await page.waitForURL('**/today')

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('finalized')
  expect(session.review.outputQuality).toBe('yes')
  expect(session.review.episodeCount).toBe(2)
  expect(session.review.countMethod).toBe('event')
  expect(session.review.unplannedAgentChecks).toBe(1)
  expect(session.review.externalCount).toBeNull()
  expect(session.pausedSeconds).toBeGreaterThanOrEqual(240)
  expect(session.pausedSeconds).toBeLessThan(250)

  const current = await demo.current()
  if (current.program === null) {
    throw new Error('working-day: GET /programs/current returned no program after a session was finalized')
  }
  const today = await demo.today(current.program.id)
  const ourBlock = today.blocks.find((block) => block.sessionId === sessionId)
  if (ourBlock === undefined) {
    throw new Error(`working-day: no Today block is occupied by session ${sessionId}`)
  }
  const blockStatus = await page
    .locator(`[data-block-index="${ourBlock.index}"] [data-status]`)
    .getAttribute('data-status')
  expect(blockStatus).toBe('completed')

  await expectNoPunitiveCopy(page)
})
