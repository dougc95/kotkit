/**
 * D5 — heartbeat-based clock-gap detection.
 *
 * `started_at` / `target_seconds` / `paused_seconds` on the server are the
 * only source of truth for elapsed/remaining time (7.2.1/7.2.3 derive the
 * display from those). This module's only job is to notice when the wall
 * clock (`Date.now()`) and the monotonic clock (`performance.now()`) stop
 * agreeing with each other — the signature of a laptop sleeping, a system
 * clock being changed, or a suspended tab — so a consumer can prompt the
 * user. It never posts to the server and never records anything itself:
 * 8.10 owns showing the prompt and posting `POST /sessions/{id}/clock-gap`.
 *
 * Drift is the only signal implemented here. A frozen tab (or a suspended
 * tab on a platform where `performance.now()` keeps advancing regardless)
 * produces no drift between the two clocks and therefore raises nothing
 * through this module — there is no separate "ticks stopped arriving"
 * signal. Document visibility is ignored entirely: the detector keeps
 * running, at the same cadence, whether the page is hidden or not.
 */

/** One detected clock gap. `gapSeconds` is negative when the clock was set back. */
export interface GapEvent {
  gapSeconds: number
  detectedAtMs: number
}

export interface GapDetectorOptions {
  /** Heartbeat cadence in ms. Defaults to the 5-second heartbeat from D5. */
  intervalMs?: number
  /** Drift magnitude, in seconds, that counts as a gap. Defaults to 60 (D5). */
  thresholdSeconds?: number
  /** Wall-clock source. Defaults to `Date.now`. */
  now?: () => number
  /** Monotonic-clock source. Defaults to `performance.now`. */
  mono?: () => number
  /** Called at most once per detected gap, synchronously from a tick. */
  onGap: (event: GapEvent) => void
}

export interface GapDetector {
  /** Establishes the baseline and starts the heartbeat. Idempotent while running. */
  start(): void
  /** Stops the heartbeat. No further ticks occur until `start()` is called again. */
  stop(): void
  /** Resets the baseline to the current now()/mono() readings without reporting a gap. */
  rebase(): void
}

export function createGapDetector(options: GapDetectorOptions): GapDetector {
  const {
    intervalMs = 5000,
    thresholdSeconds = 60,
    now = () => Date.now(),
    mono = () => performance.now(),
    onGap,
  } = options

  const thresholdMs = thresholdSeconds * 1000

  let wallAtBase = now()
  let monoAtBase = mono()
  let timer: ReturnType<typeof setInterval> | null = null

  function setBase(wallMs: number, monoMs: number): void {
    wallAtBase = wallMs
    monoAtBase = monoMs
  }

  function rebase(): void {
    setBase(now(), mono())
  }

  function tick(): void {
    const nowMs = now()
    const monoMs = mono()
    const drift = nowMs - wallAtBase - (monoMs - monoAtBase)

    if (Math.abs(drift) > thresholdMs) {
      const gapSeconds = Math.round(drift / 1000)
      // Rebase immediately so the same gap is never reported twice, even if
      // onGap() below triggers synchronous re-entrancy.
      setBase(nowMs, monoMs)
      onGap({ gapSeconds, detectedAtMs: now() })
    }
  }

  function start(): void {
    if (timer !== null) return
    rebase()
    timer = setInterval(tick, intervalMs)
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, stop, rebase }
}
