/**
 * `POST /sessions/{id}/amendments` (task 5.9.1; design.md D32). The handler
 * stays thin, same convention as `routes/sessions/void.ts`: the route's own
 * TypeBox `schema` is the only check made here — every other check
 * (ownership, the finalized-lifecycle gate) lives in `services/review.ts`'s
 * `addAmendment`. No `Idempotency-Key` header (the design.md API contract
 * table carries no `(IK)` marker for this route) and no update or delete
 * route exists: every successful call appends a genuinely new row, so this
 * always responds 201.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  AmendmentBody,
  AmendmentResponse,
  SessionIdParams,
  type AmendmentBodyValue,
  type AmendmentResponseValue,
  type SessionIdParamsValue,
} from '@attention-lab/shared'
import { addAmendment } from '../../services/review.js'

const amendmentsRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: AmendmentBodyValue; Reply: AmendmentResponseValue }>(
    '/sessions/:id/amendments',
    {
      schema: {
        params: SessionIdParams,
        body: AmendmentBody,
        response: { 201: AmendmentResponse },
      },
    },
    async (request, reply) => {
      const { ctx } = request
      const amendment = await addAmendment(app.db, ctx, request.params.id, request.body)
      reply.code(201)
      return amendment
    },
  )
}

export default amendmentsRoute
