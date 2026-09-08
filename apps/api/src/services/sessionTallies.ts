/**
 * Task 5.2.1 — the API-layer entry point for a session's interruption
 * tallies. This wraps `tallyEvents` from
 * `packages/shared/src/domain/firstSwitch.ts` rather than reimplementing it:
 * D4 puts derived-field rules in `packages/shared` exactly once, and D11's
 * agent-check-as-subtype rule already lives there with its own unit
 * coverage (`packages/shared/test/domain/tally.test.ts`). Re-exporting it
 * under this name is what lets `sessionSerializer` (5.1.1), `GET
 * /sessions/{id}` (5.2.2), the events route (5.3.1) and group 5b's
 * transitions/clock-gap/finalize routes share one `deriveTallies` import
 * without duplicating the tally rule at the API layer.
 *
 * D11 / D20 shape — `{ offTask, external, agentChecks }`, exactly those
 * three keys:
 *  - a row with `voidedAt` set (D9) is skipped entirely;
 *  - `off_task` → `offTask + 1`;
 *  - `external` → `external + 1`;
 *  - `agent_check` → `agentChecks + 1`, and only when
 *    `details.alsoOffTask === true`, also `offTask + 1` (never twice into
 *    `offTask` for one row);
 *  - `pause`, `resume`, `clock_gap` and `visibility` contribute to no tally
 *    (D15/D39 — a hidden tab creates nothing, and lifecycle/context events
 *    are never interruptions).
 *
 * `offTask` and `agentChecks` overlap by design when a check was also
 * off-task, so no combined/total field is ever exported here — summing the
 * two would double-count. Pure: no database import, no mutation.
 */
import { tallyEvents } from '@attention-lab/shared'
import type { EventLike, EventTallies } from '@attention-lab/shared'

export type { EventLike, EventTallies }

export function deriveTallies(events: readonly EventLike[]): EventTallies {
  return tallyEvents(events)
}
