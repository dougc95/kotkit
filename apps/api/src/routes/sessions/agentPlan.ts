/**
 * `PUT /sessions/{id}/agent-plan` (task 5.6.1; design.md D16, D18, D19,
 * D20). The handler stays thin, same convention as
 * `routes/sessions/clockGap.ts` and `routes/sessions/transitions.ts`: the
 * route's own TypeBox `schema` is the only check made here (including the
 * D19 `malformed_request` for a body carrying a credential/output/log field
 * — `AgentPlanBody` already rejects unknown properties via `Obj`'s
 * `additionalProperties: false`) — every other check (ownership 404, the
 * 422 `practice_only` kind gate, the 409 `session_not_active` lifecycle
 * gate, the optimistic-`expectedVersion` upsert and its 409 `stale_version`)
 * lives in `services/session.ts`'s `putAgentPlan`. No `Idempotency-Key`
 * header: design.md's API contracts table does not mark this route `(IK)` —
 * `expectedVersion` is its own concurrency guard, same as `transitions`.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  AgentPlanBody,
  AgentPlanResponse,
  SessionIdParams,
  type AgentPlanBodyValue,
  type AgentPlanResponseValue,
  type SessionIdParamsValue,
} from '@attention-lab/shared'
import { putAgentPlan } from '../../services/session.js'

const agentPlanRoute: FastifyPluginAsync = async (app) => {
  app.put<{ Params: SessionIdParamsValue; Body: AgentPlanBodyValue; Reply: AgentPlanResponseValue }>(
    '/sessions/:id/agent-plan',
    {
      schema: {
        params: SessionIdParams,
        body: AgentPlanBody,
        response: { 200: AgentPlanResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return putAgentPlan(app.db, ctx, request.params.id, request.body)
    },
  )
}

export default agentPlanRoute
