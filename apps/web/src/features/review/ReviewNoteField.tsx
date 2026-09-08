/**
 * The optional longer free-text note (task 8.6.2; `session_reviews.review_note`,
 * D31). Independent of `OutputNoteField` — both may be set at once, and each
 * is omitted from the finalize body on its own when left blank.
 */
export interface ReviewNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 2000

export function ReviewNoteField({ value, onChange }: ReviewNoteFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor="review-note" className="block text-sm font-medium text-[var(--color-text)]">
        Notes (optional)
      </label>
      <textarea
        id="review-note"
        value={value}
        maxLength={MAX_LENGTH}
        rows={4}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
