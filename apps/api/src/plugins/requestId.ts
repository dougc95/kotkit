import fp from 'fastify-plugin'

/**
 * Sets `x-request-id` on every response — success, error and unmatched
 * (404) alike, since `onSend` still runs for those. The value is always
 * `request.id`, the id `genReqId` generated in app.ts (`requestIdHeader:
 * false` there means a client-supplied `x-request-id` is never trusted or
 * echoed back — this hook always overwrites it).
 */
export default fp(
  async function requestIdPlugin(app) {
    app.addHook('onSend', async (request, reply, payload) => {
      reply.header('x-request-id', request.id)
      return payload
    })
  },
  { name: 'requestId' },
)
