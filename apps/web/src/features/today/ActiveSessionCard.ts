/**
 * Thin re-export so Today's own wiring (task 8.2.1's eventual edit — see
 * task 8.2.5's `centralWiringNeeded` report) imports `ActiveSessionCard`
 * from its own feature directory, the same way it already imports
 * `BlockCard`/`CheckinCard`/`NextAction` locally, rather than reaching into
 * `features/session` directly. The real component and its props live in
 * `features/session/ActiveSessionCard.tsx` (task 8.2.5; D16: one owner per
 * shared piece) — this file adds no behavior of its own.
 */
export { ActiveSessionCard } from '../session/ActiveSessionCard.js'
export type { ActiveSessionCardProps } from '../session/ActiveSessionCard.js'
