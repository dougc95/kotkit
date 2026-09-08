/**
 * `GET /sessions/{id}` (task 5.2.2; design.md D20, D24). The handler stays
 * thin, same convention as `routes/sessions/start.ts`: the route's own
 * TypeBox `schema` is the only check made here — every other check (the
 * ownership 404, the D20 response shape) lives in `services/session.ts`'s
 * `readSession`. Strictly read-only: no lifecycle change ever happens on this
 * path, and `Cache-Control: no-store` comes from the 3.2.2 `noStore` plugin
 * on every `/api/v1/*` route, not from anything registered here.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  SessionIdParams,
  SessionResponse,
  type SessionIdParamsValue,
  type SessionResponseValue,
} from '@attention-lab/shared'
import { readSession } from '../../services/session.js'

const readRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: SessionIdParamsValue; Reply: SessionResponseValue }>(
    '/sessions/:id',
    {
      schema: {
        params: SessionIdParams,
        response: { 200: SessionResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return readSession(app.db, ctx, request.params.id)
    },
  )
}

export default readRoute
