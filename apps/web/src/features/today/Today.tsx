import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { LoadingState } from '../../ui/LoadingState.js'
import { ErrorState } from '../../ui/ErrorState.js'
import { NextAction } from './NextAction.js'
import { BlockCard } from './BlockCard.js'
import { CheckinCard } from './CheckinCard.js'
import { SuggestionBanner } from './SuggestionBanner.js'
import { ActiveSessionCard } from './ActiveSessionCard.js'

/**
 * The shape every thrown error carries in both production (`ApiError`
 * subclasses, `lib/api/errors.ts`) and the 7.1.1 mock client
 * (`mockClient.ts`'s `reject()`) — read structurally by `.status`, never via
 * `instanceof` (same convention `features/setup/PlanForm.tsx` uses), so both
 * work identically.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return (error as { status?: unknown }).status === 404
}

/**
 * Focuses the next block's start form (BlockCard, task 8.2.2) rather than
 * navigating — the `practice` next action's whole point (practice-sessions:
 * "Returning user can start in three actions"). Looks for a focusable
 * control inside the block-index container Today renders below
 * (`[data-block-index="N"]`), which BlockCard now fills with a real form.
 */
function focusBlockStartForm(block: 1 | 2): void {
  const container = document.querySelector<HTMLElement>(`[data-block-index="${block}"]`)
  const focusable = container?.querySelector<HTMLElement>('input, textarea, button, [tabindex]')
  focusable?.focus()
}

function RetryNotice({ onRetry }: { readonly onRetry: () => void }) {
  return <ErrorState onRetry={onRetry}>Today could not be loaded</ErrorState>
}

type DayPosition = 'past' | 'today' | 'ahead'

function dayPosition(trackDay: number, currentDay: number): DayPosition {
  if (trackDay < currentDay) {
    return 'past'
  }
  if (trackDay === currentDay) {
    return 'today'
  }
  return 'ahead'
}

/**
 * Position-only progress track: past, today or ahead, derived from
 * `today.day` alone. `GET /programs/{id}/today` returns no per-day history,
 * so this never reads `checkin` or `blocks` and must not imply a day was
 * recorded or missed — it is not a streak. `aria-hidden` because it carries
 * no information the "Day N of 14" heading does not already state
 * accessibly.
 */
function DayPositionTrack({ day }: { readonly day: number }) {
  const days = Array.from({ length: 14 }, (_, index) => index + 1)

  return (
    <ol aria-hidden="true" data-testid="day-position-track" className="flex items-center gap-1">
      {days.map((trackDay) => (
        <li
          key={trackDay}
          data-position={dayPosition(trackDay, day)}
          className="h-1.5 flex-1 rounded-full bg-rule data-[position=past]:bg-ink-muted data-[position=today]:h-2.5 data-[position=today]:bg-signal"
        />
      ))}
    </ol>
  )
}

/**
 * The Today frame (task 8.2.1; practice-sessions: "Today shows one next
 * action and two blocks"), mounted at `/today` under `RailLayout`.
 *
 * Two queries, run in sequence per the brief: `GET /programs/current`
 * decides whether a program exists at all (`nextAction.kind === 'setup'`,
 * or the request itself 404s — either one redirects to `/setup`, D22's
 * no-program shape and this task's own validation note both send that
 * case away from here rather than rendering an empty frame for it); once a
 * `programId` is known, `GET /programs/{id}/today` supplies everything
 * else — the header's `day`, the two blocks, the check-in summary and the
 * per-day `nextAction` `NextAction` renders. The header's "Day N of 14"
 * always comes from that server `day` field — this component never reads
 * `Date.now()`/`new Date()` itself, so a skewed browser clock cannot move
 * it (CLAUDE.md: no client-computed measurement).
 *
 * Two BlockCard slots (8.2.2), the CheckinCard slot (8.2.3), the
 * SuggestionBanner slot (8.2.4) and the ActiveSessionCard override (8.2.5)
 * are wired in below.
 */
export function Today() {
  const currentQuery = useQuery({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
  })

  const current = currentQuery.data
  const programId = current?.program?.id
  const isSetupAction = current?.nextAction.kind === 'setup'

  const todayQuery = useQuery({
    queryKey: queryKeys.programs.today(programId ?? ''),
    queryFn: () => api.programs.today(programId as string),
    enabled: programId !== undefined && !isSetupAction,
  })

  const activeQuery = useActiveSession()

  const retryBoth = () => {
    void currentQuery.refetch()
    if (programId !== undefined) {
      void todayQuery.refetch()
    }
  }

  if (currentQuery.isPending) {
    return <LoadingState>Loading</LoadingState>
  }

  if (currentQuery.isError || current === undefined) {
    if (isNotFound(currentQuery.error)) {
      return <Navigate to="/setup" replace />
    }
    return <RetryNotice onRetry={retryBoth} />
  }

  if (current.nextAction.kind === 'setup') {
    return <Navigate to="/setup" replace />
  }

  if (programId === undefined) {
    // Data inconsistency guard: D22 only omits `program` when nextAction is
    // 'setup', already handled above — this should be unreachable in
    // practice.
    return <RetryNotice onRetry={retryBoth} />
  }

  if (todayQuery.isPending) {
    return <LoadingState>Loading</LoadingState>
  }

  if (todayQuery.isError || todayQuery.data === undefined) {
    return <RetryNotice onRetry={retryBoth} />
  }

  const today = todayQuery.data

  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-rule pb-4">
        <h1 className="text-lg font-semibold text-ink">{`Day ${today.day} of 14`}</h1>
      </header>

      <section aria-label="Next action" className="flex flex-col gap-3">
        {activeQuery.data ? (
          <ActiveSessionCard session={activeQuery.data} />
        ) : (
          <NextAction
            nextAction={today.nextAction}
            programId={programId}
            slots={current.slots}
            onFocusBlock={focusBlockStartForm}
          />
        )}
      </section>

      <DayPositionTrack day={today.day} />

      {current.revision !== null ? (
        <SuggestionBanner
          suggestion={today.suggestion}
          day={today.day}
          programId={programId}
          revision={current.revision}
        />
      ) : null}

      <section aria-label="Practice blocks">
        {today.blocks.map((block) => (
          <div
            key={block.index}
            data-testid="block-card-slot"
            data-block-index={block.index}
            className="border-b border-rule last:border-b-0"
          >
            <BlockCard
              block={block}
              target={block.targetSeconds}
              isNext={today.nextAction.kind === 'practice' && today.nextAction.block === block.index}
              programId={programId}
            />
          </div>
        ))}
      </section>

      <section aria-label="Check-in">
        <CheckinCard programId={programId} localDate={today.localDate} checkin={today.checkin} />
      </section>
    </div>
  )
}
