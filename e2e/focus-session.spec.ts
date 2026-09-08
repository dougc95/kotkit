/**
 * Task 8.5.6 (design.md D5, D9, D11, D16, D18, D20, D29; practice-sessions:
 * "Pause and resume are explicit" / "Planned break", "Interruption events
 * with undo and subtypes" / "Agent check that was also off-task",
 * "Optional agent waiting plan" / "Save a plan mid-session"; app-shell:
 * "Implementation details are not user-facing" / "Sync state display";
 * session-recovery: "Pending, saved and could-not-save are distinct").
 * Drives the real Today (8.2.1/8.2.2) -> Focus (8.5.3) screen, its
 * AgentPanel (8.5.5), EventButtons (8.5.1) and SyncStatus (8.5.2), against
 * the `working-day` demo scenario (Day 4, `packages/shared/src/fixtures/
 * demoScenarios.ts` — block 1 already finalized for the day, block 2 not
 * started), through three invariants in one continuous session:
 *
 *  - "Take a screen-free break" (AgentPanel) posts a `pause` transition
 *    (D29's `reason: 'planned break'`); while paused, the remaining display
 *    derives purely from server-truth fields (D5) and does not drift even
 *    after 120 real (fake-clock) seconds pass server-side, and `Resume`
 *    posts `resume` with `pausedSeconds` reflecting at least that gap.
 *  - An "Agent check" confirmed with "This was also an off-task episode"
 *    ticked records exactly ONE `agent_check` event with
 *    `details.alsoOffTask: true` — D11's "nothing is summed across the two
 *    tallies" means Off-task and Agent checks both read 1 from that single
 *    event, and no element anywhere renders the summed figure "2".
 *  - `SyncStatus` (D6/D16) never reads "Saved" while a batch POST to
 *    `/sessions/{id}/events` is dispatched but not yet acknowledged — proven
 *    deterministically by holding a real request open behind a manually
 *    released gate (`page.route` + `route.fulfill`, not a timing race) —
 *    and reads "Saved" only once that gate is released and the response
 *    lands.
 *
 * The SyncStatus region is selected by `[role="status"][aria-live="polite"]`
 * rather than the bare `status` role: `TransitionControls`'s own "Paused"
 * text (`<p role="status">`, no `aria-live` attribute) and Focus's deadline
 * message share the same implicit ARIA role, so the explicit `aria-live`
 * attribute — set only by `SyncStatus.tsx` — is what disambiguates the two
 * without depending on which one happens to be absent at a given moment.
 */
import type { Page } from '@playwright/test'
import type { EventResponseValue } from '@attention-lab/shared'

import { expect, test } from './support/demo.js'
import { advance, installClock } from './support/clock.js'

/** Parses `TimerDisplay`'s `mm:ss` text (`lib/clock/remaining.ts`'s `formatRemaining`) into whole seconds. */
function parseRemainingSeconds(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`focus-session: could not parse mm:ss from "${text}"`)
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

test.beforeEach(async ({ demo }) => {
  await demo.load('working-day')
})

