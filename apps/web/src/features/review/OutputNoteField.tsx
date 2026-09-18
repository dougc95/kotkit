import { Input } from '../../ui/shadcn/input.js'
import { Label } from '../../ui/shadcn/label.js'

/**
 * The one-line "what did you finish" self-report (task 8.6.2;
 * `session_reviews.output_note`, D31). Always optional — `PracticeReview.tsx`
 * omits it from the finalize body entirely when blank, and sends the typed
 * text verbatim (no trimming) when not.
 *
 * No error or description to wire, and `output-note` is a pinned
 * `e2e/practice-review.spec.ts` Tab-stop id, so this keeps a direct
 * `id`/`htmlFor` pair rather than routing through `useField`
 * (`CountField.tsx`'s doc comment explains why).
 */
export interface OutputNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 200

export function OutputNoteField({ value, onChange }: OutputNoteFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="output-note" className="block text-sm font-medium text-ink">
        What did you finish? (optional)
      </Label>
      <Input
        id="output-note"
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        className="w-full"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
