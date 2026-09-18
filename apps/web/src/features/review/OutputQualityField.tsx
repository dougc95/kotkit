import { useId } from 'react'
import type { OutputQuality } from '@attention-lab/shared'

import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'

/**
 * Yes/Partly/No self-report of whether the planned output was produced
 * (task 8.6.2; `session_reviews.output_quality`). Required before Save can
 * submit (`PracticeReview.tsx` owns that validation and passes `error`
 * through only after a blocked submit attempt) — this component never
 * blocks selection itself, it only surfaces the message.
 *
 * Each option's accessible name comes from a sibling `Label htmlFor`
 * rather than wrapping the radio in a `<label>` (a button does not forward
 * a wrapping label's click the way a native input does). The fieldset's
 * `aria-describedby` -> error `role="alert"` wiring is the one place in
 * this app that was already correct before shadcn/`useField` existed
 * (design doc's defects list, item 2); `useField` now generates that same
 * link structurally instead of by hand, and this component's job is only
 * to preserve it.
 *
 * `onValueChange` delivers a plain string from the underlying primitive;
 * it is validated against `OPTIONS` (never `as OutputQuality`) so a value
 * that does not match one of the three options is dropped instead of
 * silently coerced.
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
  const field = useField({ name: 'output-quality', error })
  const legendId = useId()

  return (
    <fieldset className="space-y-2" aria-describedby={field.controlProps['aria-describedby']}>
      <legend id={legendId} className="text-sm font-medium text-ink">
        Did you produce the planned output?
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        className="flex gap-4"
        value={value}
        onValueChange={(next) => {
          const option = OPTIONS.find((candidate) => candidate.value === next)
          if (option !== undefined) {
            onChange(option.value)
          }
        }}
      >
        {OPTIONS.map((option) => {
          const id = `output-quality-${option.value}`
          return (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem id={id} value={option.value} />
              <Label htmlFor={id} className="flex min-h-11 items-center text-sm font-normal text-ink">
                {option.label}
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      {field.errorProps !== undefined ? (
        <p {...field.errorProps} className="text-sm text-attention">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
