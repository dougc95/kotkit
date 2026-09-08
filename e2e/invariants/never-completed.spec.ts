/**
 * Task 9.2.3 — Invariant: expiry, early stop and abandon never become
 * completion (design.md D4, D5, D9, D18-D20, D24-D26, D31; CLAUDE.md:
 * "Timer expiry never proves completion; sync failure and incomplete
 * attempts never become completed results. Pending, saved and uncertain
 * must stay distinguishable."; specs/session-recovery: "Clock gaps are
 * detected and resolved by the user" / "Deadline passed during sleep",
 * "Abandon and save-incomplete are always available"; specs/
 * benchmark-assessment: "Fixed interval with no valid pause" / "Interval
 * reached", "Stop early"; specs/practice-sessions: "Practice timer and
 * elapsed time" / "Target reached"; specs/app-shell: "Copy never punishes
 * or gamifies").
 *
 * Every test here drives the REAL screens directly (never `runBenchmark`,
 * task 9.1.4's helper): each scenario inserts a clock-gap resolution, a
 * Stop-early confirm or an Abandon in the MIDDLE of the benchmark/practice
 * flow, a step `runBenchmark` (Start straight through Finalize, with no
 * seam for an interruption) has no hook for.
 *
 * A note on the clock-gap magnitude these tests observe: `sleep()`
 * (`e2e/support/clock.ts`) computes its target via `Date.now() +
 * seconds * 1000` evaluated in the TEST RUNNER's own (real) Node context,
 * not the page's already-advanced fake clock — so a `sleep(N)` call that
 * follows a prior `advance(M)` in the same test does not land the fake
 * clock exactly `N` seconds past where `advance` left it; the resulting
 * `gapSeconds` the client's heartbeat reports can be much larger than `N`
 * (still `Math.abs(...)`-ed before it is ever sent, per `useClockGap.ts`,
 * so the resolve call itself never fails). Every assertion below that
 * depends only on "a gap larger than the 60 s threshold was detected and
 * resolved" is unaffected; the one assertion that would depend on the
 * exact reported magnitude (test 3's "about 300 s") is deliberately
 * written as a threshold check instead of a tight range — see this file's
 * own inline comment there, and this task's own `notes`.
 */
import { expect, test } from '../support/demo.js'
import { installClock, advance, sleep } from '../support/clock.js'
import { expectNoPunitiveCopy } from '../support/copy.js'
import { EXCLUSION_REASON_COPY } from '@attention-lab/shared'
import type { SlotResponseValue } from '@attention-lab/shared'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function findBaselineSlot(slots: readonly SlotResponseValue[], label: 'A' | 'B'): SlotResponseValue {
  const slot = slots.find((candidate) => candidate.phase === 'baseline' && candidate.label === label)
  if (slot === undefined) {
    throw new Error(`never-completed.spec: no baseline ${label} slot found`)
  }
  return slot
}

/** Five recall points: three answered, two deliberately blank (mirrors 9.1.4's own fixture shape). */
const RECALL_POINTS: readonly [string, string, string, string, string] = [
  'It described a fixed daily reading block rather than an open-ended one.',
  'It mentioned a two-week baseline period before any change was made.',
  'It contrasted sustained attention with working memory directly.',
  '',
  '',
]

/** Drives Recall (Start recall -> the three answered points -> Save recall) once the interval has already ended. */
async function fillRecall(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Start recall', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start recall', exact: true }).click()

  await expect(page.getByLabel('Point 1')).toBeVisible()
  for (const [index, value] of RECALL_POINTS.entries()) {
    await page.getByLabel(`Point ${index + 1}`).fill(value)
  }

  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
}

