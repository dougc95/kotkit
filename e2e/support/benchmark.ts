/**
 * `runBenchmark` — task 9.1.4's own reusable SUPPORT helper (design.md D5,
 * D9, D10, D24-D27, D31; specs/benchmark-assessment throughout). Drives one
 * full benchmark attempt through the REAL screens, Ready through Finalize,
 * exactly the sequence a person would click: Start -> the given interruption
 * events (each reached via `advance`, D5's own "time passes normally"
 * mover) -> the fixed 1200 s deadline -> "Close your reading material" ->
 * "I'm ready for recall" -> the Recall confirm screen -> the five Point
 * inputs -> "Save recall" -> the Scoring screen's per-point Accurate/Not
 * accurate radios -> an optional S override -> the observed-conditions
 * confirmation -> the disruption attestation -> Finalize. Resolves to the
 * finalized session's id once `EligibilitySummary` (the real, server-written
 * result — never a client re-derivation, D4) is on screen.
 *
 * Reused, per this task's own brief, by 9.1.9 (timing-deviation.spec.ts —
 * its own `demo.load('timing-deviation')` leaves an already-running
 * benchmark whose recall/scoring/disruption/finalize steps this same
 * function drives once the interval itself ends) and 9.2.3
 * (never-completed.spec.ts).
 *
 * Callers' own responsibility (this function never does either):
 *  - `installClock(page)` BEFORE this is ever called — this function's very
 *    first action is `page.goto`, and Playwright's fake clock must be
 *    installed before the first navigation (`clock.ts`'s own documented
 *    contract; calling `install()` a second time on the same page throws).
 *  - an existing, startable program whose `options.slotId` names a real
 *    benchmark slot not yet full (`demo.readyProgram()`, or an equivalent
 *    scenario/API setup).
 *
 * Deliberately narrow: only S (`episodeCountOverride`) can be overridden
 * beyond what the recorded events themselves prefill — E, M and the
 * first-switch estimate field are left exactly as `CountFields.tsx`'s own
 * prefill produces them, matching that component's "fully controlled, one
 * slice per concern" shape rather than this helper growing a parameter per
 * field it does not itself need to control for 9.1.4/9.1.9/9.2.3's own
 * journeys.
 */
import { expect, test, type Page } from '@playwright/test'

import { advance } from './clock.js'
import type { DemoClient } from './demo.js'

/** A benchmark's fixed interval (D30: the server always stores 1200 s for a benchmark; never a client-chosen value). */
const BENCHMARK_TARGET_SECONDS = 1200

export interface RunBenchmarkEvent {
  /** Seconds elapsed since Start, matching `advance`'s own unit. */
  readonly atSeconds: number
  readonly type: 'off_task' | 'external'
}

export interface RunBenchmarkOptions {
  /** `SlotResponseValue.id` (`demo.readyProgram()`'s own `slots[]`, or an equivalent `GET /programs/current` read) — the slot this attempt is started against. */
  readonly slotId: string
  /** Interruption events, each reached via `advance` before its matching Record button is clicked. May be empty (no events recorded at all). */
  readonly events: readonly RunBenchmarkEvent[]
  /** When given, clicks Undo once the fake clock reaches this many elapsed seconds — sorted AFTER any `events` entries at the same `atSeconds` (so "record twice, then undo" both land at the same instant). */
  readonly undoAt?: number
  /** Seconds between the `end` transition (D24: set the instant "I'm ready for recall" is clicked, never the deadline instant itself) and "Start recall" — this IS `review.recallDelaySeconds` (D7.3). */
  readonly recallDelaySeconds: number
  /** The five recall points, in order. Blank entries are valid (D31: a blank point is scored 0, never excluded). */
  readonly recallPoints: readonly [string, string, string, string, string]
  /** Seconds between "Start recall" and "Save recall" — this IS `review.recallDurationSeconds` (D7.3: >210 s flags `recall_overrun`, never excludes). */
  readonly recallDurationSeconds: number
  /** One entry per NON-BLANK `recallPoints` entry, in point order — `true` clicks that point's "Accurate" radio, `false` clicks "Not accurate". Blank points render no radio at all (Scoring.tsx) and need no entry here. */
  readonly accurate: readonly boolean[]
  /** When given, unlocks S (clicking "Replace with a paper tally" first if it arrived event-locked) and types this value — `countMethod` then reads `retrospective` on the wire (`CountFields.tsx`'s own rule). Omit to leave S exactly as the recorded events prefilled it (or blank, if none did). */
  readonly episodeCountOverride?: number
  /** The required materially-disrupted self-attestation (D7.2). */
  readonly disruption: 'no' | 'yes'
}

/** Merges `events` and an optional `undoAt` into one time-ordered action list — `undoAt` sorts after any event at the same `atSeconds` (Array.prototype.sort's guaranteed stability, ES2019+, keeps "record twice, then undo" in that literal order). */
interface RecordAction {
  readonly atSeconds: number
  readonly kind: 'record'
  readonly type: 'off_task' | 'external'
}
interface UndoAction {
  readonly atSeconds: number
  readonly kind: 'undo'
}
type BenchmarkAction = RecordAction | UndoAction

