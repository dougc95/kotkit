/**
 * One headline device-minutes input for CheckinForm (task 8.7.1; design.md
 * D36). Renders exactly one number field for `device`. When `disabled` is
 * true (a detail row already exists for this device, per D36's mutual-
 * exclusivity rule) the field becomes a read-only display of `value` — the
 * caller passes the already-summed feed-scope total in that case, never an
 * editable draft — rather than accepting input.
 *
 * All-blank-by-default: `value === null` renders an empty input, never `0`
 * (CLAUDE.md "Unknown != zero" — a blank box is not-reported, not a zero
 * reading).
 */
import type { ChangeEvent } from 'react'

export type HeadlineDevice = 'phone' | 'desktop'

export interface DeviceMinutesFieldProps {
  readonly device: HeadlineDevice
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly disabled: boolean
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

export function DeviceMinutesField({ device, value, onChange, disabled }: DeviceMinutesFieldProps) {
  const id = `checkin-${device}-minutes`
  const label = DEVICE_LABEL[device]

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = parseNonNegativeInteger(event.target.value)
    if (next === undefined) return
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        disabled={disabled}
        aria-readonly={disabled}
        value={value === null ? '' : value}
        onChange={handleChange}
        className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] disabled:bg-[var(--color-surface)] disabled:text-[var(--color-text-muted)]"
      />
    </div>
  )
}
