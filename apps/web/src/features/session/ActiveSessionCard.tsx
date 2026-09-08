/**
 * `ActiveSessionCard` (task 8.2.5; design.md D16, D18, D20; absorbs 8.10.4's
 * `ActiveSessionNotice`; practice-sessions: "One unfinished session per
 * user" / Second tab, Start while awaiting review; session-recovery: "Stale
 * writes conflict instead of overwriting" / Two tabs end a session).
 *
 * A pure, stateless routing card: given the one D20 `SessionResponseValue`
 * shape every session endpoint returns, it renders the single Return control
 * for that session's `kind`/`lifecycle` (and, for a benchmark awaiting
 * review, `review.recallLockedAt`) — never a query, never local state (per
 * this task's own "State" line: the `['sessions','active']` query is owned
 * by the caller — Today (8.2.1) and Benchmark Ready (8.3.1) each mount their
 * own via `lib/query/hooks.ts`'s `useActiveSession()` and render this card in
 * place of their normal Start control only when that query holds a session;
 * a 204 leaves the caller's own Start control in place, this component is
 * simply not rendered then). Session-mode screens (Benchmark Running 8.3.3,
 * Focus's TransitionControls 8.5.4, AgentPanel 8.5.5) mount it differently:
 * when their own transition mutation receives 409 `stale_version`, the
 * error's `details.current` (D18) seeds `['sessions', id]` and, once a
 * confirming refetch resolves, they pass that now-current session here with
 * `staleNotice` — this card always renders the Return line for whatever
 * `session.lifecycle` it is actually given (never a value it remembers from
 * a previous render), so a session another tab already advanced to
 * `awaiting_review` (or finished entirely) is what actually shows, never the
 * stale `running`/`paused` state the caller had attempted to transition
 * from.
 *
 * Re-exported unchanged from `features/today/ActiveSessionCard.ts` for
 * Today's own import once its wiring lands (this task does not edit
 * `Today.tsx` itself — see this task's `centralWiringNeeded` report).
 */
import { Link } from 'react-router'
import type { SessionResponseValue } from '@attention-lab/shared'

export interface ActiveSessionCardProps {
  readonly session: SessionResponseValue
  /**
   * True only when this render followed the caller's own 409 `stale_version`
   * (D18) — `session` is already `error.details.current`, re-confirmed by a
   * refetch, never the caller's pre-conflict copy.
   */
  readonly staleNotice?: boolean
}

interface Destination {
  readonly to: string
  readonly label: string
  readonly description: string
}

/**
 * One Return destination per `kind`/`lifecycle` (and, for a benchmark
 * awaiting review, `review.recallLockedAt`) — this task's brief, read
 * literally:
 *  - practice running|paused -> `/focus/:id`
 *  - practice awaiting_review -> `/review/:id` ("Finish your pending
 *    review")
 *  - benchmark running -> `/benchmark/:slotId` (the same route Ready itself
 *    renders at — router.tsx's Benchmark Running has no route of its own)
 *  - benchmark awaiting_review -> `/benchmark/:id/recall` when
 *    `review.recallLockedAt` is null, else `/benchmark/:id/scoring`
 *
 * `finalized`/`abandoned` are never returned by `GET /sessions/active` (only
 * an unfinished session qualifies), so the caller-owned query path above
 * never reaches them — but the `staleNotice` path can (D18's own note: a
 * session another tab ended can already read `finalized`), so both are
 * handled here too, defensively, rather than left for TypeScript's
 * exhaustiveness alone to paper over.
 */
function destinationFor(session: SessionResponseValue): Destination {
  const { kind, lifecycle, id, slotId, review } = session

  if (lifecycle === 'finalized') {
    return { to: '/today', label: 'Return to Today', description: 'Session finalized' }
  }
  if (lifecycle === 'abandoned') {
    return { to: '/today', label: 'Return to Today', description: 'Session ended' }
  }

  if (kind === 'practice') {
    if (lifecycle === 'awaiting_review') {
      return {
        to: `/review/${id}`,
        label: 'Finish your pending review',
        description: 'Practice session awaiting review',
      }
    }
    // running | paused
    return {
      to: `/focus/${id}`,
      label: 'Return to your session',
      description: lifecycle === 'paused' ? 'Practice session paused' : 'Practice session in progress',
    }
  }

  // kind === 'benchmark'
  if (lifecycle === 'awaiting_review') {
    return review.recallLockedAt === null
      ? { to: `/benchmark/${id}/recall`, label: 'Continue to recall', description: 'Benchmark awaiting review' }
      : { to: `/benchmark/${id}/scoring`, label: 'Continue scoring', description: 'Benchmark awaiting review' }
  }
  // running | paused. design.md's Benchmark running screen has no pause, so
  // `paused` is not reachable in practice here — handled the same as
  // `running` regardless, rather than left unhandled.
  return {
    to: `/benchmark/${slotId ?? id}`,
    label: 'Return to your benchmark',
    description: lifecycle === 'paused' ? 'Benchmark paused' : 'Benchmark in progress',
  }
}

const CONTAINER_CLASSES =
  'flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4'
const LINK_CLASSES =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-text)] hover:brightness-95 self-start'

export function ActiveSessionCard({ session, staleNotice = false }: ActiveSessionCardProps) {
  const destination = destinationFor(session)

  return (
    <div className={CONTAINER_CLASSES} data-testid="active-session-card">
      {staleNotice ? (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          This session was updated in another tab
        </p>
      ) : null}
      <p className="text-sm text-[var(--color-text)]">{destination.description}</p>
      <Link className={LINK_CLASSES} to={destination.to}>
        {destination.label}
      </Link>
    </div>
  )
}
