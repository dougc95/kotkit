/**
 * PITCH DEMO RECORDING — one continuous take of the real application, driven
 * through the built single-origin server (see `pitch.config.ts`). This is not
 * a test: it asserts only enough to fail loudly if a shot would have filmed
 * an empty or wrong screen, so a broken recording never reaches a pitch.
 *
 * Deliberate choices, each one a caution the scene map called out:
 *  - The browser's REAL clock runs throughout. `e2e/support/clock.ts`'s
 *    `installClock`/`advance` are never used here: they freeze time, and a
 *    frozen or jumping countdown reads as a glitch on camera. The demo clock
 *    (`POST /demo/clock`, via `demo.readyProgram()`) is only ever moved
 *    BETWEEN scenes, never while a timer is on screen.
 *  - Every scene begins with a fresh `page.goto()`. Scenario data is replaced
 *    over raw HTTP, which cannot refresh an already-mounted screen, so an
 *    in-app link click would film the previous scenario's cached data.
 *  - The synthetic-data banner stays in frame on every scene. It is the most
 *    load-bearing thing in the whole recording.
 *  - Captions are injected as an overlay bar. They narrate; they never cover
 *    or restate a number the application itself rendered.
 */
import { expect, test } from '../support/demo.js'
import type { Page } from '@playwright/test'

const VISIBLE = { timeout: 15_000 }

/**
 * Beat lengths, in milliseconds — how long a shot holds. Paced for a speaker
 * talking over a silent recording, not for a viewer skimming alone: each hold
 * has to outlast the sentence being said across it, so the presenter is never
 * racing the picture.
 */
const BEAT = { short: 2_200, read: 5_000, long: 7_500 } as const

/**
 * Installs (once per navigation) a caption bar pinned to the bottom of the
 * viewport and sets its text. Re-called after every `goto`, since the element
 * lives in the page and does not survive a navigation.
 */
async function caption(page: Page, scene: number, title: string, line: string): Promise<void> {
  await page.evaluate(
    ({ scene: sceneNumber, title: sceneTitle, line: sceneLine }) => {
      const ID = 'pitch-caption'
      let bar = document.getElementById(ID)
      if (bar === null) {
        bar = document.createElement('div')
        bar.id = ID
        bar.setAttribute('aria-hidden', 'true')
        bar.style.cssText = [
          'position:fixed',
          'left:0',
          'right:0',
          'bottom:0',
          'z-index:2147483647',
          'padding:14px 22px',
          'background:rgba(15,17,21,0.93)',
          'color:#f5f6f8',
          'font:15px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif',
          'display:flex',
          'gap:16px',
          'align-items:baseline',
          'pointer-events:none',
        ].join(';')
        document.body.appendChild(bar)
      }
      bar.innerHTML = ''
      const badge = document.createElement('span')
      badge.textContent = `${sceneNumber}/8`
      badge.style.cssText = 'font-variant-numeric:tabular-nums;opacity:0.55;letter-spacing:0.04em'
      const heading = document.createElement('span')
      heading.textContent = sceneTitle
      heading.style.cssText = 'font-weight:600;white-space:nowrap'
      const body = document.createElement('span')
      body.textContent = sceneLine
      body.style.cssText = 'opacity:0.85'
      bar.append(badge, heading, body)
    },
    { scene, title, line },
  )
}

/** A held shot. Real elapsed time, so the recording keeps a readable pace. */
async function hold(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms)
}

/**
 * The countdown seeds its shown/hidden state from account preferences, so a
 * prior run could leave it hidden and there would be no digits to film.
 */
