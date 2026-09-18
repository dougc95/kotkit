import { Label } from '../../ui/shadcn/label.js'
import { Textarea } from '../../ui/shadcn/textarea.js'

/**
 * The optional longer free-text note (task 8.6.2; `session_reviews.review_note`,
 * D31). Independent of `OutputNoteField` — both may be set at once, and each
 * is omitted from the finalize body on its own when left blank.
 *
 * `review-note` is a pinned `e2e/practice-review.spec.ts` Tab-stop id, so
 * this keeps a direct `id`/`htmlFor` pair rather than routing through
 * `useField` (`CountField.tsx`'s doc comment explains why).
 */
export interface ReviewNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 2000

export function ReviewNoteField({ value, onChange }: ReviewNoteFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="review-note" className="block text-sm font-medium text-ink">
        Notes (optional)
      </Label>
      <Textarea
        id="review-note"
        value={value}
        maxLength={MAX_LENGTH}
        rows={4}
        className="w-full"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
