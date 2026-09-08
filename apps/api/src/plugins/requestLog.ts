import fp from 'fastify-plugin'

/**
 * Exactly one structured log entry per request: method, url, the matched
 * route pattern (`null` when nothing matched), status and duration — the
 * observability NFR (request id, route, status, duration; `reqId` itself is
 * Fastify's own per-request logger binding, not repeated here). Fastify's
 * built-in request logging is disabled in app.ts (`disableRequestLogging:
 * true`) so this `onResponse` hook is the only per-request line — never a
 * per-tick one.
 */
export default fp(
  async function requestLogPlugin(app) {
    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          method: request.method,
          url: request.url,
          route: request.routeOptions?.url ?? null,
          statusCode: reply.statusCode,
          responseTime: reply.elapsedTime,
        },
        'request completed',
      )
    })
  },
  { name: 'requestLog' },
)