async function ensureTimerVisible(page: Page): Promise<void> {
  const show = page.getByRole('button', { name: 'Show timer' })
  if ((await show.count()) > 0) {
    await show.click()
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible(VISIBLE)
}

test('Attention Lab pitch walkthrough', async ({ page, demo }) => {
  // ---------------------------------------------------------------- Scene 1
  await demo.reset()
  await demo.load('working-day')
  await page.goto('/today')
  await caption(page, 1, 'A working day', 'One next action, and nothing reported is ever shown as zero.')

  await expect(page.getByRole('heading', { name: 'Day 4 of 14' })).toBeVisible(VISIBLE)
  await expect(page.getByText('This is synthetic demonstration data — not a real measurement.')).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)

  const checkin = page.locator('[aria-label="Check-in"]')
  await expect(checkin.getByText(/Still needed:/)).toBeVisible(VISIBLE)
  await checkin.scrollIntoViewIfNeeded()
  await hold(page, BEAT.read)

  // ---------------------------------------------------------------- Scene 2
  await caption(page, 2, 'Starting a block', 'One sentence of intent, then a real timer against a real server.')
  const nextAction = page.getByRole('button', { name: 'Block 2 is next' })
  await expect(nextAction).toBeVisible(VISIBLE)
  await nextAction.click()

  const blockTwo = page.locator('[data-block-index="2"]')
  await blockTwo.getByLabel('What will you produce?').fill('Draft the Q3 planning notes')
  await hold(page, BEAT.short)
  await blockTwo.getByRole('button', { name: 'Start' }).click()

  await page.waitForURL(/\/focus\//, { timeout: 20_000 })
  await caption(page, 2, 'Starting a block', 'The countdown is server time, not a number the tab invented.')
  await expect(page.getByRole('heading', { name: 'Practice block' })).toBeVisible(VISIBLE)
  await ensureTimerVisible(page)
  await hold(page, BEAT.long)

  await caption(page, 2, 'Recording honestly', 'An interruption is one button. It is counted, never punished.')
  await page
    .getByRole('group', { name: 'Session events' })
    .getByRole('button', { name: 'Record off-task episode', exact: true })
    .click()
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('1', VISIBLE)
  await hold(page, BEAT.read)

  await page.getByRole('button', { name: 'Finish early' }).click()
  const confirmFinish = page.getByRole('alertdialog')
  await expect(confirmFinish).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)
  await confirmFinish.getByRole('button', { name: 'Finish now' }).click()

  // ---------------------------------------------------------------- Scene 3
  await page.waitForURL(/\/review\//, { timeout: 20_000 })
  await caption(page, 3, 'The review', 'Prefilled from what was recorded, and it says so.')
  await expect(page.getByRole('heading', { name: 'Practice review' })).toBeVisible(VISIBLE)
  await expect(page.getByTestId('recorded-tallies')).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)

  await expect(page.getByText('prefilled from recorded events')).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)

  await caption(page, 3, 'The review', 'Yes, Partly and No. Partly is a real answer here.')
  await page.getByRole('radio', { name: 'Partly' }).check()
  await hold(page, BEAT.read)
  await page.getByRole('button', { name: 'Save review' }).click()
  await page.waitForURL(/\/today/, { timeout: 20_000 })
  await hold(page, BEAT.short)

  // ---------------------------------------------------------------- Scene 4
  await demo.reset()
  const ready = await demo.readyProgram()
  const baselineA = ready.slots.find((slot) => slot.phase === 'baseline' && slot.label === 'A')
  if (baselineA === undefined) throw new Error('pitch demo: the ready program has no baseline A slot to film')

  await page.goto(`/benchmark/${baselineA.id}`)
  await caption(page, 4, 'The measurement', 'A fixed 20 minutes, kept separate from everyday practice.')
  await expect(page.getByRole('heading', { name: /Fixed 20-minute assessment/ })).toBeVisible(VISIBLE)
  await expect(page.getByText('Leaving this page to read does not count as distraction.')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await caption(page, 4, 'The measurement', 'Same protocol every time, so two attempts can be compared.')
  await ensureTimerVisible(page)
  await hold(page, BEAT.long)

  await page
    .getByRole('group', { name: 'Session events' })
    .getByRole('button', { name: 'Record off-task episode', exact: true })
    .click()
  await hold(page, BEAT.short)

  await caption(page, 4, 'Stopping early', 'Cut it short and the attempt is labelled incomplete, not counted as done.')
  await page.getByRole('button', { name: 'Stop early' }).click()
  await expect(page.getByText('This attempt will be recorded as incomplete.')).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)
  await page.getByRole('group', { name: 'Confirm stop early' }).getByRole('button', { name: 'Stop early' }).click()

  await page.waitForURL(/\/recall/, { timeout: 20_000 })
  await caption(page, 4, 'Stopping early', 'Timer expiry never proves the work happened.')
  await expect(page.getByText('Incomplete attempt')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  // ---------------------------------------------------------------- Scene 5
  await demo.reset()
  await demo.load('comparable-change')
  await page.goto('/progress')
  await caption(page, 5, 'A comparison', 'Exact counts, the absolute change first, and no claim of cause.')
  await expect(page.getByTestId('result-state-headline')).toBeVisible(VISIBLE)
  await expect(page.getByTestId('s0-s14-figure')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  await page.getByTestId('cause-note').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('cause-note')).toBeVisible(VISIBLE)
  await hold(page, BEAT.read)

  await caption(page, 5, 'A comparison', 'Even the raw export labels itself synthetic.')
  const csv = page.getByRole('radio', { name: 'CSV' })
  await csv.scrollIntoViewIfNeeded()
  await csv.check()
  await expect(page.getByTestId('export-label-line')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  // ---------------------------------------------------------------- Scene 6
  await demo.reset()
  await demo.load('mixed-result')
  await page.goto('/progress')
  await caption(page, 6, 'When signals disagree', 'The same switch numbers as the last screen. Watch the verdict.')
  await expect(page.getByTestId('s0-s14-figure')).toBeVisible(VISIBLE)
  await expect(page.getByTestId('percentage-figure')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  await caption(page, 6, 'When signals disagree', 'Recall fell, so there is no headline at all.')
  await expect(page.getByTestId('result-state-headline')).toHaveCount(0)
  await expect(page.getByTestId('result-state-message')).toBeVisible(VISIBLE)
  await expect(page.getByTestId('recall-means-figure')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  // ---------------------------------------------------------------- Scene 7
  await demo.reset()
  await demo.load('missing-final')
  await page.goto('/progress')
  await caption(page, 7, 'Missing data', 'One short attempt, and the comparison is withheld entirely.')
  await expect(page.getByTestId('result-state-message')).toBeVisible(VISIBLE)
  await expect(page.getByTestId('comparison-figures')).toHaveCount(0)
  await hold(page, BEAT.long)

  await caption(page, 7, 'Missing data', 'A count nobody reported reads "Not reported". Never zero.')
  // The attempt table's cell testids are built from live session ids
  // (`s-${attempt.attemptId}` in AttemptTable.tsx), so the row is found by
  // what a viewer actually sees rather than by an id no fixture can pin.
  const attempts = page.getByRole('table', { name: 'Benchmark attempts' })
  await expect(attempts).toBeVisible(VISIBLE)
  await attempts.scrollIntoViewIfNeeded()
  await expect(attempts.getByText('Not reported').first()).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  // ---------------------------------------------------------------- Scene 8
  await demo.reset()
  await demo.load('zero-baseline')
  await page.goto('/progress')
  await caption(page, 8, 'The arithmetic trap', 'Zero to zero is not a 100 percent win. It says so.')
  await expect(page.getByTestId('s0-s14-figure')).toBeVisible(VISIBLE)
  await expect(page.getByTestId('percentage-figure')).toBeVisible(VISIBLE)
  await hold(page, BEAT.long)

  await caption(page, 8, 'Attention Lab', 'An instrument for one person, honest about what it does not know.')
  await hold(page, BEAT.long)
})
