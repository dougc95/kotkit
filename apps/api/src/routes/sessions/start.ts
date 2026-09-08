/**
 * `POST /sessions` — practice start (task 5.1.1; design.md D6, D20, D21).
 * The handler stays thin, same convention as `routes/programs.ts`: contract
 * validation (the route's own TypeBox `schema`) and the `Idempotency-Key`
 * header shape (3.4.1's `requireIdempotencyKey` preHandler) are the only
 * checks made here; every other check and every write lives in
 * `services/session.ts`'s `startSession` (5.1.1).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  CreateSessionBody,
  SessionResponse,
  type CreateSessionBodyValue,
  type SessionResponseValue,
} from '@attention-lab/shared'
import { requireIdempotencyKey } from '../../idempotency/keyHook.js'
import { startSession } from '../../services/session.js'

const startRoute: FastifyPluginAsync = async (app) => {
  /**
   * D21: 201 on the first write, 200 with a freshly re-serialized session on
   * replay (same `Idempotency-Key` + same request content) — `startSession`
   * reports which one this call was via `replayed`.
   */
  app.post<{ Body: CreateSessionBodyValue; Reply: SessionResponseValue }>(
    '/sessions',
    {
      schema: {
        body: CreateSessionBody,
        response: { 200: SessionResponse, 201: SessionResponse },
      },
      preHandler: requireIdempotencyKey,
    },
    async (request, reply) => {
      const { ctx } = request

      // requireIdempotencyKey (preHandler) has already guaranteed this is a
      // UUID string before the handler ever runs.
      const key = request.idempotencyKey!

      const { replayed, session } = await startSession(app.db, ctx, request.body, key)

      reply.code(replayed ? 200 : 201)
      return session
    },
  )
}

export default startRoute
