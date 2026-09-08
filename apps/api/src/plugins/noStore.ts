import fp from 'fastify-plugin'

const API_PREFIX = '/api/v1'

/**
 * `Cache-Control: no-store` on every `/api/v1/*` response — including
 * unmatched (404) routes and error responses, since `onSend` still runs for
 * those — unless the matched route opts out with `config: { public: true }`
 * (only `GET /research/cards`, 6.4.1, does; every other route is private).
 * Static web responses (3.2.5) live outside `/api/v1` and are never touched
 * here: for an unmatched request `routeOptions.url` is `undefined`, so the
 * raw `request.url` (which still starts with `/api/v1` for a 404 under this
 * prefix) is the fallback.
 */
export default fp(
  async function noStorePlugin(app) {
    app.addHook('onSend', async (request, reply, payload) => {
      const path = request.routeOptions?.url ?? request.url
      const isPublic = request.routeOptions?.config?.public === true
      if (path.startsWith(API_PREFIX) && !isPublic) {
        reply.header('cache-control', 'no-store')
      }
      return payload
    })
  },
  { name: 'noStore' },
)
