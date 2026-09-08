/**
 * `POST /sessions/{id}/recall` (task 5.7.2; design.md D10, D18, D19, D20,
 * D21, D25, D27). The handler stays thin, same convention as
 * `routes/sessions/start.ts`: contract validation (the route's own TypeBox
 * `schema`) and the `Idempotency-Key` header shape (3.4.1's
 * `requireIdempotencyKey` preHandler) are the only checks made here; every
 * other check and every write lives in `services/review.ts`'s `lockRecall`.
 *
 * Unlike `POST /sessions`, this route always responds 200 — a first
 * successful lock and a replay of an unchanged, already-locked review are
 * both 200 (recall locks an existing `session_reviews` row rather than
 * creating a new resource, so D21's 201-then-200 convention does not apply
 * here).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  RecallBody,
  ReviewResponse,
  SessionIdParams,
  type RecallBodyValue,
  type ReviewResponseValue,
  type SessionIdParamsValue,
} from '@attention-lab/shared'
import { requireIdempotencyKey } from '../../idempotency/keyHook.js'
import { lockRecall } from '../../services/review.js'

const recallRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: RecallBodyValue; Reply: ReviewResponseValue }>(
    '/sessions/:id/recall',
    {
      schema: {
        params: SessionIdParams,
        body: RecallBody,
        response: { 200: ReviewResponse },
      },
      preHandler: requireIdempotencyKey,
    },
    async (request) => {
      const { ctx } = request

      // requireIdempotencyKey (preHandler) has already guaranteed this is a
      // UUID string before the handler ever runs.
      const key = request.idempotencyKey!

      const { review } = await lockRecall(app.db, ctx, request.params.id, request.body, key)
      return review
    },
  )
}

export default recallRoute
