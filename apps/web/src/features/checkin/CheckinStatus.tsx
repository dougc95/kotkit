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
  const text =
    status === 'complete'
      ? 'Complete'
      : `Incomplete — missing: ${missing.map((field) => FIELD_LABEL[field]).join(', ')}`

  return (
    <p role="status" className="text-sm font-medium text-[var(--color-text)]">
      {text}
    </p>
  )
}
