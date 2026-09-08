import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { assertLocalDemoConfig, type AppConfig } from './config.js'
import { createLogger } from './logging.js'
import dbPlugin from './plugins/db.js'
import requestIdPlugin from './plugins/requestId.js'
import requestLogPlugin from './plugins/requestLog.js'
import noStorePlugin from './plugins/noStore.js'
import errorsPlugin from './plugins/errors.js'
import identityPlugin from './plugins/identity.js'
import staticWebPlugin from './plugins/staticWeb.js'
import meRoutes from './routes/me.js'
import demoRoutes from './routes/demo.js'
import programsRoutes from './routes/programs.js'
import sessionsRoutes from './routes/sessions/index.js'
import daysRoutes from './routes/days.js'
import reportRoutes from './routes/report.js'
import exportRoutes from './routes/export.js'
import { registerResearchRoutes } from './routes/research.js'

export interface BuildAppOptions {
  /** A pre-built pino logger (tests wire one that writes into captureLogs). */
  loggerInstance?: Logger
}

/**
 * Builds (but never starts) the Fastify app. `assertLocalDemoConfig` runs
 * first, before Fastify is even constructed: no app, no plugin and no route
 * ever exists outside local-demo mode, whatever a caller who skipped
 * `loadConfig` hands in (defense in depth).
 */
export async function buildApp(
  config: AppConfig,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  assertLocalDemoConfig(config)

  // The privacy-safe logger (3.2.2's createLogger) is the default for every
  // real boot; tests substitute their own instance (writing into
  // captureLogs) via opts.loggerInstance.
  const loggerInstance = opts.loggerInstance ?? createLogger({ level: config.logLevel })

  // Explicit generics: without them, TS infers the `Logger` type parameter
  // from `loggerInstance`'s concrete pino type, which then makes the whole
  // returned instance's type incompatible with the plain `FastifyInstance`
  // this function is declared to return (pino's `Logger` and Fastify's
  // `FastifyBaseLogger` disagree on `childLoggerFactory` under
  // `exactOptionalPropertyTypes`). Forcing `FastifyBaseLogger` here keeps the
  // instance's logger typed the way the rest of the app expects; a concrete
  // pino `Logger` still satisfies it structurally.
  const app = Fastify<Server, IncomingMessage, ServerResponse, FastifyBaseLogger, TypeBoxTypeProvider>({
    genReqId: () => randomUUID(),
    // A client-supplied x-request-id is never trusted as the request id.
    requestIdHeader: false,
    // 3.2.2's requestLog plugin emits the single completion entry per
    // request; Fastify's own per-request logging is disabled here so that
    // stays the only per-request log line.
    disableRequestLogging: true,
    ajv: {
      customOptions: {
        // D22: coercion would turn `null` into `0` for integer schemas,
        // silently violating "unknown != zero". `removeAdditional: false`
        // plus this package's `additionalProperties: false` contracts make
        // an unknown key a 400 instead of a silent drop.
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
        allErrors: true,
        verbose: false,
      },
    },
    loggerInstance,
  })

  app.decorate('config', Object.freeze({ ...config }))

  // Fixed registration order (design.md D16 / 3.1.2): db (3.2.1), then
  // requestId/requestLog/noStore (3.2.2), errors (3.2.4), identity (3.2.3),
  // then the route groups (3.5.x and later). errors registers after
  // requestId/noStore so its envelope-building setErrorHandler/
  // setNotFoundHandler run alongside those two hooks on every response,
  // including error and 404 ones — same reasoning as the block below.
  //
  // The cross-cutting plugins (db, requestId, requestLog, noStore, errors,
  // identity) are registered directly on this root instance, NOT nested
  // inside the `/api/v1` prefix block below: `{ prefix }` always forks a new
  // (prototype-child) instance for that scope, and `fastify-plugin`'s
  // skip-override only reuses whatever instance it is handed — a plugin
  // decorating that forked child would never become visible as `app.db`,
  // `app.config`, etc. on the true root returned from this function. Routes
  // registered inside the prefixed block below still read every one of
  // these decorations fine, since a forked child inherits its parent's
  // properties through the prototype chain — only writes don't climb back
  // up.
  await app.register(dbPlugin)
  await app.register(requestIdPlugin)
  await app.register(requestLogPlugin)
  await app.register(noStorePlugin)
  await app.register(errorsPlugin)
  await app.register(identityPlugin)

  // Route groups (3.5.x and later). Each is registered as its own plugin
  // inside this one prefixed scope so every route group shares the same
  // `/api/v1` prefix without re-declaring it.
  await app.register(
    async (api) => {
      await api.register(meRoutes)
      await api.register(programsRoutes)
      await api.register(sessionsRoutes)
      await api.register(daysRoutes)
      await api.register(reportRoutes)
      await api.register(exportRoutes)
      // 6.4.1: a plain function, not a `FastifyPluginAsync` — see
      // routes/research.ts's own header for why. It registers its one route
      // directly on `api` and throws synchronously (failing this whole
      // registration, and so `buildApp`) if the fixture's sourceUrls are bad.
      registerResearchRoutes(api)
      // 3.5.2: demo-only routes exist only in local-demo mode. demoRoutes
      // (routes/demo.ts) carries its own ConfigError guard as defense in
      // depth, but they are also never registered at all outside demo mode —
      // assertLocalDemoConfig above already guarantees identityMode is
      // 'local-demo' here, so this `if` is always true in practice.
      if (config.identityMode === 'local-demo') {
        await api.register(demoRoutes)
      }
    },
    { prefix: '/api/v1' },
  )

  // 3.2.5, outside the /api/v1 prefix: a no-op unless config.webDistDir is
  // set (see staticWeb.ts's own header for why it needs { prefix: '/' }
  // here, and why that is what lets it replace, rather than collide with,
  // the JSON 404 handler errorsPlugin set above).
  await app.register(staticWebPlugin, { prefix: '/' })

  return app
}
