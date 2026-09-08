/**
 * `GET /me` and `PATCH /me/preferences` (see design.md's API contracts
 * table). The fixed demo principal's identity, timezone and preferences.
 */
import { Type, type Static } from '@sinclair/typebox'

import { IdentityModeSchema, Obj, RealmSchema } from './common.js'

/**
 * `milestoneAnnouncements` is D22/D39: a preference, default `false`, that
 * gates the 5:00 and 0:00 timer announcements — added here, not inferred
 * from any other field, so it must always be present on the wire.
 */
export const PreferencesSchema = Obj({
  hideTimerDefault: Type.Boolean(),
  endChime: Type.Boolean(),
  visibilityContext: Type.Boolean(),
  milestoneAnnouncements: Type.Boolean(),
})
export type PreferencesValue = Static<typeof PreferencesSchema>

export const MeResponse = Obj({
  principalId: Type.String(),
  identityMode: IdentityModeSchema,
  realm: RealmSchema,
  timezone: Type.String(),
  preferences: PreferencesSchema,
  demoClockOffsetSeconds: Type.Integer(),
})
export type MeResponseValue = Static<typeof MeResponse>

export const PatchPreferencesBody = Obj({
  timezone: Type.Optional(Type.String()),
  hideTimerDefault: Type.Optional(Type.Boolean()),
  endChime: Type.Optional(Type.Boolean()),
  visibilityContext: Type.Optional(Type.Boolean()),
  milestoneAnnouncements: Type.Optional(Type.Boolean()),
})
export type PatchPreferencesBodyValue = Static<typeof PatchPreferencesBody>
