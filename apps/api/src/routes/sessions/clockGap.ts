/**
 * `POST /sessions/{id}/clock-gap` (task 5.5.1; design.md D18, D19, D20, D25,
 * D26). The handler stays thin, same convention as
 * `routes/sessions/transitions.ts`: the route's own TypeBox `schema` is the
 * only check made here — every other check (the ownership 404, the
 * terminal-lifecycle 409, the three-resolution patch, the `save_incomplete`
 * end-transition mechanics) lives in `services/session.ts`'s
 * `resolveClockGap`. No `Idempotency-Key` header: design.md's API contracts
 * table does not mark this route `(IK)`.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  ClockGapBody,
  SessionIdParams,
  SessionResponse,
  type ClockGapBodyValue,
  type SessionIdParamsValue,
  type SessionResponseValue,
} from '@attention-lab/shared'
import { resolveClockGap } from '../../services/session.js'

const clockGapRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: ClockGapBodyValue; Reply: SessionResponseValue }>(
    '/sessions/:id/clock-gap',
    {
      schema: {
        params: SessionIdParams,
        body: ClockGapBody,
        response: { 200: SessionResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return resolveClockGap(app.db, ctx, request.params.id, request.body)
    },
  )
}

export default clockGapRoute
