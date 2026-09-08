/**
 * `POST /sessions/{id}/events` (task 5.3.1; design.md D9, D20, D21, D26). The
 * handler stays thin, same convention as `routes/sessions/read.ts`: the
 * route's own TypeBox `schema` (the 1..100-item batch, the client event-type
 * enum that excludes `pause`/`resume`) is the only check made here — every
 * other check (ownership, the impossible-offset and companion-field 422s, the
 * dedupe insert, the reconciliation warning) lives in `services/session.ts`'s
 * `appendEvents`. No `Idempotency-Key` header: this route dedupes by each
 * event's own `clientEventId` (D9), not by a receipt.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  EventsBatchBody,
  EventsBatchResponse,
  SessionIdParams,
  type EventsBatchBodyValue,
  type EventsBatchResponseValue,
  type SessionIdParamsValue,
} from '@attention-lab/shared'
import { appendEvents } from '../../services/session.js'

const eventsRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: SessionIdParamsValue; Body: EventsBatchBodyValue; Reply: EventsBatchResponseValue }>(
    '/sessions/:id/events',
    {
      schema: {
        params: SessionIdParams,
        body: EventsBatchBody,
        response: { 200: EventsBatchResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return appendEvents(app.db, ctx, request.params.id, request.body.events)
    },
  )
}

export default eventsRoute
