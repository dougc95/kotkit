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
 *
 * shadcn-ui-rework (2026-09-09): the note now renders through the generated
 * `Label`/`Textarea` primitives (the rework spec §6/U8's "Label + Input/Textarea/
 * Select plus one small local Field component" pairing — this unit's scope
 * note above), and its counter is wired to the textarea through
 * `@/ui/field.js`'s `useField` (design.md's fix for "character counters not
 * associated with their fields") — `controlProps` carries `aria-describedby`
 * pointing at `descriptionProps.id`, and the rendered `n/500` text lives at
 * that id. The Yes/No radio stays the direct `radix-ui` `RadioGroup` with its
 * own plain `<label>`s, unconverted (this unit's scope note above): the ids
 * stay the literal `materially-disrupted-yes`/`materially-disrupted-no`
 * strings they have always been, because `e2e/benchmark-review.spec.ts` and
 * `e2e/recovery.spec.ts` click `#materially-disrupted-no` directly, and
 * `useField`'s id generation is not part of its frozen contract, so only the
 * note (whose id was never depended on anywhere by string) is routed through
 * it. The radiogroup gets its own `aria-labelledby`, pointing at the
 * fieldset's `<legend>`, so an anonymous `role="radiogroup"` does not sit
 * between the radios and their named group — same pattern as `Scoring.tsx`'s
 * `PointRow`. `onValueChange` is guarded rather than cast: Radix's group
 * value is a plain `string`, and `isDisruptionAnswer` below narrows it to
 * `'yes' | 'no'` before it ever reaches `onChange`, matching `Scoring.tsx`'s
 * `isPointScore` guard.
 */
import { RadioGroup } from 'radix-ui'

import { useField } from '../../ui/field.js'
import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'

export type DisruptionAnswer = 'yes' | 'no' | null

const MAX_NOTE_LENGTH = 500

const DISRUPTION_LEGEND_ID = 'materially-disrupted-legend'

/** Guards `RadioGroup`'s `onValueChange` (typed `(value: string) => void`) without an `as` cast. */
function isDisruptionAnswer(value: string): value is 'yes' | 'no' {
  return value === 'yes' || value === 'no'
}

export interface DisruptionFieldProps {
  readonly value: DisruptionAnswer
  readonly note: string
  readonly onChange: (value: DisruptionAnswer, note: string) => void
}

export function DisruptionField({ value, note, onChange }: DisruptionFieldProps) {
  const noteField = useField({ name: 'disruption-note', description: `${note.length}/${MAX_NOTE_LENGTH}` })

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend id={DISRUPTION_LEGEND_ID} className="block text-sm font-medium text-ink">
          Was this session materially disrupted?
        </legend>
        <RadioGroup.Root
          className="flex gap-4"
          required
          value={value ?? null}
          aria-labelledby={DISRUPTION_LEGEND_ID}
          onValueChange={(next) => {
            if (isDisruptionAnswer(next)) {
              onChange(next, note)
            }
          }}
        >
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-yes"
              value="yes"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-rule bg-card data-[state=checked]:border-signal"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-signal" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-yes" className="flex min-h-11 items-center text-sm text-ink">
              Yes
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id="materially-disrupted-no"
              value="no"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-rule bg-card data-[state=checked]:border-signal"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-signal" />
            </RadioGroup.Item>
            <label htmlFor="materially-disrupted-no" className="flex min-h-11 items-center text-sm text-ink">
              No
            </label>
          </div>
        </RadioGroup.Root>
      </fieldset>

      <div className="space-y-1">
        <Label {...noteField.labelProps} className="text-sm font-medium text-ink">
          Disruption note (optional)
        </Label>
        <Textarea
          {...noteField.controlProps}
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          onChange={(event) => onChange(value, event.target.value)}
        />
        {noteField.descriptionProps ? (
          <p {...noteField.descriptionProps} className="text-xs text-ink-muted">
            {note.length}/{MAX_NOTE_LENGTH}
          </p>
        ) : null}
      </div>
    </div>
  )
}
