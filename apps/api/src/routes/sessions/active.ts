/**
 * `GET /sessions/active` (task 5.2.3; design.md D20, D24). Returns the
 * principal's single unfinished session — `lifecycle IN (running, paused,
 * awaiting_review)`, at most one by the 3.3 partial unique index — loaded
 * exactly as 5.2.2's `readSession` loads `GET /sessions/{id}`
 * (`loadSessionForResponse`, D16: one owner per shared piece), so the D20
 * shape is byte-for-byte identical between the two routes and the client's
 * reload path (D17) renders either response the same way. None found -> 204
 * with an empty body. Strictly read-only (D24): no write happens on this
 * path. `Cache-Control: no-store` comes from the 3.2.2 `noStore` plugin on
 * every `/api/v1/*` response, 204 included (its `onSend` hook runs
 * regardless of status code) — nothing extra is set here.
 *
 * Registered in `routes/sessions/index.ts` BEFORE the `/sessions/:id` route
 * so the literal path segment `active` is matched by this route and never
 * parsed as a `SessionIdParams.id` (which would otherwise 400 on the `Uuid`
 * format check before ever reaching this handler).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { Type } from '@sinclair/typebox'
import { SessionResponse } from '@attention-lab/shared'
import type { FastifyPluginAsync } from 'fastify'

import { focusSessions } from '../../db/schema/focusSessions.js'
import { loadSessionForResponse } from '../../services/session.js'

/** The three lifecycles that make a session "unfinished" (3.3's partial unique index) — same list `services/session.ts` uses. */
const ACTIVE_LIFECYCLES = ['running', 'paused', 'awaiting_review'] as const

const activeRoute: FastifyPluginAsync = async (app) => {
  // No explicit `Reply` generic: unlike every other session route this one
  // legitimately sends two different shapes (a 200 `SessionResponse` body or
  // an empty 204), so it is typed the same untyped way `routes/demo.ts`'s
  // `POST /demo/reset` is — the `response: { 200: ... }` schema still
  // validates and serializes the 200 case at runtime.
  app.get(
    '/sessions/active',
    {
      // 204 (D20: "none -> 204") gets its own empty schema alongside the 200
      // shape so `reply.code(204)` type-checks; Fastify's own `204`
      // special-casing (no `content-length`, no body) applies regardless of
      // what the schema says once no payload is passed to `.send()`.
      schema: {
        response: { 200: SessionResponse, 204: Type.Null() },
      },
    },
    async (request, reply) => {
      const { ctx } = request

      const [row] = await app.db
        .select({ id: focusSessions.id })
        .from(focusSessions)
        .where(and(eq(focusSessions.userId, ctx.principalId), inArray(focusSessions.lifecycle, ACTIVE_LIFECYCLES)))
        .limit(1)

      if (row === undefined) {
        return reply.code(204).send()
      }

      return loadSessionForResponse(app.db, row.id, ctx.now)
    },
  )
}

export default activeRoute
