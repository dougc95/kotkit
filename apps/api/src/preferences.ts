/**
 * The one source of truth for preference defaults (D15, D22, D39). The API
 * reads no `DEFAULT_HIDE_TIMER` / `DEFAULT_END_CHIME` /
 * `DEFAULT_VISIBILITY_CONTEXT` environment variables — the `DEFAULT_*` lines
 * in `.env.example` are documentation only. Created here (ahead of 3.2.3)
 * because the principal profile is seeded with this object before 3.5.1's
 * `GET /me` route exists.
 */
import type { PreferencesValue } from '@attention-lab/shared'

export const DEFAULT_PREFERENCES = {
  hideTimerDefault: false,
  endChime: false,
  visibilityContext: false,
  milestoneAnnouncements: false,
} as const

/**
 * IANA time zone validity (3.5.1): membership in the runtime's own
 * `Intl.supportedValuesOf('timeZone')` list, or exactly `'UTC'` — `'UTC'` is
 * the placeholder value `ensurePrincipalProfile` seeds before Setup confirms
 * a real zone, and some ICU builds omit it from `supportedValuesOf`, so it is
 * accepted unconditionally rather than depending on that. Deliberately
 * case-sensitive (`'utc'` is rejected): a wire value is never
 * case-normalized before being stored or compared.
 */
export function isIanaTimeZone(tz: string): boolean {
  if (tz === 'UTC') return true
  return (Intl.supportedValuesOf('timeZone') as string[]).includes(tz)
}

/**
 * A patch of preference fields whose optional keys may be present with an
 * explicit `undefined` value, as they are once read off a TypeBox `Static<>`
 * optional property — under `exactOptionalPropertyTypes`, `Partial<
 * PreferencesValue>` alone (`{ key?: boolean }`) would reject assigning such
 * a value; this mapped type spells out `PreferencesValue[K] | undefined` so
 * that assignment type-checks.
 */
export type PreferencesPatch = {
  [K in keyof PreferencesValue]?: PreferencesValue[K] | undefined
}

/**
 * Merges `patch` into `current`: a key absent from `patch`, or present with
 * value `undefined`, keeps `current`'s value; every other key in `patch`
 * overrides it. Never mutates either input.
 */
export function mergePreferences(
  current: PreferencesValue,
  patch: PreferencesPatch,
): PreferencesValue {
  const merged: PreferencesValue = { ...current }
  for (const key of Object.keys(patch) as (keyof PreferencesValue)[]) {
    const value = patch[key]
    if (value !== undefined) {
      merged[key] = value
    }
  }
  return merged
}
