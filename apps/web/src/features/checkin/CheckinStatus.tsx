/**
 * Renders a day's completeness verbatim from the server (task 8.7.1; D12/D36;
 * CLAUDE.md "Unknown != zero" and "never inferred from record existence").
 * `status`/`missing` always come straight from a `GET`/`PUT
 * /programs/{id}/days/{date}` response's own `status` object — this
 * component performs no completeness computation of its own.
 */
import type { CheckinField, CheckinStatus as CheckinStatusValue } from '@attention-lab/shared'

export interface CheckinStatusProps {
  readonly status: CheckinStatusValue
  readonly missing: readonly CheckinField[]
}

const FIELD_LABEL: Record<CheckinField, string> = {
  sleep: 'sleep',
  feed: 'feed',
}

export function CheckinStatus({ status, missing }: CheckinStatusProps) {
  const complete = status === 'complete'
  const text = complete
    ? 'Complete'
    : `Incomplete — missing: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`

  // Task V5 ruling: an incomplete check-in is a needs-you message (spec §3
  // "Still needed"), so it is text-attention, matching Today's CheckinCard
  // (Task 16); a complete check-in stays neutral text-ink.
  return (
    <p role="status" className={complete ? 'text-sm font-medium text-ink' : 'text-sm font-medium text-attention'}>
      {text}
    </p>
  )
}
