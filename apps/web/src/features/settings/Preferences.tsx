import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MeResponseValue, PatchPreferencesBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { EditMaterialsLink } from './EditMaterialsLink.js'
import { PreferenceSwitch } from './PreferenceSwitch.js'
import { listTimezones, TimezoneSelect } from './TimezoneSelect.js'

/**
 * Settings' Preferences section (task 8.9.2; design.md D22, D38, D39).
 * Mounted by `Settings.tsx` with the already-loaded `GET /me` value — this
 * component owns everything else: the five-field draft, the
 * `PATCH /me/preferences` mutation, and its own `GET /programs/current`
 * fetch used only to decide whether `EditMaterialsLink` renders (the brief's
 * "State" list keeps that query local to this component, not Settings, so
 * mounting `<Preferences me={...}/>` directly — this file's whole test
 * surface, `Preferences.test.tsx` — exercises both queries and the mutation
 * without needing `Settings.tsx` or any router table).
 *
 * Nothing is sent until Save (CLAUDE.md's habit of never mutating on every
 * keystroke, and the brief's explicit "nothing is sent until Save"): a
 * `committedRef` snapshot — seeded once from `me` on mount and updated only
 * from a successful mutation response — is diffed against the live `draft`
 * state to build the PATCH body, so Save always sends exactly the fields
 * that differ from the last known-saved values, never the whole form.
 */
export interface PreferencesProps {
  readonly me: MeResponseValue
}

interface DraftPreferences {
  readonly timezone: string
  readonly hideTimerDefault: boolean
  readonly endChime: boolean
  readonly milestoneAnnouncements: boolean
  readonly visibilityContext: boolean
}

function toDraft(me: MeResponseValue): DraftPreferences {
  return {
    timezone: me.timezone,
    hideTimerDefault: me.preferences.hideTimerDefault,
    endChime: me.preferences.endChime,
    milestoneAnnouncements: me.preferences.milestoneAnnouncements,
    visibilityContext: me.preferences.visibilityContext,
  }
}

/** Only the fields where `draft` differs from `committed` — an empty object when there is nothing to save. */
function diffDraft(committed: DraftPreferences, draft: DraftPreferences): PatchPreferencesBodyValue {
  const body: PatchPreferencesBodyValue = {}
  if (draft.timezone !== committed.timezone) {
    body.timezone = draft.timezone
  }
  if (draft.hideTimerDefault !== committed.hideTimerDefault) {
    body.hideTimerDefault = draft.hideTimerDefault
  }
  if (draft.endChime !== committed.endChime) {
    body.endChime = draft.endChime
  }
  if (draft.milestoneAnnouncements !== committed.milestoneAnnouncements) {
    body.milestoneAnnouncements = draft.milestoneAnnouncements
  }
  if (draft.visibilityContext !== committed.visibilityContext) {
    body.visibilityContext = draft.visibilityContext
  }
  return body
}

/** The shape every thrown error carries in both production (`ApiError` subclasses) and the 7.1.1 mock client (`mockClient.ts`'s `reject()`) — read structurally, matching `features/setup/PlanForm.tsx`'s convention. */
interface ApiErrorLike {
  status: number
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

export function Preferences({ me }: PreferencesProps) {
  const queryClient = useQueryClient()

  // Seeded once per mount; a later `me` prop change (e.g. Settings'
  // `['me']` query refetching after this component's own mutation
  // succeeds) never resets an in-progress edit — `committedRef` is instead
  // kept in step directly from the mutation's own response below.
  const committedRef = useRef<DraftPreferences>(toDraft(me))
  const [draft, setDraft] = useState<DraftPreferences>(committedRef.current)
  const [timezoneError, setTimezoneError] = useState<string | undefined>(undefined)
  const [saveFailed, setSaveFailed] = useState(false)

  const zonesRef = useRef<string[] | null>(null)
  if (zonesRef.current === null) {
    zonesRef.current = listTimezones(me.timezone)
  }

  // Used only to decide whether `EditMaterialsLink` renders (D38); no other
  // part of this screen reads it, so a pending or failed fetch simply keeps
  // the link hidden rather than blocking or erroring the rest of the form.
  const programQuery = useQuery({ queryKey: queryKeys.programs.current, queryFn: api.programs.current })
  const programStatus = programQuery.data?.program?.status ?? null

  const patchPreferences = useMutation({
    mutationFn: (body: PatchPreferencesBodyValue) => api.me.patchPreferences(body),
    onSuccess: (data) => {
      committedRef.current = toDraft(data)
      setDraft(committedRef.current)
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })

  const pendingBody = diffDraft(committedRef.current, draft)
  const dirty = Object.keys(pendingBody).length > 0

  async function handleSave() {
    if (!dirty) {
      return
    }
    setTimezoneError(undefined)
    setSaveFailed(false)

    try {
      await patchPreferences.mutateAsync(pendingBody)
    } catch (error) {
      if (isApiErrorLike(error) && error.status === 400) {
        const text = fieldErrorText(error.fieldErrors?.timezone)
        if (text !== undefined) {
          setTimezoneError(text)
          return
        }
      }
      setSaveFailed(true)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void handleSave()
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Preferences" className="flex flex-col gap-6">
      <TimezoneSelect
        value={draft.timezone}
        zones={zonesRef.current}
        onChange={(value) => {
          setDraft((prev) => ({ ...prev, timezone: value }))
        }}
        {...(timezoneError !== undefined ? { error: timezoneError } : {})}
      />

      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        <PreferenceSwitch
          label="Hide timer by default"
          description="Starts sessions with the countdown hidden. You can still reveal it any time."
          checked={draft.hideTimerDefault}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, hideTimerDefault: checked }))
          }}
        />
        <PreferenceSwitch
          label="End-of-block chime"
          description="Plays a sound when a block's time is reached."
          checked={draft.endChime}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, endChime: checked }))
          }}
        />
        <PreferenceSwitch
          label="Milestone timer announcements"
          description="Announces 5:00 and 0:00 remaining; no other timer sounds change."
          checked={draft.milestoneAnnouncements}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, milestoneAnnouncements: checked }))
          }}
        />
        <PreferenceSwitch
          label="Record tab-visibility context"
          description="Adds a visibility note to your sessions. It is never counted as an episode."
          checked={draft.visibilityContext}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, visibilityContext: checked }))
          }}
        />
      </div>

      <EditMaterialsLink programStatus={programStatus} />

      {saveFailed ? (
        <p role="alert" className="text-sm">
          Could not save. Retry.
        </p>
      ) : null}

      <Button type="submit" disabled={!dirty || patchPreferences.isPending}>
        Save preferences
      </Button>
    </form>
  )
}
