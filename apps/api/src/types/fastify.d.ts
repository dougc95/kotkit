// Fastify instance decorations. `config` is added by 3.1.2's `buildApp`; the
// `db`/`sql` decorations are added by 3.2.1's db plugin — see design.md D16.
import type { Sql } from 'postgres'
import type { AppConfig } from '../config.js'
import type { AppDatabase } from '../plugins/db.js'
import type { RequestContext } from '../plugins/identity.js'

declare module 'fastify' {
  interface FastifyInstance {
    readonly config: AppConfig
    readonly db: AppDatabase
    readonly sql: Sql
  }

  // 3.2.3's identity plugin decorates every request with its own ctx
  // (principal, realm, demo clock) on `onRequest`, before any route handler
  // runs.
  //
  // 3.4.1's `requireIdempotencyKey` preHandler sets `idempotencyKey` on the
  // (IK)-marked routes it runs on; every other request never has it set, so
  // it is optional.
  interface FastifyRequest {
    ctx: RequestContext
    idempotencyKey?: string
  }

  // 3.2.2's noStore plugin: a route opts out of the default
  // `Cache-Control: no-store` by declaring `config: { public: true }` (only
  // `GET /research/cards`, 6.4.1, does).
  interface FastifyContextConfig {
    public?: boolean
  }
}

export {}
