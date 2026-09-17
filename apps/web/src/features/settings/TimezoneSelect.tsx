import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * The timezone picker on Settings. Purely presentational: the caller
 * (`Preferences.tsx`) owns the value, the candidate zone list and any field
 * error. Stays a native `<select>` rather than the generated Select
 * primitive — the option list can be several hundred IANA zone names, and
 * `user.selectOptions`/`toHaveValue` in `Preferences.test.tsx` exercise it
 * as a native control.
 *
 * The helper copy is a fixed string program-setup's decision record
 * requires verbatim — timezone corrections must never read as "your
 * program restarts."
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
  const field = useField({ name: 'timezone', description: HELPER_TEXT, error: error ?? null })

  return (
    <div className="flex flex-col gap-2">
      <Label {...field.labelProps} className="text-sm font-medium text-ink">
        Timezone
      </Label>
      <select
        {...field.controlProps}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="min-h-11 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {field.descriptionProps !== undefined ? (
        <p {...field.descriptionProps} className="text-sm text-ink-muted">
          {HELPER_TEXT}
        </p>
      ) : null}
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm text-attention">
          {error}
        </p>
      ) : null}
    </div>
  )
}
