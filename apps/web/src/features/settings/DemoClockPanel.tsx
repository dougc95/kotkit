import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DemoClockBodyValue, MeResponseValue, ProgramResponseValue, SlotResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import { skipToDay14OffsetSeconds } from './demoClockMath.js'

/**
 * The demo-clock section of `DemoControls` (task 8.9.3; design.md D35).
 * `POST /demo/clock` always sends an ABSOLUTE offset from real time — never
 * a delta on top of whatever `me.demoClockOffsetSeconds` already is — so
 * every action below computes the full offset it wants, not an increment.
 *
 * Owns one `useMutation` for all three actions ("Advance", "Skip to Day
 * 14", "Reset clock"): design.md's brief keeps a single mutation per
 * endpoint per screen, and every one of them posts to the same
 * `POST /demo/clock` route. On success the whole query cache is cleared
 * (this task's own "State" note) so Today/Progress refetch under the new
 * clock — nothing here re-fetches `me` itself; the parent's own `['me']`
 * observer (Settings.tsx) picks up the new `demoClockOffsetSeconds` once
 * the cache clears.
 */
export interface DemoClockPanelProps {
  readonly me: MeResponseValue
  readonly program: ProgramResponseValue | null
  readonly slots: readonly SlotResponseValue[]
}

function formatOffsetSeconds(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '−' : '+'
  return `${sign}${Math.abs(offsetSeconds)}s`
}

export function DemoClockPanel({ me, program, slots }: DemoClockPanelProps) {
  const queryClient = useQueryClient()
  const [draftDateTime, setDraftDateTime] = useState('')
  const advanceInputId = useId()

  const clockMutation = useMutation({
    mutationFn: (body: DemoClockBodyValue) => api.demo.clock(body),
    onSuccess: () => {
      queryClient.clear()
    },
  })

  function handleAdvance() {
    if (draftDateTime === '') {
      return
    }
    const targetMs = new Date(draftDateTime).getTime()
    if (Number.isNaN(targetMs)) {
      return
    }
    clockMutation.mutate({ offsetSeconds: Math.round((targetMs - Date.now()) / 1000) })
  }

  function handleSkipToDay14() {
    if (program === null) {
      return
    }
    clockMutation.mutate({ offsetSeconds: skipToDay14OffsetSeconds(program, slots, new Date()) })
  }

  function handleResetClock() {
    clockMutation.mutate({ offsetSeconds: 0 })
  }

  function handleRetry() {
    clockMutation.mutate(clockMutation.variables ?? { offsetSeconds: 0 })
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Demo clock</h3>
      <p className="text-sm text-[var(--color-text-muted)]">
        Current offset: {formatOffsetSeconds(me.demoClockOffsetSeconds)}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={advanceInputId} className="text-sm font-medium text-[var(--color-text)]">
            Advance the clock to
          </label>
          <input
            id={advanceInputId}
            type="datetime-local"
            value={draftDateTime}
            disabled={clockMutation.isPending}
            onChange={(event) => setDraftDateTime(event.target.value)}
            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          />
        </div>
        <Button
          variant="secondary"
          disabled={draftDateTime === '' || clockMutation.isPending}
          onClick={handleAdvance}
        >
          Advance
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={program === null || clockMutation.isPending} onClick={handleSkipToDay14}>
          Skip to Day 14
        </Button>
        <Button variant="secondary" disabled={clockMutation.isPending} onClick={handleResetClock}>
          Reset clock
        </Button>
      </div>

      {clockMutation.isError ? (
        <p role="alert" className="text-sm text-[var(--color-text-muted)]">
          Could not update the demo clock.{' '}
          <button type="button" className="underline" onClick={handleRetry}>
            Retry
          </button>
        </p>
      ) : null}
    </div>
  )
}
