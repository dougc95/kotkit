/**
 * `POST /sessions/{id}/transitions` (task 5.4.2; design.md D18, D19, D20,
 * D24, D29). The handler stays thin, same convention as
 * `routes/sessions/read.ts` and `routes/sessions/events.ts`: the route's own
 * TypeBox `schema` is the only check made here — every other check (the
 * ownership 404, the terminal-lifecycle 409, the stale-version 409, the
 * `applyTransition` 422, the pause/resume event insert, the D20 response
 * shape) lives in `services/session.ts`'s `transitionSession`. No
 * `Idempotency-Key` header: design.md's API contracts table does not mark
 * this route `(IK)` — optimistic `expectedVersion` locking (D18) is its own
 * concurrency guard.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  SessionIdParams,
  SessionResponse,
  TransitionBody,
  type SessionIdParamsValue,
  type SessionResponseValue,
  type TransitionBodyValue,
} from '@attention-lab/shared'
import { transitionSession } from '../../services/session.js'

const transitionsRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: TransitionBodyValue; Reply: SessionResponseValue }>(
    '/sessions/:id/transitions',
    {
      schema: {
        params: SessionIdParams,
        body: TransitionBody,
        response: { 200: SessionResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return transitionSession(app.db, ctx, request.params.id, request.body)
    },
  )
}

export default transitionsRoute
