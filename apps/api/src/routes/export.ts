/**
 * `/programs/{id}/export` route group (design.md's API contracts table;
 * task 6.3.1 registers `GET` for `format=csv`; task 6.3.2 extends this same
 * handler for `format=markdown`). Strictly read-only — `buildExportModel`
 * never writes a row. `Cache-Control: no-store` is applied to every private
 * `/api/v1/*` response by the global `noStore` plugin (3.2.2); this route is
 * never marked `{ config: { public: true } }`, so nothing route-specific is
 * needed here for that.
 *
 * `format=xml` (or any value outside `ExportQuery`'s `'csv' | 'markdown'`
 * literal union) is rejected by AJV before this handler ever runs — 400
 * `malformed_request`, the same envelope every other malformed request gets
 * (`plugins/errors.ts`, 3.2.4). With both literals now handled below, there
 * is no third branch left for this handler itself to reject.
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  ExportQuery,
  ProgramIdParams,
  type ExportQueryValue,
  type ProgramIdParamsValue,
} from '@attention-lab/shared'

import { buildExportModel } from '../services/export/model.js'
import { buildCsv } from '../services/export/csv.js'
import { buildMarkdown } from '../services/export/markdown.js'

const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: ProgramIdParamsValue; Querystring: ExportQueryValue }>(
    '/programs/:id/export',
    {
      schema: {
        params: ProgramIdParams,
        querystring: ExportQuery,
      },
    },
    async (request, reply) => {
      const { ctx } = request
      const { id: programId } = request.params
      const { format } = request.query

      const model = await buildExportModel(app.db, ctx, programId)

      if (format === 'csv') {
        reply.type('text/csv; charset=utf-8')
        return buildCsv(model)
      }

      reply.type('text/markdown; charset=utf-8')
      return buildMarkdown(model)
    },
  )
}

export default exportRoutes
