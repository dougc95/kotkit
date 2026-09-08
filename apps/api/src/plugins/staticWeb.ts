/**
 * Serves the built web app from the API process when `WEB_DIST_DIR` is set
 * (3.2.5; design.md D37). Outside `WEB_DIST_DIR` this plugin does nothing at
 * all — every non-`/api` GET keeps getting the 3.2.4 JSON 404 envelope from
 * `errorsPlugin`, unchanged.
 *
 * Registered by `buildApp` after every `/api/v1` plugin, outside that
 * prefix. Two Fastify internals make the registration shape here
 * non-obvious, so both are recorded:
 *
 *  - Every other cross-cutting plugin in this app (db, requestId, noStore,
 *    errors, identity) is wrapped with `fastify-plugin`'s default
 *    `skip-override`, which reuses the exact instance it is handed rather
 *    than forking a child — so a *second* `setNotFoundHandler` call on that
 *    same instance (this plugin's, if it worked the same way) would hit
 *    Fastify's "Not found handler already set" guard, since `errorsPlugin`
 *    already claimed the root handler. This plugin instead passes
 *    `{ encapsulate: true }` to `fp()`, which flips `skip-override` off —
 *    Fastify then forks a real child instance for it, same as any ordinary
 *    (non-`fp`) plugin, while `fp` still gives it a stable name for
 *    introspection.
 *  - That fork only resets the child's own not-found-handler bookkeeping
 *    (`arrange404`) when it is registered with a truthy `prefix` option —
 *    `buildApp` therefore passes `{ prefix: '/' }`. With that fresh
 *    bookkeeping, this plugin's own `setNotFoundHandler` call lands on
 *    Fastify's documented "replace the default (root) 404 handler from a
 *    nested registration" path: it overwrites `errorsPlugin`'s handler in
 *    place rather than throwing, and the replacement covers the whole app
 *    (both `/api/v1/*` and static paths), which is exactly why the handler
 *    below re-implements the JSON 404 envelope for the `isApiPath` case
 *    instead of being able to "fall through" to a second, still-registered
 *    handler — Fastify does not keep one around to fall through to.
 *
 * `@fastify/static` itself is registered with `wildcard: false`: for every
 * file under `dir` (enumerated once at registration) it adds an ordinary,
 * explicitly-routed GET/HEAD handler at that file's own path — `index.html`
 * included, at `/` — so a request for a real built asset (`/assets/app.js`)
 * or `/` is matched by the router directly and never reaches the
 * `setNotFoundHandler` below at all. Only a path with no such file — a
 * client-side route like `/progress` — falls through to it, which is what
 * makes the handler below the SPA fallback for deep links (D37) rather than
 * the thing serving every static file.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import { ConfigError } from '../config.js'
import { NotFoundError, toEnvelope } from '../errors.js'

/**
 * True when `url` (its query string, if any, stripped) is `/api` or starts
 * with `/api/` — the boundary the SPA fallback below must never cross.
 */
export function isApiPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? url
  return path === '/api' || path.startsWith('/api/')
}

/**
 * Resolves `dir` to an absolute path and confirms it holds a built
 * `index.html`. Throws `ConfigError` naming `WEB_DIST_DIR` — never a raw
 * `ENOENT` — when it does not, since a missing build output is a boot-time
 * configuration mistake, not a request-time one.
 */
export function resolveWebDistDir(dir: string): string {
  const resolved = resolve(dir)
  if (!existsSync(join(resolved, 'index.html'))) {
    throw new ConfigError(
      `WEB_DIST_DIR '${dir}' does not contain an index.html. Run the web build first ` +
        `(the resolved path was '${resolved}').`,
    )
  }
  return resolved
}

async function staticWebPlugin(app: FastifyInstance): Promise<void> {
  const { webDistDir } = app.config
  if (webDistDir === undefined) return

  const dir = resolveWebDistDir(webDistDir)

  await app.register(fastifyStatic, { root: dir, prefix: '/', wildcard: false })

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? request.url
    const method = request.raw.method ?? request.method

    if ((method === 'GET' || method === 'HEAD') && !isApiPath(url)) {
      return reply.sendFile('index.html')
    }

    // Every other case (an /api path, or a non-GET/HEAD method) reproduces
    // the identical 3.2.4 JSON 404 envelope — see the file header for why
    // this re-implements rather than delegates to errorsPlugin's own
    // (now-overwritten) handler.
    const route = request.routeOptions?.url ?? null
    const { status, body } = toEnvelope(new NotFoundError())
    request.log.info({ code: body.code, statusCode: status, route }, 'request error')
    return reply.code(status).send({ ...body, requestId: request.id })
  })
}

export default fp(staticWebPlugin, { name: 'staticWeb', encapsulate: true })
