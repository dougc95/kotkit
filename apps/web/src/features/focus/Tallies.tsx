/**
 * Renders the D11 tallies computed by `sessionTallies.ts`/`useSessionEvents.ts` —
 * plain numbers, three separate `<dd>` elements so no rendered element's own
 * text is ever a summed figure (task 8.5.1; design.md D11; CLAUDE.md's "no
 * invented attention score"). `agentChecks` is genuinely optional: the
 * benchmark variant of `EventButtons` has no Agent check control at all, so
 * a caller for that variant omits the prop entirely rather than passing a
 * permanently-zero count for a thing the screen never offers to record.
 */
export interface TalliesProps {
  readonly offTask: number
  readonly external: number
  readonly agentChecks?: number
}

export function Tallies({ offTask, external, agentChecks }: TalliesProps) {
  return (
    <dl className="flex flex-wrap gap-4 text-sm">
      <div className="flex items-baseline gap-1">
        <dt className="text-[var(--color-text-muted)]">Off-task</dt>
        <dd className="font-medium tabular-nums">{offTask}</dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-[var(--color-text-muted)]">External interruptions</dt>
        <dd className="font-medium tabular-nums">{external}</dd>
      </div>
      {agentChecks !== undefined && (
        <div className="flex items-baseline gap-1">
          <dt className="text-[var(--color-text-muted)]">Agent checks</dt>
          <dd className="font-medium tabular-nums">{agentChecks}</dd>
        </div>
      )}
    </dl>
  )
}
