import { RadioGroup } from 'radix-ui'
import type { OutputQuality } from '@attention-lab/shared'

/**
 * Yes/Partly/No self-report of whether the planned output was produced
 * (task 8.6.2; `session_reviews.output_quality`). Required before Save can
 * submit (`PracticeReview.tsx` owns that validation and passes `error`
 * through only after a blocked submit attempt) — this component never
 * blocks selection itself, it only surfaces the message.
 *
 * Radix's `RadioGroup.Item` renders a `button[role="radio"]`; each option's
 * accessible name comes from a sibling `<label htmlFor>` rather than
 * wrapping the button in a `<label>` (a button does not forward a wrapping
 * label's click the way a native input does).
 */
const OPTIONS: ReadonlyArray<{ value: OutputQuality; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No' },
]

export interface OutputQualityFieldProps {
  readonly value: OutputQuality | null
  readonly onChange: (value: OutputQuality) => void
  /** Set only after a blocked submit attempt (brief: "Choose Yes, Partly or No"). */
  readonly error: string | null
}

export function OutputQualityField({ value, onChange, error }: OutputQualityFieldProps) {
  const errorId = 'output-quality-error'

  return (
    <fieldset className="space-y-2" aria-describedby={error !== null ? errorId : undefined}>
      <legend className="text-sm font-medium text-[var(--color-text)]">Did you produce the planned output?</legend>
      <RadioGroup.Root
        className="flex gap-4"
        value={value}
        onValueChange={(next) => onChange(next as OutputQuality)}
      >
        {OPTIONS.map((option) => {
          const id = `output-quality-${option.value}`
          return (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroup.Item
                id={id}
                value={option.value}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
              >
                <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
              </RadioGroup.Item>
              <label htmlFor={id} className="text-sm text-[var(--color-text)]">
                {option.label}
              </label>
            </div>
          )
        })}
      </RadioGroup.Root>
      {error !== null ? (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
