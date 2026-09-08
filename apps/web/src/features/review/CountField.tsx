/**
 * One self-reported count field (episode/S, external/E or unplanned agent
 * checks) on `PracticeReview` (task 8.6.2; design.md D31). May stay blank —
 * blank is "not reported", never coerced to 0 — and shows a "prefilled from
 * recorded events" hint whenever its current value came from the D31
 * prefill rule and the caller has not yet typed into it (`PracticeReview.tsx`
 * decides `prefilled`, this component only renders it).
 *
 * Keystrokes that would not parse as a non-negative integer (a bare "-",
 * a decimal point, ...) are ignored rather than committing a bad value —
 * the input's own displayed text still reflects the last-accepted value
 * (controlled), so an invalid keystroke has no visible effect instead of
 * silently becoming 0 or NaN.
 */
export interface CountFieldProps {
  readonly id: string
  readonly label: string
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly prefilled: boolean
}

export function CountField({ id, label, value, onChange, prefilled }: CountFieldProps) {
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)]">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value === null ? '' : String(value)}
        aria-describedby={prefilled ? hintId : undefined}
        className="min-h-11 w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)]"
        onChange={(event) => {
          const raw = event.target.value
          if (raw.trim() === '') {
            onChange(null)
            return
          }
          const parsed = Number(raw)
          if (!Number.isInteger(parsed) || parsed < 0) {
            // Not a valid ReportedCount keystroke (e.g. "-", a decimal) — leave the committed value untouched.
            return
          }
          onChange(parsed)
        }}
      />
      {prefilled ? (
        <p id={hintId} className="text-xs text-[var(--color-text-muted)]">
          prefilled from recorded events
        </p>
      ) : null}
    </div>
  )
}
