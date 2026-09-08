/**
 * Task 9.1.1 — the acceptance harness itself, proven against D37's
 * single-origin build-and-serve topology (`playwright.config.ts`'s
 * `acceptance` project) rather than against the dev-server pair every
 * earlier e2e spec used. Four cases, one per surface this harness adds:
 *
 *  - `demo.reset()` actually clears server-side state (not just returns
 *    204).
 *  - every `DEMO_SCENARIO_NAMES` slug (packages/shared's PRD §6 registry)
 *    loads without error.
 *  - `readyProgram()` (7.1.5) reaches a real, checkable `baseline_ready`
 *    state through this project's own origin.
 *  - `completePracticeBlock()` (this task's own addition to `demo.ts`)
 *    produces a qualifying block, and `setDay()` (also this task's own
 *    addition) reaches Day 14.
 */
import { DEMO_SCENARIO_NAMES } from '@attention-lab/shared'
import { expect, test } from '../support/demo.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('reset clears every prior program', async ({ demo }) => {
  await demo.readyProgram()
  const before = await demo.current()
  expect(before.program).not.toBeNull()

  await demo.reset()

  const after = await demo.current()
  expect(after.program).toBeNull()
})

test('every DEMO_SCENARIO_NAMES slug loads without error', async ({ demo }) => {
  for (const name of DEMO_SCENARIO_NAMES) {
    // `demo.load()` itself throws on a non-2xx response (readJson) — simply
    // resolving proves the load succeeded. `programId` is legitimately
    // `null` for 'new-user' (no program exists yet by definition), so this
    // only checks the field's TYPE, never requires it truthy.
    const result = await demo.load(name)
    expect(typeof result.programId === 'string' || result.programId === null).toBe(true)
    await demo.reset()
  }
})

test('readyProgram() reaches baseline_ready with Start available on the real screen', async ({ page, demo }) => {
  await demo.readyProgram()

  const current = await demo.current()
  expect(current.program?.status).toBe('baseline_ready')

  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Start with your baseline' })).toBeVisible()
})

test('completePracticeBlock() produces a qualifying block, and setDay() reaches Day 14', async ({ demo }) => {
  const { programId, revision } = await demo.readyProgram()

  const { sessionId } = await demo.completePracticeBlock(programId, revision.settings.practiceTargetSeconds)
  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('finalized')
  expect(session.completeInterval).toBe(true)
  expect(session.review.outputQuality).toBe('yes')
  expect(session.review.episodeCount).toBe(0)

  await demo.setDay(14)
  const today = await demo.today(programId)
  expect(today.day).toBe(14)
})
