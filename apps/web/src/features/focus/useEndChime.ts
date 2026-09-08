import { useEffect, useRef } from 'react'

/**
 * Plays one short WebAudio tone. Best-effort: any failure (WebAudio
 * unsupported, an autoplay-policy rejection, a closed/suspended context) is
 * swallowed — the chime is a courtesy, never load-bearing for the timer
 * itself.
 */
function playTone(): void {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
    return
  }
  try {
    const ctx = new window.AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = 880
    gain.gain.value = 0.15
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.25)
    oscillator.addEventListener('ended', () => {
      void ctx.close()
    })
  } catch {
    // WebAudio unavailable or blocked — nothing to recover, nothing to report.
  }
}

/**
 * Plays one short tone the instant `remainingSeconds` reaches (or has
 * already reached) 0, exactly once per mount. Fires regardless of the
 * timer's hidden/shown state — this hook is called unconditionally from
 * `TimerDisplay`'s render, not gated behind its hidden branch, so hiding the
 * digits never silences the chime.
 */
export function useEndChime(remainingSeconds: number, enabled: boolean): void {
  const firedRef = useRef(false)

  useEffect(() => {
    if (!enabled || firedRef.current || remainingSeconds > 0) {
      return
    }
    firedRef.current = true
    playTone()
  }, [remainingSeconds, enabled])
}
