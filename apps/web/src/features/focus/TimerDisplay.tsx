import { useState } from 'react'

import { useMeContext } from '../../app/AppBootstrap.js'
import { useMilestoneAnnouncements } from '../../lib/a11y/useMilestoneAnnouncements.js'
import { usePrefersReducedMotion } from '../../lib/a11y/usePrefersReducedMotion.js'
import { formatRemaining } from '../../lib/clock/remaining.js'
import { Button } from '../../ui/Button.js'
import { useEndChime } from './useEndChime.js'

/** 5:00 and 0:00 only (D39) — never a per-second announcement. */
const MILESTONES_SECONDS = [300, 0]

export interface TimerDisplayProps {
  /** Always supplied by `lib/clock` (via `useRemaining(session)`, D5) — this component never accumulates ticks itself. */
  remainingSeconds: number
  /**
   * Optional controlled override. When omitted, the component manages its
   * own hidden state, seeded once from `preferences.hideTimerDefault`
   * (GET /me) — the brief's "initial state comes from" behavior. When
   * supplied, the caller owns the value and `onToggleHidden` is the only
   * way the toggle takes effect.
   */
  hidden?: boolean
  onToggleHidden?: (hidden: boolean) => void
  /**
   * 'signal' marks a countdown that IS the live measurement itself (the
   * fixed 20-minute benchmark) — the petrol distinguishes a benchmark from
   * a variable-length practice block (the rework spec §8, "Benchmark: ready and
   * running"). Every caller in this codebase today (Focus's practice block,
   * Recall's fixed recall window) keeps the default 'ink'; a benchmark
   * Running screen is the one place a later change opts into 'signal'.
   */
  tone?: 'ink' | 'signal'
}

/**
 * Shared timer used by Benchmark Running (8.3.3), Focus (8.5.3) and Recall
 * (8.4.1). Renders `mm:ss` in a plain (non `aria-live`) element — the app's
 * one live region (`ui/LiveRegion.tsx`) is reserved for the 5:00/0:00
 * milestone announcements below, never the ticking digits themselves
 * (app-shell: "Screen reader during a timer"). `preferences.endChime` and
 * `preferences.milestoneAnnouncements` come from `GET /me` via
 * `useMeContext()` (7.1.2) rather than a caller-passed flag, per D22/D39.
 */
export function TimerDisplay({ remainingSeconds, hidden: hiddenProp, onToggleHidden, tone = 'ink' }: TimerDisplayProps) {
  const { preferences } = useMeContext()
  const [internalHidden, setInternalHidden] = useState(() => preferences.hideTimerDefault)
  const hidden = hiddenProp ?? internalHidden
  const prefersReducedMotion = usePrefersReducedMotion()

  // Called unconditionally (not skipped while hidden) so the chime still
  // fires "also while hidden" per the brief.
  useEndChime(remainingSeconds, preferences.endChime)
  useMilestoneAnnouncements({
    remainingSeconds,
    enabled: preferences.milestoneAnnouncements,
    milestonesSeconds: MILESTONES_SECONDS,
  })

  function handleToggle(): void {
    const next = !hidden
    onToggleHidden?.(next)
    if (hiddenProp === undefined) {
      setInternalHidden(next)
    }
  }

  const transitionClass = prefersReducedMotion ? '' : 'transition-opacity duration-200'
  const toneClass = tone === 'signal' ? 'text-signal' : 'text-ink'
  const textClass = ['text-[56px] font-mono tabular-nums leading-none tracking-tight', toneClass, transitionClass]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col items-center gap-3">
      {hidden ? (
        <p className={textClass} data-testid="timer-hidden-text">
          Timer hidden
        </p>
      ) : (
        <p className={textClass} data-testid="timer-digits">
          {formatRemaining(remainingSeconds)}
        </p>
      )}
      <Button variant="quiet" onClick={handleToggle}>
        {hidden ? 'Show timer' : 'Hide timer'}
      </Button>
    </div>
  )
}
