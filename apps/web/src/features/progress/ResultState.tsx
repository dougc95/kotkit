/**
 * The Progress report's one-state summary card (task 8.8.2;
 * progress-report spec: "Result state with precedence", "No invented
 * scores"). Pure presentation of `report.resultState` — no client-side
 * recomputation of state (D4): `resolveResultState` (2.4.2) already chose
 * the one applicable state server-side, and this component only looks its
 * copy up verbatim from `RESULT_STATE_COPY` (PRD §5). It never re-derives a
 * state from raw counts and never re-words the PRD copy.
 *
 * Card styling stays neutral for every state, including
 * `improvement_maintained_recall`: no success banner, no celebratory tone,
 * no confetti, no color change. The only thing that ever varies is the
 * headline, and only `improvement_maintained_recall` has one — "Fewer
 * reported switches" (D38) — shown above the PRD's own sentence. Every
 * other state renders its message alone (app-shell: "Copy never punishes
 * or gamifies").
 */
import type { ResultState as ResultStateValue } from '@attention-lab/shared'
import { RESULT_STATE_COPY } from '@attention-lab/shared'

export interface ResultStateProps {
  readonly resultState: ResultStateValue
}

export function ResultState({ resultState }: ResultStateProps) {
  const copy = RESULT_STATE_COPY[resultState]

  return (
    <section aria-label="Result" className="flex flex-col gap-1" data-testid="result-state">
      {copy.headline !== null ? (
        <h2 className="text-base font-semibold" data-testid="result-state-headline">
          {copy.headline}
        </h2>
      ) : null}
      <p data-testid="result-state-message">{copy.message}</p>
    </section>
  )
}
