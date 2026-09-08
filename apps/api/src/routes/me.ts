/**
 * `GET /me` and `PATCH /me/preferences` (3.5.1; design.md D22, D39 and the
 * API contracts table). Both routes are private (no `config: { public: true
 * }`), so `noStorePlugin` (3.2.2) stamps `Cache-Control: no-store` on every
 * response automatically.
 *
 * Both handlers build the `MeResponse` shape from two sources: `request.ctx`
 * (3.2.3's identity plugin — `principalId`, `identityMode`, `realm`,
 * `demoClockOffsetSeconds`) and the `user_profiles` row for that principal
 * (`timezone`, `preferences` — the identity plugin's `onRequest` hook reads
 * only the demo-clock column, not these, so each handler reads its own
 * copy). The `local-demo` principal row always exists by the time a request
 * reaches here (`ensurePrincipalProfile`'s `onReady` seed) — a missing row is
 * a server bug, surfaced as an unexpected 500 rather than a fabricated
 * response, the same posture `identity.ts`'s own `onRequest` hook takes.
 *
 * Routes are typed with Fastify's own manual per-route generics
 * (`app.get<{ Reply }>`, `app.patch<{ Body; Reply }>`) rather than the
 * `@fastify/type-provider-typebox` automatic-inference path: that package's
 * 6.x line resolves `Static<>` against its own bundled `typebox` package
 * internals, not `@sinclair/typebox` (the package `packages/shared`'s
 * contracts are built with — see design.md D3), and a `Lit()`-built literal
 * union (`RealmSchema`, `IdentityModeSchema`) resolves to `never` under that
 * mismatch. The runtime schemas themselves (plain JSON Schema objects) are
 * unaffected and still drive real AJV validation either way.
 */
import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import {
  MeResponse,
  PatchPreferencesBody,
  type MeResponseValue,
  type PatchPreferencesBodyValue,
} from '@attention-lab/shared'
import { MalformedError } from '../errors.js'
import { isIanaTimeZone, mergePreferences } from '../preferences.js'
import { userProfiles } from '../db/schema/userProfiles.js'
import type { RequestContext } from '../plugins/identity.js'

function toMeResponse(
  ctx: RequestContext,
  profile: { timezone: string; preferences: MeResponseValue['preferences'] },
): MeResponseValue {
  return {
    principalId: ctx.principalId,
    identityMode: ctx.identityMode,
    realm: ctx.realm,
    timezone: profile.timezone,
    preferences: profile.preferences,
    demoClockOffsetSeconds: ctx.demoClockOffsetSeconds,
  }
}

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: MeResponseValue }>(
    '/me',
    { schema: { response: { 200: MeResponse } } },
    async (request) => {
      const { ctx } = request

      const [profile] = await app.db
        .select({ timezone: userProfiles.timezone, preferences: userProfiles.preferences })
        .from(userProfiles)
        .where(eq(userProfiles.id, ctx.principalId))
        .limit(1)

      if (!profile) {
        throw new Error(`user_profiles row missing for principal '${ctx.principalId}'.`)
      }

      return toMeResponse(ctx, profile)
    },
  )

  app.patch<{ Body: PatchPreferencesBodyValue; Reply: MeResponseValue }>(
    '/me/preferences',
    { schema: { body: PatchPreferencesBody, response: { 200: MeResponse } } },
    async (request) => {
      const { ctx } = request
      const patch = request.body

      if (patch.timezone !== undefined && !isIanaTimeZone(patch.timezone)) {
        throw new MalformedError('The request could not be validated.', {
          timezone: 'must be an IANA time zone name',
        })
      }

      const [current] = await app.db
        .select({ timezone: userProfiles.timezone, preferences: userProfiles.preferences })
        .from(userProfiles)
        .where(eq(userProfiles.id, ctx.principalId))
        .limit(1)

      if (!current) {
        throw new Error(`user_profiles row missing for principal '${ctx.principalId}'.`)
      }

      const nextPreferences = mergePreferences(current.preferences, {
        hideTimerDefault: patch.hideTimerDefault,
        endChime: patch.endChime,
        visibilityContext: patch.visibilityContext,
        milestoneAnnouncements: patch.milestoneAnnouncements,
      })
      const nextTimezone = patch.timezone ?? current.timezone

      await app.db
        .update(userProfiles)
        .set({ timezone: nextTimezone, preferences: nextPreferences })
        .where(eq(userProfiles.id, ctx.principalId))

      return toMeResponse(ctx, { timezone: nextTimezone, preferences: nextPreferences })
    },
  )
}

export default meRoutes