test('screen-free break freezes remaining with no drift, an also-off-task agent check tallies without double-counting, and SyncStatus never claims Saved before acknowledgement', async ({
  page,
  demo,
}) => {
  // Must install before this test's first navigation (clock.ts's own
  // documented requirement).
  await installClock(page)

  expect(await demo.active()).toBeNull()

  await page.goto('/today')

  const intendedOutput = 'Draft the follow-up notes for the design review'
  await page.getByLabel('What will you produce?').fill(intendedOutput)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(`focus-session: could not read a session id from the URL "${page.url()}"`)
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('focus-session: GET /sessions/active returned null right after Start')
  }
  expect(active.id).toBe(sessionId)
  expect(active.kind).toBe('practice')

  // ---------------------------------------------------------------------
  // Screen-free break: AgentPanel's pause, no drift while paused, Resume.
  // ---------------------------------------------------------------------
  await page.getByRole('button', { name: 'Waiting on an agent?' }).click()
  await page.getByRole('button', { name: 'Take a screen-free break' }).click()

  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect.poll(async () => (await demo.active())?.lifecycle).toBe('paused')

  const remainingAtPauseSeconds = await readRemainingSeconds(page)

  await advance(page, demo, 120)

  // The countdown derives purely from server-truth fields (D5): paused time
  // is excluded from elapsed, so 120 real seconds passing server-side while
  // paused must not move the display. A small tolerance absorbs only the
  // optimistic-vs-server-confirmed skew at the instant `remainingAtPauseSeconds`
  // was captured, never accumulated drift from the advance itself.
  await expect
    .poll(async () => Math.abs((await readRemainingSeconds(page)) - remainingAtPauseSeconds))
    .toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(async () => (await demo.active())?.lifecycle).toBe('running')

  const afterResume = await demo.session(sessionId)
  expect(afterResume.lifecycle).toBe('running')
  expect(afterResume.pausedSeconds).toBeGreaterThanOrEqual(120)

  // ---------------------------------------------------------------------
  // Agent check tallying: one event, both tallies read 1, never a summed 2.
  // ---------------------------------------------------------------------
  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await eventsGroup.getByRole('button', { name: 'Agent check' }).click()

  const confirmGroup = page.getByRole('group', { name: 'Confirm agent check' })
  await confirmGroup.getByRole('checkbox', { name: 'This was also an off-task episode' }).check()
  await confirmGroup.getByRole('button', { name: 'Log agent check' }).click()

  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('1')
  await expect(page.locator('dt:text-is("Agent checks") + dd')).toHaveText('1')

  const talliedDigits = await page.locator('dl dd').allInnerTexts()
  expect(talliedDigits).not.toContain('2')

  await expect.poll(async () => (await demo.session(sessionId)).tallies.offTask).toBe(1)
  const afterAgentCheck = await demo.session(sessionId)
  expect(afterAgentCheck.tallies.agentChecks).toBe(1)

  const nonVoidedAgentChecks = afterAgentCheck.events.filter(
    (event) => event.type === 'agent_check' && event.voidedAt === null,
  )
  expect(nonVoidedAgentChecks).toHaveLength(1)
  const agentCheckEvent = nonVoidedAgentChecks[0]
  if (agentCheckEvent === undefined) {
    throw new Error('focus-session: expected exactly one non-voided agent_check event')
  }
  expect(alsoOffTaskFlag(agentCheckEvent)).toBe(true)

  // ---------------------------------------------------------------------
  // SyncStatus timing: Saved only after acknowledgement, never while a
  // dispatched batch is held. `[aria-live="polite"]` is what disambiguates
  // this region from TransitionControls's own `role="status"` "Paused" text
  // (no `aria-live` there), which is no longer rendered at this point in the
  // flow (the session is running again) but would otherwise collide.
  // ---------------------------------------------------------------------
  const syncStatus = page.locator('[role="status"][aria-live="polite"]')
  await expect(syncStatus).toContainText('Saved')

  const hold: { release: () => void } = { release: () => {} }
  const holdGate = new Promise<void>((resolve) => {
    hold.release = resolve
  })

  await page.route(/\/api\/v1\/sessions\/[^/]+\/events$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await holdGate
    const body = route.request().postDataJSON() as { events: ReadonlyArray<{ clientEventId: string }> }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: body.events.map((event) => event.clientEventId), duplicates: [] }),
    })
  })

  await eventsGroup.getByRole('button', { name: 'External interruption' }).click()

  await expect(syncStatus).toContainText('Pending')

  // Deterministic, not a timing race: the request is held behind our own
  // gate, not a real server, so this window proves "never Saved while held"
  // regardless of how fast the real backend would have responded.
  await page.waitForTimeout(500)
  await expect(syncStatus).toContainText('Pending')
  await expect(syncStatus).not.toContainText('Saved')

  hold.release()

  await expect(syncStatus).toContainText('Saved')
})