function buildActionTimeline(options: RunBenchmarkOptions): readonly BenchmarkAction[] {
  const actions: BenchmarkAction[] = options.events.map((event) => ({
    atSeconds: event.atSeconds,
    kind: 'record',
    type: event.type,
  }))
  if (options.undoAt !== undefined) {
    actions.push({ atSeconds: options.undoAt, kind: 'undo' })
  }
  return [...actions].sort((a, b) => a.atSeconds - b.atSeconds)
}

const RECORD_BUTTON_LABEL: Record<RunBenchmarkEvent['type'], string> = {
  off_task: 'Record off-task episode',
  external: 'External interruption',
}

/**
 * Drives one benchmark attempt end to end (see this file's own header
 * comment for the full sequence) and returns its session id.
 */
export async function runBenchmark(page: Page, demo: DemoClient, options: RunBenchmarkOptions): Promise<string> {
  // A full Start-to-Finalize benchmark attempt is real interaction time,
  // not a hang: readyProgram + Start + several advance() round trips
  // (each running the fake clock through hundreds of the 1 s UI-tick/5 s
  // heartbeat callbacks, then a real POST /demo/clock) + the recall/scoring/
  // conditions/disruption/finalize flow comfortably exceeds the default 30 s
  // per-test budget (confirmed empirically: the "reach the deadline" step
  // alone was still mid-render when the outer test timeout, not this
  // function's own assertions, cut the test off). Matches the same fix
  // already applied to a similarly-shaped two-attempt benchmark flow
  // (e2e/benchmark-review.spec.ts, task 8.4.6).
  test.setTimeout(90_000)

  await page.goto(`/benchmark/${options.slotId}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await expect(eventsGroup).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('runBenchmark: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  // --- Interruption events (+ an optional Undo), advancing to each in turn ---
  let elapsedSoFar = 0
  for (const action of buildActionTimeline(options)) {
    if (action.atSeconds > elapsedSoFar) {
      await advance(page, demo, action.atSeconds - elapsedSoFar)
      elapsedSoFar = action.atSeconds
    }
    if (action.kind === 'record') {
      await eventsGroup.getByRole('button', { name: RECORD_BUTTON_LABEL[action.type], exact: true }).click()
    } else {
      await eventsGroup.getByRole('button', { name: 'Undo', exact: true }).click()
    }
  }

  // --- Reach the deadline ---
  if (BENCHMARK_TARGET_SECONDS > elapsedSoFar) {
    await advance(page, demo, BENCHMARK_TARGET_SECONDS - elapsedSoFar)
  }
  // NOT `getByRole('status', { name: ... })`: `role="status"` is a live-region
  // (landmark-like) role whose ACCESSIBLE NAME comes from aria-label/
  // aria-labelledby, not automatically from its own text content the way an
  // interactive role (button, link) does — `<p role="status">Close your
  // reading material</p>` has no aria-label, so its accessible name is
  // empty and a role+name query finds nothing even though the element is
  // real, visible, and its role attribute is genuinely "status" (confirmed
  // empirically). Matching by text is both correct and simpler here.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  // --- Recall: confirm -> delay -> Start recall -> five points -> duration -> Save ---
  await expect(page.getByRole('button', { name: 'Start recall', exact: true })).toBeVisible()
  if (options.recallDelaySeconds > 0) {
    await advance(page, demo, options.recallDelaySeconds)
  }
  await page.getByRole('button', { name: 'Start recall', exact: true }).click()

  await expect(page.getByLabel('Point 1')).toBeVisible()
  for (const [index, value] of options.recallPoints.entries()) {
    await page.getByLabel(`Point ${index + 1}`).fill(value)
  }

  if (options.recallDurationSeconds > 0) {
    await advance(page, demo, options.recallDurationSeconds)
  }
  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  // --- Scoring: one Accurate/Not-accurate radio per non-blank point, in order ---
  await expect(page.getByText(/Recall score \(self-reported, preview\)/)).toBeVisible()
  const accurateQueue = [...options.accurate]
  for (const [index, value] of options.recallPoints.entries()) {
    if (value.trim().length === 0) {
      continue
    }
    const isAccurate = accurateQueue.shift()
    if (isAccurate === undefined) {
      throw new Error(
        `runBenchmark: options.accurate has fewer entries than non-blank recallPoints (point ${index + 1} has none left)`,
      )
    }
    const pointGroup = page.getByRole('group', { name: `Point ${index + 1} score` })
    await pointGroup.getByRole('radio', { name: isAccurate ? 'Accurate' : 'Not accurate', exact: true }).click()
  }

  // --- Optional S override (unlock first when it arrived event-locked) ---
  if (options.episodeCountOverride !== undefined) {
    const episodeField = page.getByLabel('Off-task episodes (S)')
    if (await episodeField.isDisabled()) {
      await page.getByRole('button', { name: 'Replace with a paper tally', exact: true }).click()
    }
    await page.getByLabel('Off-task episodes (S)').fill(String(options.episodeCountOverride))
  }

  // --- Observed conditions confirmed as-is ---
  await page.getByRole('checkbox', { name: 'These conditions are correct' }).check()

  // --- Disruption attestation ---
  await page
    .getByRole('radio', { name: options.disruption === 'yes' ? 'Yes' : 'No', exact: true })
    .click()

  // --- Finalize ---
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()

  return sessionId
}
