/**
 * Identity context plugin (design.md D2, D8, D34): the fixed `local-demo`
 * principal, the server-side demo clock and the realm/ownership guards every
 * service uses instead of ever reading env or trusting a client-supplied
 * identity header.
 *
 * `buildApp` (app.ts) already refuses to construct outside `local-demo` mode
 * (`assertLocalDemoConfig`), so in practice this plugin only ever runs with
 * `identityMode: 'local-demo'`; `deriveContext`'s own ConfigError guard is
 * defense in depth and lets the derivation itself be unit-tested without a
 * running app.
 *
 * See identity-realm: "Local-demo mode uses a single fixed principal and
 * binds only to loopback", "Every user-owned record carries a realm", "Every
 * resource is scoped to its owner", "Demo-only controls exist only in demo
 * mode".
 */
import fp from 'fastify-plugin'
import { eq } from 'drizzle-orm'
import type { Realm } from '@attention-lab/shared'
import { REALM_MISMATCH_MESSAGE } from '@attention-lab/shared'
import { ConfigError, type IdentityMode } from '../config.js'
import { DomainError, NotFoundError } from '../errors.js'
import { DEFAULT_PREFERENCES } from '../preferences.js'
import { userProfiles } from '../db/schema/userProfiles.js'
import type { AppDatabase } from './db.js'

/** The one principal id that exists in `local-demo` mode. */
export const LOCAL_DEMO_PRINCIPAL_ID = 'local-demo'

/**
 * Every route and service reads identity/time/realm from this, never from
 * `process.env` or a request header. Decorated onto `request.ctx` by the
 * `onRequest` hook below; see `apps/api/src/types/fastify.d.ts`.
 */
export interface RequestContext {
  principalId: string
  realm: Realm
  identityMode: IdentityMode
  now: Date
  demoClockOffsetSeconds: number
  timeSource: 'measured' | 'demo_clock'
}

export interface DeriveContextInput {
  identityMode: IdentityMode
  offsetSeconds: number
  realNow: Date
}

/**
 * Pure derivation (D8): `now` is the demo-advanced clock, never the client's
 * own clock. `timeSource` is `'measured'` only when the offset is exactly
 * zero — any nonzero offset (including negative) means a record created
 * under it is `'demo_clock'`, per the task brief and D8.
 */
export function deriveContext(input: DeriveContextInput): RequestContext {
  const { identityMode, offsetSeconds, realNow } = input

  if (identityMode !== 'local-demo') {
    throw new ConfigError(
      `deriveContext requires identityMode 'local-demo'; real mode is not implemented yet ` +
        `(see LIMITATIONS.md); got '${identityMode}'.`,
    )
  }

  return {
    principalId: LOCAL_DEMO_PRINCIPAL_ID,
    realm: 'demo',
    identityMode,
    now: new Date(realNow.getTime() + offsetSeconds * 1000),
    demoClockOffsetSeconds: offsetSeconds,
    timeSource: offsetSeconds === 0 ? 'measured' : 'demo_clock',
  }
}

/**
 * Idempotent principal seed (`ON CONFLICT (id) DO NOTHING`): called once from
 * the plugin's `onReady` hook so a freshly-migrated database always has the
 * one `local-demo` row before the first request, and again from
 * `buildTestApp.truncateAll()` (test/helpers/buildTestApp.ts) so a suite that
 * truncates between tests never has to re-seed the principal by hand. The
 * timezone default ('UTC') is a placeholder until Setup (task group 4)
 * confirms one via `PATCH /me/preferences`.
 */
export async function ensurePrincipalProfile(db: AppDatabase): Promise<void> {
  await db
    .insert(userProfiles)
    .values({
      id: LOCAL_DEMO_PRINCIPAL_ID,
      timezone: 'UTC',
      preferences: DEFAULT_PREFERENCES,
      demoClockOffsetSeconds: 0,
    })
    .onConflictDoNothing({ target: userProfiles.id })
}

/** D34: the `{ userId, realm }` pair every insert on a realm-root table stamps. */
export function ownerStamp(ctx: RequestContext): { userId: string; realm: Realm } {
  return { userId: ctx.principalId, realm: ctx.realm }
}

/**
 * Throws when a loaded row's realm differs from the request's own realm — a
 * pilot row can never be created or read while running in local-demo mode.
 * The message is the fixed, realm-blind D19 message; realm values are never
 * echoed back to the client.
 */
export function assertOwnRealm(ctx: RequestContext, realm: Realm): void {
  if (realm !== ctx.realm) {
    throw new DomainError('realm_mismatch', REALM_MISMATCH_MESSAGE)
  }
}

/**
 * The ownership guard every service uses for an owned resource: a row
 * belonging to someone else is reported as `NotFoundError` (404), never a
 * 403 — existence of another principal's record is never disclosed
 * (identity-realm "Every resource is scoped to its owner").
 */
export function assertOwnedBy(ctx: RequestContext, row: { user_id: string }): void {
  if (row.user_id !== ctx.principalId) {
    throw new NotFoundError()
  }
}

/**
 * Registered directly on the root instance in app.ts, after `db` (design.md
 * D16) — same reasoning as every other cross-cutting plugin there: nested
 * inside a prefixed scope, its decorations would never climb back to the
 * root instance app.ts returns.
 */
export default fp(
  async function identityPlugin(app) {
    app.addHook('onReady', async () => {
      await ensurePrincipalProfile(app.db)
    })

    // Client-supplied `x-principal-id` / `x-realm` headers are never read
    // here (or anywhere else) — the fixed principal and its stored offset
    // are the only inputs to `request.ctx`.
    app.addHook('onRequest', async (request) => {
      const [profile] = await app.db
        .select({ demoClockOffsetSeconds: userProfiles.demoClockOffsetSeconds })
        .from(userProfiles)
        .where(eq(userProfiles.id, LOCAL_DEMO_PRINCIPAL_ID))
        .limit(1)

      if (!profile) {
        // A missing profile row is a server bug, never a silent default —
        // this becomes an unexpected 500 through the errors plugin (3.2.4),
        // not a fabricated 'local-demo' context.
        throw new Error(
          `user_profiles row missing for principal '${LOCAL_DEMO_PRINCIPAL_ID}'.`,
        )
      }

      request.ctx = deriveContext({
        identityMode: app.config.identityMode,
        offsetSeconds: profile.demoClockOffsetSeconds,
        realNow: new Date(),
      })
    })
  },
  { name: 'identity' },
)
