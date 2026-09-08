import type { FastifyInstance } from 'fastify'

/**
 * `GET /api/v1/__test/ctx`: returns the identity plugin's `request.ctx`
 * (3.2.3) plus the real wall-clock `Date.now()` (as `realNowMs`), so a test
 * can compute how far the demo clock has advanced `ctx.now` past real time.
 * Defined once here — not re-declared per test file (design.md D16) — so
 * 3.2.3's own identity.test.ts and 3.5.2's demoClock.test.ts both register
 * it via `registerCtxTestRoute` instead of each declaring their own copy.
 *
 * Routes must be registered before `app.ready()` — same constraint every
 * other test-only route in this codebase follows (see errors.test.ts's
 * `buildErrorsTestApp`, headers.test.ts's `buildHeaderTestApp`).
 */
export async function registerCtxTestRoute(app: FastifyInstance): Promise<void> {
  await app.register(
    async (instance) => {
      instance.get('/__test/ctx', async (request) => ({
        ...request.ctx,
        realNowMs: Date.now(),
      }))
    },
    { prefix: '/api/v1' },
  )
}
