/**
 * D11 tally rules — the single place the off-task/external/agent-check
 * counts are computed from a session's event list (task 8.5.1; design.md
 * D9, D11). Pure and side-effect free: never reads the clock, the outbox or
 * the network, just counts.
 *
 * Named `sessionTallies.ts`, not `tallies.ts` (the task brief's literal
 * name): this directory's `Tallies.tsx` component and a `tallies.ts` module
 * differ only by case, which a case-insensitive/preserving filesystem
 * (observed on this Windows dev machine's Vite/Rollup resolver — confirmed
 * by a minimal repro: importing `Tallies` from `./Tallies.js` resolved to
 * `tallies.ts`'s exports instead, i.e. `undefined`, crashing any consumer)
 * cannot reliably tell apart. Renaming this file sidesteps that collision
 * entirely; nothing about its exports (`tallies`, `SessionTallies`,
 * `TalliedEvent`) changed from what the brief specifies.
 *
 * `offTask` = every non-voided `off_task` event PLUS every non-voided
 * `agent_check` event whose `alsoOffTask` is true — the SAME event counted
 * toward both tallies, never summed into a combined/total figure (D11:
 * "Nothing is summed across the two tallies"). `agentChecks` = every
 * non-voided `agent_check` event, regardless of `alsoOffTask`. `external` =
 * every non-voided `external` event. `visibility` events are never counted
 * in any tally (D39/D15 — app visibility is not attention) — the type is
 * listed here only so a caller (`useSessionEvents.ts`) can pass its whole
 * event list through without pre-filtering.
 *
 * A voided event (D9's append-only/void marker) is excluded from every
 * tally regardless of its type, including an `agent_check` whose
 * `alsoOffTask` was true — voiding the one event removes both counts it
 * contributed, since they were never independent numbers to begin with.
 *
 * See design.md D9, D11, D39 and specs/practice-sessions: "Interruption
 * events with undo and subtypes" / "Agent check that was also off-task".
 */

export type TalliedEventType = 'off_task' | 'external' | 'agent_check' | 'visibility'

export interface TalliedEvent {
  readonly type: TalliedEventType
  /** `true` once voided (D9) — excluded from every tally regardless of type. */
  readonly voided: boolean
  /** Only meaningful for `type: 'agent_check'`; ignored for every other type. */
  readonly alsoOffTask?: boolean
}

/** No combined/total field by design (D11) — mirrors `SessionResponse.tallies` (D20). */
export interface SessionTallies {
  readonly offTask: number
  readonly external: number
  readonly agentChecks: number
}

export function tallies(events: readonly TalliedEvent[]): SessionTallies {
  let offTask = 0
  let external = 0
  let agentChecks = 0

  for (const event of events) {
    if (event.voided) {
      continue
    }
    if (event.type === 'off_task') {
      offTask += 1
    } else if (event.type === 'external') {
      external += 1
    } else if (event.type === 'agent_check') {
      agentChecks += 1
      if (event.alsoOffTask === true) {
        offTask += 1
      }
    }
    // 'visibility': never counted toward any tally (D39).
  }

  return { offTask, external, agentChecks }
}