/** Drives Scoring's Accurate radios for the three non-blank points, then the shared observed-conditions checkbox and disruption answer. Stops short of clicking Finalize. */
async function scoreAndAttest(
  page: import('@playwright/test').Page,
  disruption: 'yes' | 'no',
): Promise<void> {
  await expect(page.getByText(/Recall score \(self-reported, preview\)/)).toBeVisible()
  for (let index = 0; index < 3; index++) {
    const pointGroup = page.getByRole('group', { name: `Point ${index + 1} score` })
    await pointGroup.getByRole('radio', { name: 'Accurate', exact: true }).click()
  }
  await page.getByRole('checkbox', { name: 'These conditions are correct' }).check()
  await page
    .getByRole('radio', { name: disruption === 'yes' ? 'Yes' : 'No', exact: true })
    .click()
}

/** Reads how many rows the outbox (`attention-lab-outbox` / `events`, `e2e/support/../lib/outbox/store.ts`'s own schema) still holds for one session. */
async function outboxRowCount(page: import('@playwright/test').Page, sessionId: string): Promise<number> {
  return page.evaluate((sid) => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('attention-lab-outbox')
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
      request.onsuccess = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('events')) {
          resolve(0)
          return
        }
        const tx = db.transaction('events', 'readonly')
        const index = tx.objectStore('events').index('bySession')
        const getRequest = index.getAll(IDBKeyRange.only(sid))
        getRequest.onsuccess = () => resolve((getRequest.result as unknown[]).length)
        getRequest.onerror = () => reject(getRequest.error ?? new Error('indexedDB read failed'))
      }
    })
  }, sessionId)
}

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// 1. Benchmark: an unresolved-then-resolved clock gap past the deadline
//    never becomes a completed attempt.
// ---------------------------------------------------------------------------

