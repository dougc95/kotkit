import { useEffect, useState } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveRegion } from '../../ui/LiveRegion.js'
import { useMilestoneAnnouncements, type UseMilestoneAnnouncementsInput } from './useMilestoneAnnouncements.js'

/**
 * Ticks `remainingSeconds` down by one every second (a real `setInterval`,
 * driven by fake timers) and feeds it into the hook under test — the
 * "rerender per second" the brief asks for.
 */
function TickingHarness({
  start,
  ...milestoneProps
}: { start: number } & Omit<UseMilestoneAnnouncementsInput, 'remainingSeconds'>) {
  const [remainingSeconds, setRemainingSeconds] = useState(start)

  useEffect(() => {
    const id = setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useMilestoneAnnouncements({ remainingSeconds, ...milestoneProps })

  return null
}

/**
 * Counts DOM mutations to `region` made while `run` executes. Uses
 * `takeRecords()` (synchronous) rather than the observer's async callback:
 * the callback is delivered as a microtask, which fake timers plus a
 * synchronous `act()` do not reliably flush before a following
 * `disconnect()` would otherwise silently drop the queued records.
 */
function countLiveRegionMutations(region: Element, run: () => void): number {
  const observer = new MutationObserver(() => {})
  observer.observe(region, { childList: true, characterData: true, subtree: true })
  run()
  const records = observer.takeRecords()
  observer.disconnect()
  return records.length
}

describe('useMilestoneAnnouncements', () => {
  it('with announcements disabled (the default, matching preferences.milestoneAnnouncements=false per D22), remaining 120 -> 0 over fake-timer seconds leaves the live region text unchanged (zero updates)', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <LiveRegion>
          <TickingHarness start={120} milestonesSeconds={[300, 0]} />
        </LiveRegion>,
      )
      const region = container.querySelector('[aria-live="polite"]')
      if (!region) throw new Error('live region not rendered')

      const mutationCount = countLiveRegionMutations(region, () => {
        act(() => {
          vi.advanceTimersByTime(120_000)
        })
      })

      expect(mutationCount).toBe(0)
      expect(region.textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('with enabled and milestones [60], exactly one live-region update occurs, at 60 s', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <LiveRegion>
          <TickingHarness start={120} enabled milestonesSeconds={[60]} />
        </LiveRegion>,
      )
      const region = container.querySelector('[aria-live="polite"]')
      if (!region) throw new Error('live region not rendered')

      const mutationCount = countLiveRegionMutations(region, () => {
        act(() => {
          vi.advanceTimersByTime(120_000)
        })
      })

      expect(mutationCount).toBe(1)
      expect(region.textContent).toBe('1 minute remaining')
    } finally {
      vi.useRealTimers()
    }
  })
})
