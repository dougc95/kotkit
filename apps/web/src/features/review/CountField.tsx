import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * One self-reported count field (episode/S, external/E or unplanned agent
 * checks) on `PracticeReview` (task 8.6.2; design.md D31). May stay blank —
 * blank is "not reported", never coerced to 0 — and shows a "prefilled from
 * recorded events" hint whenever its current value came from the D31
 * prefill rule and the caller has not yet typed into it (`PracticeReview.tsx`
 * decides `prefilled`, this component only renders it).
 *
 * Deliberately does NOT go through `useField` (`@/ui/field.js`): that hook
 * mints its DOM id as `` `${useId()}-${name}` ``, which would replace the
 * literal `id` this component is called with (`episode-count`,
 * `external-count`, `unplanned-agent-checks`) with an opaque per-render
 * string. `e2e/practice-review.spec.ts`'s "Keyboard-only" test reads
 * `document.activeElement.id` against that exact literal, and
 * `e2e/acceptance/working-day.spec.ts` / `e2e/acceptance/recovery.spec.ts`
 * both read `page.locator('#episode-count')` and
 * `page.locator('#episode-count-hint')` directly — so both the input's id
 * and the hint paragraph's `${id}-hint` id stay exactly as hand-rolled
 * today; only the rendered elements move onto the generated `Input`/`Label`.
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
    <div className="grid grid-rows-subgrid row-span-3 gap-1">
      <Label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value === null ? '' : String(value)}
        aria-describedby={prefilled ? hintId : undefined}
        className="w-full"
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
        <p id={hintId} className="text-xs text-ink-muted">
          prefilled from recorded events
        </p>
      ) : null}
    </div>
  )
}
