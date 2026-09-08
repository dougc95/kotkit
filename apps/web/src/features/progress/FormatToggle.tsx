/**
 * CSV | Markdown format toggle for `ExportPreview` (task 8.8.4). A plain
 * two-option `RadioGroup` (mutually exclusive selection, not a submit
 * action) — same Radix pattern as `OutputQualityField` (8.6.2): each
 * option's accessible name comes from a sibling `<label htmlFor>` since
 * Radix's `RadioGroup.Item` renders a `button[role="radio"]`, which does
 * not pick up a wrapping `<label>` the way a native input does.
 */
import { RadioGroup } from 'radix-ui'

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
    <RadioGroup.Root
      className="flex gap-4"
      value={value}
      onValueChange={(next) => onChange(next as ExportFormat)}
      aria-label="Export format"
    >
      {OPTIONS.map((option) => {
        const id = `export-format-${option.value}`
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
  )
}
