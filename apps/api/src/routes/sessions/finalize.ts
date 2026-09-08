/**
 * `POST /sessions/{id}/finalize` (task 5.8.1; design.md D18, D19, D20, D21,
 * D24). The handler stays thin, same convention as `routes/sessions/recall.ts`:
 * contract validation (the route's own TypeBox `schema`, which is what turns
 * a body carrying `eligible`/`exclusionReasons`/`points`/`realm` into 400
 * `malformed_request` via `additionalProperties: false`) and the
 * `Idempotency-Key` header shape (3.4.1's `requireIdempotencyKey`
 * preHandler) are the only checks made here; every other check and every
 * write lives in `services/review.ts`'s `finalizeSession`.
 *
 * Like `POST /sessions/{id}/recall`, this always responds 200 (finalize acts
 * on an existing session/review rather than creating a new resource, so
 * D21's 201-then-200 convention does not apply here).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  FinalizeBody,
  FinalizeResponse,
  SessionIdParams,
  type FinalizeBodyValue,
  type FinalizeResponseValue,
  type SessionIdParamsValue,
} from '@attention-lab/shared'
import { requireIdempotencyKey } from '../../idempotency/keyHook.js'
import { finalizeSession } from '../../services/review.js'

const finalizeRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: FinalizeBodyValue; Reply: FinalizeResponseValue }>(
    '/sessions/:id/finalize',
    {
      schema: {
        params: SessionIdParams,
        body: FinalizeBody,
        response: { 200: FinalizeResponse },
      },
      preHandler: requireIdempotencyKey,
    },
    async (request) => {
      const { ctx } = request

      // requireIdempotencyKey (preHandler) has already guaranteed this is a
      // UUID string before the handler ever runs.
      const key = request.idempotencyKey!

      const { result } = await finalizeSession(app.db, ctx, request.params.id, request.body, key)
      return result
    },
  )
}

export default finalizeRoute
