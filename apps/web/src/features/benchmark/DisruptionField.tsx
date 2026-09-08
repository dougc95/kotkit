/**
 * DisruptionField — the required "materially disrupted" self-attestation
 * (task 8.4.4; design.md D7.2; specs/benchmark-assessment: "Disruption is a
 * required self-attestation" — "External interruptions without disruption").
 * First control of the third section of `/benchmark/:sessionId/scoring`
 * (mounted by `BenchmarkReviewPage`, see this task's edit there).
 *
 * A plain Yes/No radio with NO default value — an unanswered attestation is
 * not the same as "No", so this component never pre-selects an answer, and
 * `BenchmarkReviewPage` never seeds it from `review.materiallyDisrupted`
 * either (that field is written only by finalize, D31, so it is always
 * `null` at this point in the flow regardless). The parent's Finalize step
 * (8.4.5) refuses to finalize until this has a real `'yes' | 'no'` value.
 *
 * The optional note is capped at 500 characters client-side with a visible
 * `n/500` counter, mirroring `Recall.tsx`'s `RecallPoints` counter exactly
 * (this task's own brief names 500, independent of `ReviewInputSchema`'s
 * wider 2000-character wire limit for `disruptionNote` — same reasoning as
 * `Recall.tsx`'s point-length note: a stricter client cap is always a safe
 * subset of a looser wire limit).
 *
 * Fully controlled, single `onChange` (matches `CountFields`'s style):
 * every keystroke or radio pick reports the COMPLETE next `{value, note}`
 * pair upward in one call, so `BenchmarkReviewPage` never has to reconcile
 * two independent setters racing each other.
 */
import { RadioGroup } from 'radix-ui'

export type DisruptionAnswer = 'yes' | 'no' | null

const MAX_NOTE_LENGTH = 500

export interface DisruptionFieldProps {
  readonly value: DisruptionAnswer
  readonly note: string
  readonly onChange: (value: DisruptionAnswer, note: string) => void
}

export function DisruptionField({ value, note, onChange }: DisruptionFieldProps) {
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-[var(--color-text)]">
          Was this session materially disrupted?
        </legend>
        <RadioGroup.Root
          className="flex gap-4"
          required
          value={value ?? null}
          onValueChange={(next) => onChange(next as 'yes' | 'no', note)}
        >
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-yes"
              value="yes"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-yes" className="text-sm text-[var(--color-text)]">
              Yes
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-no"
              value="no"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-no" className="text-sm text-[var(--color-text)]">
              No
            </label>
          </div>
        </RadioGroup.Root>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="disruption-note" className="block text-sm font-medium text-[var(--color-text)]">
          Disruption note (optional)
        </label>
        <textarea
          id="disruption-note"
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          onChange={(event) => onChange(value, event.target.value)}
        />
        <p className="text-xs text-[var(--color-text-muted)]">
          {note.length}/{MAX_NOTE_LENGTH}
        </p>
      </div>
    </div>
  )
}
