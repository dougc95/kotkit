import { Link } from 'react-router'
import type { ProgramStatus } from '@attention-lab/shared'

/**
 * "Edit benchmark materials" (task 8.9.2; design.md D38: "a link 'Edit
 * benchmark materials' to /setup/readiness, which stays reachable while the
 * program is open"). Renders nothing for a `null` status (no program at
 * all) and nothing once the program has reached a terminal status —
 * `completed`/`archived` are the only two terminal `ProgramStatus` values
 * (D33); `draft`, `baseline_ready` and `active` are all "open" here, matching
 * the brief's "any non-terminal status" literally rather than allow-listing
 * just `active`.
 */
const TERMINAL_STATUSES: ReadonlySet<ProgramStatus> = new Set(['completed', 'archived'])

export interface EditMaterialsLinkProps {
  readonly programStatus: ProgramStatus | null
}

export function EditMaterialsLink({ programStatus }: EditMaterialsLinkProps) {
  if (programStatus === null || TERMINAL_STATUSES.has(programStatus)) {
    return null
  }

  return (
    <Link
      to="/setup/readiness"
      className="text-sm font-medium text-[var(--color-primary)] underline underline-offset-2"
    >
      Edit benchmark materials
    </Link>
  )
}