test('benchmark: sleeping past the deadline leaves the attempt unresolved, never completed, until resolved — and the server still has no review', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  await page.goto(`/benchmark/${baselineA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Session events' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('never-completed.spec: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  await advance(page, demo, 1080)
  await sleep(page, demo, 300)

  // Wake: the gap prompt opens; the underlying screen still reads "running"
  // from the client's own (not-yet-resynced) clock — nothing here has
  // called finalize, and nothing ever uses the word "completed".
  const gapDialog = page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })
  await expect(gapDialog).toBeVisible()
  await expect(page.locator('body')).not.toHaveText(/\bcompleted\b/i)

  // Waking answers "Not sure" (mirrors D26's real user path): the dialog
  // closes, the client resyncs to server truth via the resolve's own
  // invalidate, and the deadline-reached screen appears — still never
  // finalized, still never "completed".
  await page.getByRole('button', { name: 'Not sure', exact: true }).click()
  await expect(gapDialog).toHaveCount(0)
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content — matched by text, not role+name.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toHaveText(/\bcompleted\b/i)

  const session = await demo.session(sessionId)
  // D31: the review row exists from session start and is never `null` as a
  // whole — "no review" is every review field still unwritten, not the
  // field itself being absent.
  expect(session.review.recallLockedAt).toBeNull()
  expect(session.review.finalizedAt).toBeNull()
  expect(session.review.outputQuality).toBeNull()
  expect(session.eligible).toBeNull()
  expect(session.lifecycle).toBe('running')
})

// ---------------------------------------------------------------------------
// 2. Benchmark: "Not sure" -> timer_uncertain persists into the eligibility
//    preview and into the finalized result.
// ---------------------------------------------------------------------------

test('benchmark: "Not sure" after the deadline keeps timer_uncertain visible in the eligibility preview and stored at finalize', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  await page.goto(`/benchmark/${baselineA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Session events' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('never-completed.spec: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  await advance(page, demo, 1080)
  await sleep(page, demo, 300)

  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()
  await page.getByRole('button', { name: 'Not sure', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content — matched by text, not role+name.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await fillRecall(page)
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  await scoreAndAttest(page, 'no')

  // D4: the preview is always labeled as one, and — since resolving "Not
  // sure" already forced timer_quality to 'uncertain' server-side — it
  // already names timer_uncertain before Finalize is ever clicked.
  await expect(page.getByText('Preview — the server decides at finalize')).toBeVisible()
  await expect(page.getByText(EXCLUSION_REASON_COPY.timer_uncertain)).toBeVisible()

  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.timerQuality).toBe('uncertain')
  expect(session.exclusionReasons).toContain('timer_uncertain')
  expect(session.lifecycle).toBe('finalized')
})

// ---------------------------------------------------------------------------
// 3. Benchmark: "Yes, it continued" -> a gap is recorded, timer quality
//    stays ok, and recall/scoring/finalize proceed exactly as normal.
// ---------------------------------------------------------------------------

test('benchmark: "Yes, it continued" after the deadline records a gap, keeps timer quality ok, and recall proceeds normally to a finalized eligible attempt', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  await page.goto(`/benchmark/${baselineA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Session events' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('never-completed.spec: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  await advance(page, demo, 1080)
  await sleep(page, demo, 300)

  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content — matched by text, not role+name.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await fillRecall(page)
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  await scoreAndAttest(page, 'no')
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.timerQuality).toBe('ok')
  expect(session.exclusionReasons).not.toContain('timer_uncertain')
  // A real gap was detected (the dialog opened at all, above, already proves
  // that) and "Yes, it continued" resolves it without forcing uncertainty —
  // this is the sign-independent, magnitude-independent invariant this test
  // actually protects. `clockGapSeconds` is asserted only as "a real,
  // above-threshold number was recorded", not pinned to an exact value — see
  // this file's own header comment on why "about 300 s" is not a safe exact
  // assertion given how `advance` then `sleep` compose in this suite.
  expect(session.clockGapSeconds).not.toBeNull()
  if (session.clockGapSeconds !== null) {
    expect(session.clockGapSeconds).toBeGreaterThanOrEqual(60)
  }
  expect(session.lifecycle).toBe('finalized')
})

// ---------------------------------------------------------------------------
// 4. Practice: sleeping across the target never becomes "completed" until
//    the review is actually saved — checked from a second page too.
// ---------------------------------------------------------------------------

test('practice: sleeping across the target leaves the block not completed until the review is saved, visible from a second page', async ({
  page,
  context,
  demo,
}) => {
  await installClock(page)
  const { programId } = await demo.load('working-day')

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify sleep across the practice target')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!

  await advance(page, demo, 840)
  await sleep(page, demo, 180)

  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText('Block time reached — save your review to record it')).toBeVisible()

  // A second page, opened fresh, must show this same block as in progress
  // or awaiting review — never completed — before the review is saved.
  const page2 = await context.newPage()
  await page2.goto('/today')
  const activeCard = page2.getByTestId('active-session-card')
  await expect(activeCard).toBeVisible()
  await expect(activeCard).toContainText(/Practice session (in progress|awaiting review)/)
  await expect(page2.locator('body')).not.toHaveText(/\bcompleted\b/i)
  await page2.close()

  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForURL(/\/review\/[0-9a-f-]{36}$/i)

  // Still not completed: the review screen is reached, but nothing has been
  // saved yet.
  const midway = await demo.session(sessionId)
  expect(midway.lifecycle).toBe('awaiting_review')
  expect(midway.review.finalizedAt).toBeNull()

  await page.getByRole('radio', { name: 'Yes', exact: true }).click()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await page.waitForURL('**/today')

  const today = await demo.today(programId as string)
  const savedBlock = today.blocks.find((block) => block.sessionId === sessionId)
  if (savedBlock === undefined) {
    throw new Error('never-completed.spec: expected the finalized session to still be referenced by a Today block')
  }
  expect(savedBlock.status).toBe('completed')

  const finalSession = await demo.session(sessionId)
  expect(finalSession.lifecycle).toBe('finalized')
  expect(finalSession.review.finalizedAt).not.toBeNull()
})

// ---------------------------------------------------------------------------
// 5. Benchmark: Stop early records an interval-incomplete attempt, never
//    starts a second one, and the Progress row never reads "completed".
// ---------------------------------------------------------------------------

test('benchmark: Stop early records an interval-incomplete attempt with recall optional, starts no new attempt, and the Progress row never reads completed', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  await page.goto(`/benchmark/${baselineA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Session events' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('never-completed.spec: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  await advance(page, demo, 840)

  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  const confirmGroup = page.getByRole('group', { name: 'Confirm stop early' })
  await expect(confirmGroup).toBeVisible()
  await confirmGroup.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  // D25: recall is optional for an incomplete attempt, and no new attempt
  // has started in its place.
  await expect(page.getByText('Incomplete attempt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip recall', exact: true })).toBeVisible()

  const activeAfterStop = await demo.active()
  expect(activeAfterStop === null || activeAfterStop.id === sessionId).toBe(true)

  await page.getByRole('button', { name: 'Skip recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)
  await expect(page.getByText('Recall not saved — this attempt will be recorded with recall missing')).toBeVisible()

  await page.getByRole('checkbox', { name: 'These conditions are correct' }).check()
  await page.getByRole('radio', { name: 'No', exact: true }).click()
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.completeInterval).toBe(false)
  expect(session.exclusionReasons).toContain('interval_incomplete')
  expect(session.lifecycle).toBe('finalized')

  if (session.endedAt === null) {
    throw new Error('never-completed.spec: expected endedAt to be set once the session ended')
  }
  // `demo.setClock` is an OFFSET added to the real wall clock (D35), not a
  // frozen virtual instant (`e2e/support/clock.ts`'s own header comment) —
  // so the REAL time this test's own "Stop early" click, its confirm
  // dialog and click all take lands on top of the 840 s `advance()` set,
  // both here and in `endedAt`'s own server-side stamp. Confirmed
  // empirically: 849.9 s observed against the acceptance project's built
  // server. The lower bound stays tight (`advance(840)` is a floor — real
  // interaction time only ever ADDS elapsed time here, never removes it);
  // only the upper bound needs slack for that unavoidable UI latency.
  const elapsedSeconds = (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000
  expect(elapsedSeconds).toBeGreaterThanOrEqual(838)
  expect(elapsedSeconds).toBeLessThanOrEqual(842 + 30)

  expect(await demo.active()).toBeNull()

  await page.goto('/progress')
  const statusCell = page.getByTestId(`status-${sessionId}`)
  await expect(statusCell).toBeVisible()
  await expect(statusCell).toHaveText('Finalized')
  await expect(statusCell).not.toHaveText(/completed/i)
})

// ---------------------------------------------------------------------------
// 6. Practice: abandoning with one Pending event purges the outbox, never
//    saves a review, and Today reads the block not completed with neutral
//    copy.
// ---------------------------------------------------------------------------

test('practice: abandoning a running block with one Pending event leaves it abandoned, purges the outbox, and Today shows it not completed with neutral copy', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.load('working-day')

  // Blocks only the events batch endpoint — starting the session, ending it
  // and abandoning it all go through other routes and are unaffected.
  await page.route('**/sessions/*/events', (route) => route.abort())

  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify abandon purges a Pending event')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!

  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await expect(eventsGroup).toBeVisible()
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('1')

  // The record above went to the local outbox only — the events route is
  // aborted, so the server never saw it yet.
  await expect.poll(async () => outboxRowCount(page, sessionId)).toBeGreaterThan(0)
  const preAbandonSession = await demo.session(sessionId)
  expect(preAbandonSession.eventCount).toBe(0)

  await page.getByRole('button', { name: 'Abandon session', exact: true }).click()
  await expect(page.getByRole('alertdialog', { name: 'Abandon this session?' })).toBeVisible()
  await page.getByRole('button', { name: 'Abandon', exact: true }).click()
  await page.waitForURL('**/today')

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('abandoned')
  expect(session.review.finalizedAt).toBeNull()
  expect(session.review.outputQuality).toBeNull()

  const rowsAfterAbandon = await outboxRowCount(page, sessionId)
  expect(rowsAfterAbandon).toBe(0)

  const today = await demo.today(programId as string)
  const abandonedBlock = today.blocks.find((block) => block.sessionId === sessionId)
  expect(abandonedBlock?.status).not.toBe('completed')

  await expectNoPunitiveCopy(page)
})
