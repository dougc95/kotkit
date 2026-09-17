/**
 * One headline device-minutes input for CheckinForm (task 8.7.1; design.md
 * D36; shadcn-ui-rework the rework spec §8 "Daily check-in"). Renders exactly one
 * number field for `device`. When `disabled` is true (a detail row already
 * exists for this device, per D36's mutual-exclusivity rule) the field
 * becomes a read-only display of `value` — the caller passes the
 * already-summed feed-scope total in that case, never an editable draft —
 * and gains a thin `signal` (petrol) rule along its bottom edge, because it
 * is now a value being computed live from the detail rows below it rather
 * than a plain entry.
 *
 * All-blank-by-default: `value === null` renders an empty input, never `0`
 * (CLAUDE.md "Unknown != zero" — a blank box is not-reported, not a zero
 * reading).
 *
 * `error`, when present, is a server-reported conflict (CheckinForm.tsx's
 * `feed_platform_conflict` handling) wired through `useField` so it is both
 * visible and associated to the input via `aria-describedby` — an
 * unassociated-error gap of the same kind as the rework spec §9 defect 2, though
 * this field is not one of that defect's five named fields (see this file's
 * header comment above and the CheckinForm.tsx task header for the
 * distinction).
 *
 * `disabled:opacity-100` overrides the generated `Input`'s `disabled:opacity-50`:
 * the computed total is a live recorded value and the petrol rule is its only
 * visual mark, so neither the number nor the rule may fade when the field is
 * disabled.
 */
import type { ChangeEvent } from 'react'

import { cn } from '../../lib/cn.js'
import { useField } from '../../ui/field.js'
import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

export type HeadlineDevice = 'phone' | 'desktop'

export interface DeviceMinutesFieldProps {
  readonly device: HeadlineDevice
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly disabled: boolean
  readonly error?: string | null | undefined
}

const DEVICE_LABEL: Record<HeadlineDevice, string> = {
  phone: 'Phone feed minutes',
  desktop: 'Desktop feed minutes',
}

/** Rejects a keystroke that would make the value negative or non-integer; blank always passes through as `null`. */
function parseNonNegativeInteger(raw: string): number | null | undefined {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

export function DeviceMinutesField({ device, value, onChange, disabled, error }: DeviceMinutesFieldProps) {
  const label = DEVICE_LABEL[device]
  const field = useField({ name: `checkin-${device}-minutes`, error })

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = parseNonNegativeInteger(event.target.value)
    if (next === undefined) return
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <Label {...field.labelProps}>{label}</Label>
      <Input
        {...field.controlProps}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        disabled={disabled}
        aria-readonly={disabled}
        value={value === null ? '' : value}
        onChange={handleChange}
        className={cn('min-h-11 w-full max-w-40 disabled:opacity-100', disabled && 'border-b-2 border-b-signal')}
      />
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm text-attention">
          {error}
        </p>
      ) : null}
    </div>
  )
}
