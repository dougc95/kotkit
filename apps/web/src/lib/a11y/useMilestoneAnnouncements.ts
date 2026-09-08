import { useEffect, useRef } from 'react'
import { useAnnouncer } from '../../ui/LiveRegion.js'

export interface UseMilestoneAnnouncementsInput {
  /** Current remaining time, in seconds. Ticks down; never announced itself. */
  remainingSeconds: number
  /**
   * Sourced by callers from `me.preferences.milestoneAnnouncements`
   * (defaults to false, D22). Left `false` here too so an omitted prop is
   * the same as the preference's own default.
   */
  enabled?: boolean
  /** Milestones (seconds remaining) to announce a downward crossing of. */
  milestonesSeconds: number[]
}

function describeMilestone(seconds: number): string {
  if (seconds <= 0) {
    return 'Time is up'
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`
  }
  return `${seconds} seconds remaining`
}

/**
 * Announces only when `enabled` is true AND `remainingSeconds` crosses
 * downward through a listed milestone — never on ordinary ticks (app-shell
 * spec, "Screen reader during a timer"). Generic over any `milestonesSeconds`
 * list; production callers (8.4/8.5) pass `[300, 0]` per D39.
 *
 * The crossing check compares only the last-seen value to the current one,
 * so it is correct even if intermediate ticks never render (e.g. several
 * state updates batched into one commit) — a milestone between the two is
 * still detected exactly once.
 */
export function useMilestoneAnnouncements({
  remainingSeconds,
  enabled = false,
  milestonesSeconds,
}: UseMilestoneAnnouncementsInput): void {
  const { announce } = useAnnouncer()
  const previousRef = useRef(remainingSeconds)

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = remainingSeconds

    if (!enabled) {
      return
    }

    for (const milestone of milestonesSeconds) {
      if (previous > milestone && remainingSeconds <= milestone) {
        announce(describeMilestone(milestone))
      }
    }
  }, [remainingSeconds, enabled, milestonesSeconds, announce])
}
