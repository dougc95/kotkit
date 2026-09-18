import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DemoClockBodyValue, MeResponseValue, ProgramResponseValue, SlotResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'
import { skipToDay14OffsetSeconds } from './demoClockMath.js'

/**
 * The demo-clock section of `DemoControls`. `POST /demo/clock` always sends
 * an ABSOLUTE offset from real time — never a delta on top of whatever
 * `me.demoClockOffsetSeconds` already is — so every action below computes
 * the full offset it wants, not an increment. On success the whole query
 * cache is cleared so Today/Progress refetch under the new clock.
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
  const advanceField = useField({ name: 'demo-clock-advance' })

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
      <h3 className="text-sm font-semibold text-ink">Demo clock</h3>
      <p className="text-sm text-ink-muted">Current offset: {formatOffsetSeconds(me.demoClockOffsetSeconds)}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label {...advanceField.labelProps} className="text-sm font-medium text-ink">
            Advance the clock to
          </Label>
          <Input
            {...advanceField.controlProps}
            type="datetime-local"
            value={draftDateTime}
            disabled={clockMutation.isPending}
            onChange={(event) => setDraftDateTime(event.target.value)}
          />
        </div>
        <Button variant="secondary" disabled={draftDateTime === '' || clockMutation.isPending} onClick={handleAdvance}>
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
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-attention">
          Could not update the demo clock.
          <Button variant="quiet" onClick={handleRetry}>
            Retry
          </Button>
        </p>
      ) : null}
    </div>
  )
}
