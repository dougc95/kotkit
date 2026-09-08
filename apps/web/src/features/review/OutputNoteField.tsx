/**
 * The one-line "what did you finish" self-report (task 8.6.2;
 * `session_reviews.output_note`, D31). Always optional — `PracticeReview.tsx`
 * omits it from the finalize body entirely when blank, and sends the typed
 * text verbatim (no trimming) when not.
 */
export interface OutputNoteFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

const MAX_LENGTH = 200

export function OutputNoteField({ value, onChange }: OutputNoteFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor="output-note" className="block text-sm font-medium text-[var(--color-text)]">
        What did you finish? (optional)
      </label>
      <input
        id="output-note"
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text)]"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
