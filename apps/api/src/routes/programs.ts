/**
 * `/programs` route group (design.md's API contracts table). Task 4.1.2
 * registers only `POST /programs`, the first program write — `GET
 * /programs/current`, `PATCH /programs/{id}`, `PUT
 * /programs/{id}/benchmark-slots`, `POST /programs/{id}/revisions` and `GET
 * /programs/{id}/today` arrive in later group-4 tasks and are added to this
 * same file.
 *
 * The handler stays thin: idempotency-key shape (3.4.1's
 * `requireIdempotencyKey` preHandler) and IANA timezone confirmation
 * (3.5.1's one `isIanaTimeZone` helper — no second helper is written here)
 * are the only checks made in the route itself; every write, including the
 * idempotency-ledger dance, lives in `programService.ts`'s `createProgram`
 * (4.1.2).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  CreateProgramBody,
  CreateRevisionBody,
  CurrentProgramResponse,
  Obj,
  PatchProgramBody,
  ProgramIdParams,
  ProgramResponse,
  PutSlotsBody,
  PutSlotsResponse,
  RevisionResponse,
  TodayResponse,
  type CreateProgramBodyValue,
  type CreateRevisionBodyValue,
  type CurrentProgramResponseValue,
  type PatchProgramBodyValue,
  type ProgramIdParamsValue,
  type ProgramResponseValue,
  type PutSlotsBodyValue,
  type PutSlotsResponseValue,
  type RevisionResponseValue,
  type TodayResponseValue,
} from '@attention-lab/shared'
import { requireIdempotencyKey } from '../idempotency/keyHook.js'
import { MalformedError } from '../errors.js'
import { isIanaTimeZone } from '../preferences.js'
import { createProgram, getCurrentProgram, getToday, replaceBenchmarkSlots } from '../services/program/programService.js'
import { patchProgram } from '../services/program/patch.js'
import { createRevision } from '../services/program/revisions.js'

/**
 * Not published in `packages/shared/src/contracts` — 2.7.3 only defined the
 * single-program (`ProgramResponse`) and single-revision (`RevisionResponse`)
 * shapes this task's brief names; the `{ program, revision }` envelope this
 * one route returns is assembled locally with the same `Obj` helper every
 * other contract file uses, the same way `routes/demo.ts`'s
 * `DemoClockResponse` is local to its own route.
 */
const CreateProgramResponse = Obj({ program: ProgramResponse, revision: RevisionResponse })
interface CreateProgramResponseValue {
  program: ProgramResponseValue
  revision: RevisionResponseValue
}

/**
 * Not published in `packages/shared/src/contracts` either, same reasoning as
 * `CreateProgramResponse` above — `POST /programs/{id}/revisions`'s own
 * `{ revision, program }` envelope (design.md API contracts table).
 */
const CreateRevisionResponse = Obj({ revision: RevisionResponse, program: ProgramResponse })
interface CreateRevisionResponseValue {
  revision: RevisionResponseValue
  program: ProgramResponseValue
}

/**
 * Not published in `packages/shared/src/contracts` either, same reasoning
 * as `CreateProgramResponse` above — `PATCH /programs/{id}`'s own
 * `{ program }` envelope (design.md API contracts table; task 4.4.2).
 */
const PatchProgramResponse = Obj({ program: ProgramResponse })
interface PatchProgramResponseValue {
  program: ProgramResponseValue
}

const programsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * D21: 201 on the first write, 200 with an identical body on replay (same
   * `Idempotency-Key` + same request content) — `createProgram` reports
   * which one this call was via `replayed`. `baselineDate` is unbounded
   * (past dates are how tests and demo scenarios reach later program days,
   * D22), so nothing here re-checks it against "today".
   */
  app.post<{ Body: CreateProgramBodyValue; Reply: CreateProgramResponseValue }>(
    '/programs',
    {
      schema: {
        body: CreateProgramBody,
        response: { 200: CreateProgramResponse, 201: CreateProgramResponse },
      },
      preHandler: requireIdempotencyKey,
    },
    async (request, reply) => {
      const { ctx } = request
      const body = request.body

      if (!isIanaTimeZone(body.timezone)) {
        throw new MalformedError('The request could not be validated.', {
          timezone: 'must be an IANA time zone name',
        })
      }

      // requireIdempotencyKey (preHandler) has already guaranteed this is a
      // UUID string before the handler ever runs.
      const key = request.idempotencyKey!

      const { replayed, program, revision } = await createProgram(app.db, ctx, body, key)

      reply.code(replayed ? 200 : 201)
      return { program, revision }
    },
  )

  /**
   * `GET /programs/current` (design.md D22, D23; task 4.2.3). Strictly
   * read-only — `getCurrentProgram` never writes a row. Registered as a
   * static path segment before `/programs/:id/...` below; Fastify's router
   * matches a literal segment ahead of a parametric one regardless of
   * registration order, so `current` can never be swallowed by `:id`.
   */
  app.get<{ Reply: CurrentProgramResponseValue }>(
    '/programs/current',
    {
      schema: {
        response: { 200: CurrentProgramResponse },
      },
    },
    async (request) => {
      return getCurrentProgram(app.db, request.ctx)
    },
  )

  /**
   * `PATCH /programs/{id}` (design.md D18, D19, D33; task 4.4.2). No
   * `Idempotency-Key` (not marked (IK) in the API contracts table — a
   * retried PATCH with a now-stale `expectedVersion` simply 409s, which is
   * the intended behavior for a version-guarded partial update).
   * `patchProgram` (4.4.2) does every check — ownership, version, terminal
   * status, the draft-only date-edit gate, the D33 status-transition table
   * — inside its own transaction; the handler here stays a thin
   * pass-through. The contract's `status` literal is already narrowed to
   * `'completed' | 'archived'` (`'active'`, `'draft'` and `'baseline_ready'`
   * are 400 before this ever runs) and `additionalProperties: false`
   * already rejects a body carrying `timezone` (immutable after creation)
   * or `realm`/`userId`.
   */
  app.patch<{ Params: ProgramIdParamsValue; Body: PatchProgramBodyValue; Reply: PatchProgramResponseValue }>(
    '/programs/:id',
    {
      schema: {
        params: ProgramIdParams,
        body: PatchProgramBody,
        response: { 200: PatchProgramResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return patchProgram(app.db, ctx, request.params.id, request.body)
    },
  )

  /**
   * D22/D34: atomic replace, no `Idempotency-Key` (not marked (IK) in the API
   * contracts table — a retried PUT with the same body and a stale
   * `expectedVersion` simply 409s, which is the intended behavior for a
   * form-save action). `replaceBenchmarkSlots` (4.3.2) does every check —
   * ownership, version, terminal status, the readiness validator, the freeze
   * rule, the readiness-regression guard — inside its own transaction; the
   * handler here stays a thin pass-through.
   */
  app.put<{ Params: ProgramIdParamsValue; Body: PutSlotsBodyValue; Reply: PutSlotsResponseValue }>(
    '/programs/:id/benchmark-slots',
    {
      schema: {
        params: ProgramIdParams,
        body: PutSlotsBody,
        response: { 200: PutSlotsResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return replaceBenchmarkSlots(app.db, ctx, request.params.id, request.body)
    },
  )

  /**
   * `POST /programs/{id}/revisions` (design.md D33; task 4.4.1). No
   * `Idempotency-Key` (not marked (IK) in the API contracts table) and no
   * `expectedVersion` in the body — `createRevision` (4.4.1) does every
   * check (ownership, terminal status, the reason, the effective-day gate)
   * inside its own transaction and always appends rather than overwrites, so
   * a retried POST simply creates another revision. Registered as 201 only:
   * this route has no replay path to return 200 from. There is no update or
   * delete route for a revision (PATCH/PUT/DELETE on this path are simply
   * unregistered and fall through to Fastify's own 404).
   */
  app.post<{ Params: ProgramIdParamsValue; Body: CreateRevisionBodyValue; Reply: CreateRevisionResponseValue }>(
    '/programs/:id/revisions',
    {
      schema: {
        params: ProgramIdParams,
        body: CreateRevisionBody,
        response: { 201: CreateRevisionResponse },
      },
    },
    async (request, reply) => {
      const { ctx } = request
      const result = await createRevision(app.db, ctx, request.params.id, request.body)
      reply.code(201)
      return result
    },
  )

  /**
   * `GET /programs/{id}/today` (design.md D22; task 4.5.3). Strictly
   * read-only — `getToday` never writes a row. `getToday` (4.5.3) does every
   * check (ownership, realm) and every derivation (blocks, check-in status
   * and values, the progression suggestion, `nextAction`) inside itself; the
   * handler here stays a thin pass-through, same shape as `GET
   * /programs/current` above.
   */
  app.get<{ Params: ProgramIdParamsValue; Reply: TodayResponseValue }>(
    '/programs/:id/today',
    {
      schema: {
        params: ProgramIdParams,
        response: { 200: TodayResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      return getToday(app.db, ctx, request.params.id)
    },
  )
}

export default programsRoutes
