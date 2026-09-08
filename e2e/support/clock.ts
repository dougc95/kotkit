/**
 * Clock and tab-visibility helpers (design.md D16, D8, D26; task 7.1.5's
 * own brief). Every function below takes an explicit `page` (and, for the
 * two clock movers, an explicit `demo` — the `demo.ts` fixture value, never
 * a fresh `APIRequestContext` of its own) rather than being fixtures itself:
 * only `demo.ts` extends `test`, per D16 ("one owner per shared piece").
 *
 * Two ways to move time, matching two real situations a session can survive:
 *  - `advance` runs Playwright's installed fake timers forward AND moves the
 *    server's demo clock forward by the same amount, in lockstep — "time
 *    passed normally while the tab stayed open" (a countdown ticking down,
 *    a heartbeat firing on schedule).
 *  - `sleep` jumps the wall clock forward WITHOUT running any queued timers
 *    (the way a laptop's clock jumps after waking from sleep, or a phone's
 *    clock jumps across a background app switch), then runs 5 s of the fake
 *    clock so the 5-second heartbeat (7.2.2 — design.md D5) is the thing
 *    that actually observes the gap, exactly like a real client would.
 *
 * `setClock`'s ABSOLUTE-offset contract (D35) is why both movers read
 * `demo.offset()` first and add to it, rather than ever calling
 * `demo.setClock(seconds)` directly with a bare delta.
 */
import type { Page } from '@playwright/test'
import type { DemoClient } from './demo.js'

/**
 * Installs Playwright's fake clock. Call this BEFORE the test's first
 * `page.goto(...)` — installing after a page has already loaded leaves that
 * page's already-running timers on the real clock (Playwright's own
 * documented behavior for `page.clock.install()`).
 */
export async function installClock(page: Page): Promise<void> {
  await page.clock.install()
}

/**
 * Time passes normally, `seconds` of it, for both the page (its fake timers
 * actually fire, in order) and the server (the demo clock moves the same
 * amount). Use this for "the countdown ran down", "the 5 s heartbeat fired
 * N times", and similar.
 */
export async function advance(page: Page, demo: DemoClient, seconds: number): Promise<void> {
  await page.clock.runFor(seconds * 1000)
  const currentOffset = await demo.offset()
  await demo.setClock(currentOffset + seconds)
}

/**
 * The wall clock jumps forward by `seconds` with no timers run yet (a real
 * clock gap: the tab was asleep/backgrounded, not ticking), then 5 s of the
 * fake clock DOES run so the 5-second heartbeat (design.md D5) is the first
 * thing to notice the drift — the same detection path a real background/
 * foreground cycle exercises, per design.md's clock-gap flow.
 */
export async function sleep(page: Page, demo: DemoClient, seconds: number): Promise<void> {
  await page.clock.setSystemTime(Date.now() + seconds * 1000)
  const currentOffset = await demo.offset()
  await demo.setClock(currentOffset + seconds)
  await page.clock.runFor(5000)
}

// ---------------------------------------------------------------------------
// Tab visibility (app-shell: "App visibility is not attention" — CLAUDE.md's
// own invariant — a hidden tab must never create an off-task episode on its
// own; hideTab/showTab exist so a spec can prove that).
// ---------------------------------------------------------------------------

/**
 * Runs inside the page. Redefines `document.hidden`/`document.visibilityState`
 * as overridable getters (once; a second call is a no-op for the
 * redefinition, since the getters read a module-level flag rather than
 * being redefined again) and dispatches `visibilitychange` so listeners
 * observe the change exactly as they would for a real tab switch. Declared
 * as a standalone function (no closed-over variables) so both
 * `page.addInitScript` and `page.evaluate` can serialize and run it as-is.
 */
function applyTabHidden(hidden: boolean): void {
  const globalState = window as typeof window & { __attentionLabHidden?: boolean }
  if (globalState.__attentionLabHidden === undefined) {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => globalState.__attentionLabHidden === true,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (globalState.__attentionLabHidden === true ? 'hidden' : 'visible'),
    })
  }
  globalState.__attentionLabHidden = hidden
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * Installs the override for every future navigation/reload on this page
 * (`addInitScript`) AND applies it to whatever document is loaded right
 * now (`evaluate`), so this works whether it is called before or after
 * `page.goto(...)`.
 */
async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
  await page.addInitScript(applyTabHidden, hidden)
  await page.evaluate(applyTabHidden, hidden)
}

/** The tab becomes hidden (`document.hidden === true`, `visibilityState === 'hidden'`) and fires `visibilitychange`. */
export async function hideTab(page: Page): Promise<void> {
  await setTabHidden(page, true)
}

/** The tab becomes visible again and fires `visibilitychange`. */
export async function showTab(page: Page): Promise<void> {
  await setTabHidden(page, false)
}
