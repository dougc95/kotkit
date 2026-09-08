import { useId } from 'react'

/**
 * The timezone picker on Settings (task 8.9.2). Purely presentational: the
 * caller (`Preferences.tsx`) owns the value, the candidate zone list and any
 * field error, so this component never calls `Intl.supportedValuesOf`
 * itself — one place computes that list (`listTimezones` below, exported for
 * `Preferences.tsx`), matching `features/setup/PlanForm.tsx`'s
 * `listTimezones`/`detectTimezone` pair for the same reason: a host whose
 * list happens to omit the currently-stored zone must still show it selected
 * rather than silently falling back to whatever option is first.
 *
 * The helper copy is the fixed string program-setup's decision record and
 * this task's brief both require verbatim — timezone corrections must never
 * read as "your program restarts."
 */
const HELPER_TEXT = 'Changing your timezone does not move program days'

export function listTimezones(current: string): string[] {
  try {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return zones.includes(current) ? zones : [current, ...zones]
  } catch {
    return [current]
  }
}

export interface TimezoneSelectProps {
  readonly value: string
  readonly zones: readonly string[]
  readonly onChange: (value: string) => void
  readonly error?: string
}

export function TimezoneSelect({ value, zones, onChange, error }: TimezoneSelectProps) {
  const selectId = useId()
  const helpId = useId()
  const errorId = useId()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="text-sm font-medium text-[var(--color-text)]">
        Timezone
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={[helpId, error !== undefined ? errorId : undefined].filter(Boolean).join(' ') || undefined}
        className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <p id={helpId} className="text-sm text-[var(--color-text-muted)]">
        {HELPER_TEXT}
      </p>
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
