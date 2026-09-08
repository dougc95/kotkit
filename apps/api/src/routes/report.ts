/**
 * `/programs/{id}/report` route (design.md's API contracts table; task
 * 6.2.1). Strictly read-only — `buildReport` never writes a row.
 * `Cache-Control: no-store` is applied to every private `/api/v1/*` response
 * by the global `noStore` plugin (3.2.2), so nothing route-specific is
 * needed here for that.
 *
 * `warnings[]` (6.2.3), `practice[]` and `days[]` (6.2.4) are all now part
 * of `buildReport`'s own return value — this route's own job is only to
 * validate params and shape the response against `ReportResponse`.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  ProgramIdParams,
  ReportResponse,
  type ProgramIdParamsValue,
  type ReportResponseValue,
} from '@attention-lab/shared'
import { buildReport } from '../services/report/index.js'

const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: ProgramIdParamsValue; Reply: ReportResponseValue }>(
    '/programs/:id/report',
    {
      schema: {
        params: ProgramIdParams,
        response: { 200: ReportResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return buildReport(app.db, ctx, request.params.id)
    },
  )
}

export default reportRoutes
