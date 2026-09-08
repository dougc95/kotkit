/**
 * `POST /sessions/{id}/events/{clientEventId}/void` (task 5.3.2; design.md
 * D9, D19, D28). The handler stays thin, same convention as
 * `routes/sessions/read.ts` and `routes/sessions/events.ts`: the route's own
 * TypeBox `schema` (both path params are UUIDs) is the only check made here —
 * every other check (ownership, the finalized-immutability 409, the
 * pause/resume-refusal 422, the idempotent already-voided replay) lives in
 * `services/session.ts`'s `voidEvent`. No `Idempotency-Key` header: a void is
 * addressed by the event's own `clientEventId`, already unique per session
 * (D9), and is naturally idempotent on its own.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  EventIdParams,
  EventResponse,
  type EventIdParamsValue,
  type EventResponseValue,
} from '@attention-lab/shared'
import { voidEvent } from '../../services/session.js'

const voidRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: EventIdParamsValue; Reply: EventResponseValue }>(
    '/sessions/:id/events/:clientEventId/void',
    {
      schema: {
        params: EventIdParams,
        response: { 200: EventResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return voidEvent(app.db, ctx, request.params.id, request.params.clientEventId)
    },
  )
}

export default voidRoute
