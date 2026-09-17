/**
 * CSV | Markdown format toggle for `ExportPreview` (task 8.8.4). A plain
 * two-option shadcn `RadioGroup` (mutually exclusive selection, not a
 * submit action) — each option's accessible name comes from a sibling
 * `<label htmlFor>` since Radix's `RadioGroupItem` renders a
 * `button[role="radio"]`, which does not pick up a wrapping `<label>` the
 * way a native input does.
 */
import { RadioGroup, RadioGroupItem } from '../../ui/shadcn/radio-group.js'

export type ExportFormat = 'csv' | 'markdown'

const OPTIONS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'Markdown' },
]

export interface FormatToggleProps {
  readonly value: ExportFormat
  readonly onChange: (format: ExportFormat) => void
}

export function FormatToggle({ value, onChange }: FormatToggleProps) {
  return (
    <RadioGroup
      className="flex gap-4"
      value={value}
      onValueChange={(next) => onChange(next as ExportFormat)}
      aria-label="Export format"
    >
      {OPTIONS.map((option) => {
        const id = `export-format-${option.value}`
        return (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem id={id} value={option.value} />
            <label htmlFor={id} className="text-sm text-ink">
              {option.label}
            </label>
          </div>
        )
      })}
    </RadioGroup>
  )
}
