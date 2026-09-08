/**
 * ConditionsFields — the second control group of the third section of
 * `/benchmark/:sessionId/scoring` (task 8.4.4; design.md D7.5;
 * specs/benchmark-assessment: "Observed conditions live on the attempt" —
 * "Accommodation added at final"). Mounted by `BenchmarkReviewPage` right
 * after `DisruptionField`.
 *
 * Fully controlled (matches `CountFields`'s style): this component never
 * holds `deviceFormat`/`language`/`materialLevel`/`accommodations` or the
 * confirm flag in its own state, only reports the next `{value, confirmed}`
 * pair upward on every change. The DEFAULT value — `review.observedConditions`
 * (the server's own default from the slot at session start, D7.5) — is
 * seeded by `BenchmarkReviewPage` itself, once, when `GET /sessions/{id}`
 * resolves (this component has no `session`/`review` prop of its own; see
 * this task's edit to `BenchmarkReviewPage.tsx`).
 *
 * A blank text field commits `null` (not reported), never `''` — matches
 * `ObservedConditionsSchema`'s `Type.Union([Type.String(), Type.Null()])`
 * for each of the three text fields exactly, so a field the user clears
 * reverts to "not recorded" rather than an empty string sitting on the wire.
 */
import { ACCOMMODATIONS, type Accommodation, type ObservedConditionsValue } from '@attention-lab/shared'

const ACCOMMODATION_COPY: Record<Accommodation, string> = {
  screen_reader: 'Screen reader',
  magnification: 'Magnification',
  increased_font_size: 'Increased font size',
  high_contrast: 'High contrast',
  reduced_motion: 'Reduced motion',
  extra_lighting: 'Extra lighting',
  other: 'Other',
}

type TextField = 'deviceFormat' | 'language' | 'materialLevel'

const TEXT_FIELDS: readonly { readonly key: TextField; readonly label: string; readonly id: string }[] = [
  { key: 'deviceFormat', label: 'Device format', id: 'conditions-device-format' },
  { key: 'language', label: 'Language', id: 'conditions-language' },
  { key: 'materialLevel', label: 'Material level', id: 'conditions-material-level' },
]

export interface ConditionsFieldsProps {
  readonly value: ObservedConditionsValue
  readonly confirmed: boolean
  readonly onChange: (value: ObservedConditionsValue, confirmed: boolean) => void
}

export function ConditionsFields({ value, confirmed, onChange }: ConditionsFieldsProps) {
  function handleTextChange(field: TextField, raw: string): void {
    const next = raw.trim() === '' ? null : raw
    onChange({ ...value, [field]: next }, confirmed)
  }

  function handleAccommodationToggle(accommodation: Accommodation, checked: boolean): void {
    const nextAccommodations = checked
      ? [...value.accommodations, accommodation]
      : value.accommodations.filter((item) => item !== accommodation)
    onChange({ ...value, accommodations: nextAccommodations }, confirmed)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={field.id} className="block text-sm font-medium text-[var(--color-text)]">
              {field.label}
            </label>
            <input
              id={field.id}
              type="text"
              value={value[field.key] ?? ''}
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)]"
              onChange={(event) => handleTextChange(field.key, event.target.value)}
            />
          </div>
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-[var(--color-text)]">Accommodations</legend>
        {ACCOMMODATIONS.map((accommodation) => {
          const id = `conditions-accommodation-${accommodation}`
          return (
            <label key={accommodation} htmlFor={id} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                id={id}
                type="checkbox"
                checked={value.accommodations.includes(accommodation)}
                onChange={(event) => handleAccommodationToggle(accommodation, event.target.checked)}
              />
              {ACCOMMODATION_COPY[accommodation]}
            </label>
          )
        })}
      </fieldset>

      <label
        htmlFor="conditions-confirmed"
        className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]"
      >
        <input
          id="conditions-confirmed"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onChange(value, event.target.checked)}
        />
        These conditions are correct
      </label>
    </div>
  )
}
