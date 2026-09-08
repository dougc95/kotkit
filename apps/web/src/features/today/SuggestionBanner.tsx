/**
 * `SuggestionBanner` (task 8.2.4; specs/practice-sessions: "Progression
 * suggestion follows the protocol rule" / "Suggestion accepted" / "Two
 * qualifying days" / "Partly output breaks the streak of qualifying days" /
 * "Practice requires a short intended output" / "Hold the target";
 * specs/program-setup: "Protocol settings are immutable revisions";
 * specs/app-shell: "Copy never punishes or gamifies").
 *
 * Rendered by `Today` (8.2.1, an earlier wave) only when `today.suggestion`
 * is present — Today's own placeholder comment marks the exact spot; this
 * file does not import or edit `Today.tsx` itself (file-ownership rule), so
 * the wiring edit is reported separately as a `centralWiringNeeded` item.
 * Every test below mounts `SuggestionBanner` directly with its own props,
 * matching `BlockCard`/`CheckinCard`'s (8.2.2/8.2.3) established
 * standalone-slot testing convention rather than rendering the whole of
 * `Today`.
 *
 * The ceiling and "two qualifying days" rules already ran server-side
 * (`packages/shared/domain/progression.ts`'s `suggestProgression`, task
 * 2.7/2.5/4.5) before `today.suggestion` was ever set — an absent
 * `suggestion` renders nothing here, no client-side re-derivation.
 *
 * Accept posts exactly the revision `apps/api/src/services/program/
 * revisions.ts`'s own header comment documents as "the accept path for a
 * progression suggestion (D33, 8.2.4)": `effectiveDay` equal to the current
 * day, `settings.practiceTargetSeconds` the governing revision's own target
 * plus the fixed protocol step (`PROGRESSION_STEP_SECONDS`, never the
 * suggestion's own precomputed field, so the payload stays correct even if a
 * caller ever passes a `suggestion` slightly stale relative to `revision`),
 * `settings.leisureAllowanceMin` carried through unchanged (never spread
 * from `revision.settings`, which also carries the server-owned
 * `bandCeilings` the request schema's `additionalProperties: false` would
 * 400 on — the same convention `features/settings/ChangePracticeDuration.
 * tsx` already uses), and `reason: PROGRESSION_ACCEPTED_REASON`
 * ('progression accepted'). Success invalidates `['programs','current']`
 * and `['programs', programId, 'today']` so every consumer of either query
 * (BlockCard's target among them) picks up the new revision.
 *
 * Hold makes no request at all — it only sets a per-(programId, day)
 * `sessionStorage` flag ("this visit only": a suggestion recomputed for a
 * *different* day, i.e. a later visit, is keyed differently and reappears
 * unprompted) plus local component state, so a `sessionStorage` failure
 * (a hardened profile, a full quota) never leaves the banner stuck on
 * screen — the local state alone is enough to hide it for this render.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PROGRESSION_ACCEPTED_REASON,
  PROGRESSION_STEP_SECONDS,
  type CreateRevisionBodyValue,
  type RevisionResponseValue,
  type TodayResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'

/** The shape every thrown error carries in both production (`ApiError` subclasses) and the 7.1.1 mock client, read structurally — same convention as `ChangePracticeDuration.tsx`'s `isApiErrorLike`. */
interface ApiErrorLike {
  status: number
  code?: string
  fieldErrors?: Record<string, string | ReadonlyArray<string>>
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as { status?: unknown }).status === 'number'
}

function fieldErrorText(value: string | ReadonlyArray<string> | undefined): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value[0]
  }
  return undefined
}

function heldKey(programId: string, day: number): string {
  return `suggestion-held:${programId}:${day}`
}

/** Best-effort sessionStorage read: storage being unavailable just means the banner starts unheld (never a crash). */
function readHeld(programId: string, day: number): boolean {
  try {
    return sessionStorage.getItem(heldKey(programId, day)) === '1'
  } catch {
    return false
  }
}

/** Best-effort sessionStorage write, mirroring `useFinalizeSession.ts`'s `writeStoredKey` — the caller's own local state is the real source of truth for this render either way. */
function writeHeld(programId: string, day: number): void {
  try {
    sessionStorage.setItem(heldKey(programId, day), '1')
  } catch {
    // Storage unavailable: local component state still hides the banner.
  }
}

export interface SuggestionBannerProps {
  /** `today.suggestion` — `undefined` renders nothing. */
  readonly suggestion: TodayResponseValue['suggestion']
  readonly day: number
  readonly programId: string
  /** The current governing revision (`current.revision`), never `null` when a suggestion exists. */
  readonly revision: RevisionResponseValue
}

export function SuggestionBanner({ suggestion, day, programId, revision }: SuggestionBannerProps) {
  const queryClient = useQueryClient()
  const [held, setHeld] = useState(() => readHeld(programId, day))
  const [error, setError] = useState<string | null>(null)
  const createRevision = useMutation({
    mutationFn: (body: CreateRevisionBodyValue) => api.programs.createRevision(programId, body),
  })

  if (suggestion === undefined || held) {
    return null
  }

  const suggestedMinutes = Math.round(suggestion.suggestedTargetSeconds / 60)

  function handleHold() {
    setHeld(true)
    writeHeld(programId, day)
  }

  async function handleAccept() {
    setError(null)
    const body: CreateRevisionBodyValue = {
      effectiveDay: day,
      settings: {
        practiceTargetSeconds: revision.settings.practiceTargetSeconds + PROGRESSION_STEP_SECONDS,
        leisureAllowanceMin: revision.settings.leisureAllowanceMin,
      },
      reason: PROGRESSION_ACCEPTED_REASON,
    }

    try {
      await createRevision.mutateAsync(body)
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(programId) })
      // The next `today` fetch will stop sending this suggestion once the
      // target has actually moved; hiding it locally in the meantime avoids
      // a stale re-click while that refetch is in flight.
      setHeld(true)
    } catch (thrown) {
      if (isApiErrorLike(thrown) && thrown.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
        setError('This program changed elsewhere. Refresh and try again.')
        return
      }
      if (isApiErrorLike(thrown) && thrown.status === 400) {
        setError(fieldErrorText(thrown.fieldErrors?.reason) ?? 'Could not update. Retry.')
        return
      }
      setError('Could not update. Retry.')
    }
  }

  return (
    <div
      data-testid="suggestion-banner"
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-[var(--color-text)]">{`Ready for +5 minutes? (to ${suggestedMinutes} min)`}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {error !== null ? (
          <p role="alert" className="text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button
            variant="primary"
            disabled={createRevision.isPending}
            onClick={() => {
              void handleAccept()
            }}
          >
            Accept
          </Button>
          <Button variant="secondary" disabled={createRevision.isPending} onClick={handleHold}>
            Hold
          </Button>
        </div>
      </div>
    </div>
  )
}
