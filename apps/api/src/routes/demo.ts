/**
 * Demo-only controls (design.md D2, D8, D35; identity-realm "Demo-only
 * controls exist only in demo mode"). `demoRoutes` is a single Fastify
 * plugin shared by every `/demo/*` route in this task group; 3.5.2 adds
 * `POST /demo/clock` here, 3.5.3 and 3.5.4 extend this same file with
 * `POST /demo/reset` and `POST /demo/scenarios/{name}/load`.
 *
 * `buildApp` (app.ts) already refuses to construct outside `local-demo` mode
 * (`assertLocalDemoConfig`) and registers this plugin only inside
 * `if (config.identityMode === 'local-demo')`, so in practice this plugin
 * only ever boots with `identityMode: 'local-demo'`. The guard below —
 * throwing `ConfigError` at registration if `app.config.identityMode !==
 * 'local-demo'` — is defense in depth, mirroring `deriveContext`'s own
 * ConfigError guard in `plugins/identity.ts`: even a hand-built app that
 * skipped that `if` can never end up with these routes registered outside
 * demo mode.
 */
import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'
import { eq } from 'drizzle-orm'
import {
  DemoClockBody,
  DEMO_SCENARIO_NAMES,
  DEMO_SCENARIOS,
  Obj,
  ScenarioLoadResponse,
  type DemoClockBodyValue,
  type DemoScenarioName,
  type ScenarioLoadResponseValue,
} from '@attention-lab/shared'
import { ConfigError } from '../config.js'
import { NotFoundError } from '../errors.js'
import { userProfiles } from '../db/schema/userProfiles.js'
import { deletePrincipalData } from '../db/seed/deletePrincipalData.js'
import { loadScenario } from '../db/seed/loadScenario.js'

/**
 * Not published in `packages/shared/src/contracts` (2.7.2 only defined the
 * request body and the scenario-load response for this route group) — a
 * small closed object built with the same `Obj` helper every other contract
 * in the barrel uses, kept local to this route since nothing else needs it.
 */
const DemoClockResponse = Obj({
  demoClockOffsetSeconds: Type.Integer(),
})
interface DemoClockResponseValue {
  demoClockOffsetSeconds: number
}

/**
 * 3.5.4's own membership check against `DEMO_SCENARIO_NAMES` (the eight PRD
 * §6 scenarios; 2.7.2's `ScenarioLoadParams`) — deliberately NOT wired in as
 * this route's Fastify `params` schema, since an AJV schema failure becomes
 * 400 `malformed_request` (`plugins/errors.ts`) and an unknown scenario name
 * is specified to be 404 `not_found` instead (this task's own brief; D19).
 * A `Set` rather than the `as const` array's own `.includes` sidesteps that
 * array's literal-union element type rejecting a plain `string` argument at
 * the type level.
 */
const DEMO_SCENARIO_NAME_SET: ReadonlySet<string> = new Set(DEMO_SCENARIO_NAMES)

function isDemoScenarioName(value: string): value is DemoScenarioName {
  return DEMO_SCENARIO_NAME_SET.has(value)
}

const demoRoutes: FastifyPluginAsync = async (app) => {
  if (app.config.identityMode !== 'local-demo') {
    throw new ConfigError(
      "demoRoutes requires identityMode 'local-demo'; demo-only controls do not exist otherwise " +
        '(see LIMITATIONS.md).',
    )
  }

  /**
   * D35: `offsetSeconds` is an ABSOLUTE offset from real time, never a delta
   * added to whatever offset is already stored. The identity plugin's
   * `onRequest` hook (3.2.3) re-reads this column on every request, so it is
   * the *next* request's `ctx.now` / `ctx.timeSource` that reflects this
   * write (D8) — nothing client-side is ever trusted for time.
   */
  app.post<{ Body: DemoClockBodyValue; Reply: DemoClockResponseValue }>(
    '/demo/clock',
    { schema: { body: DemoClockBody, response: { 200: DemoClockResponse } } },
    async (request) => {
      const { ctx } = request
      const { offsetSeconds } = request.body

      await app.db
        .update(userProfiles)
        .set({ demoClockOffsetSeconds: offsetSeconds })
        .where(eq(userProfiles.id, ctx.principalId))

      return { demoClockOffsetSeconds: offsetSeconds }
    },
  )

  /**
   * 3.5.3: `deletePrincipalData` (D34, D35) runs in one transaction and the
   * route returns 204 with no body. No `Idempotency-Key` is required — the
   * D19/API-contracts table does not mark this route `(IK)`, and running it
   * twice in a row is itself idempotent (a second reset on an empty state is
   * still a clean 204). The log line carries the per-table counts
   * `deletePrincipalData` returns and nothing else — never row content
   * (identity-realm "Private data is never written to logs or stored
   * insecurely").
   */
  app.post('/demo/reset', async (request, reply) => {
    const { ctx } = request

    const counts = await app.db.transaction((tx) => deletePrincipalData(tx, ctx))

    request.log.info({ counts }, 'demo reset')

    return reply.code(204).send()
  })

  /**
   * 3.5.4: `name` is checked against `DEMO_SCENARIO_NAMES` by hand (see
   * `isDemoScenarioName` above) rather than by a Fastify `params` schema, so
   * an unrecognized name is 404 `not_found`, not 400. D22: this route takes
   * no body at all — the UI confirms replacement before calling it, and
   * whatever a caller sends in the body is never read. `loadScenario`
   * (3.5.4) runs `deletePrincipalData` (3.5.3) and the scenario's full row
   * set in one transaction, so a scenario load is atomic: either the
   * principal's demo data is fully replaced, or (on any error) nothing
   * changes at all.
   */
  app.post<{ Params: { name: string }; Reply: ScenarioLoadResponseValue }>(
    '/demo/scenarios/:name/load',
    { schema: { response: { 200: ScenarioLoadResponse } } },
    async (request) => {
      const { ctx } = request
      const { name } = request.params

      if (!isDemoScenarioName(name)) {
        throw new NotFoundError()
      }
      const scenario = DEMO_SCENARIOS[name]

      return app.db.transaction((tx) => loadScenario(tx, ctx, scenario))
    },
  )
}

export default demoRoutes
