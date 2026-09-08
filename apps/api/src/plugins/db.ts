import fp from 'fastify-plugin'
import postgres, { type Sql } from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'

export type AppDatabase = PostgresJsDatabase<typeof schema>

/**
 * Decorates the Fastify instance with `db` (a Drizzle database bound to the
 * schema barrel) and `sql` (the raw postgres.js tagged-template client the
 * migrator and drizzle both share). `onClose` ends the client so a closed
 * app never leaves an open TCP handle behind (design.md D16; 3.2.1).
 *
 * `postgres(url)` never connects eagerly — the socket opens lazily on the
 * first query — so building the app (and even booting it) never requires a
 * reachable database; only actually running a query does.
 *
 * Registered directly on the root instance in app.ts, never nested inside
 * the `/api/v1`-prefixed route block: `fastify-plugin`'s `skip-override`
 * only reuses the exact instance object it is handed, and prefix-scoped
 * registration always forks a new (prototype-child) instance for that scope
 * before `db` ever runs inside it. Decorating that forked child would never
 * become visible on the true root `app` object returned by `buildApp` — the
 * child's own properties do not climb back up to its parent.
 */
export default fp(
  async function dbPlugin(app) {
    const sql: Sql = postgres(app.config.databaseUrl)
    const db: AppDatabase = drizzle(sql, { schema })

    app.decorate('db', db)
    app.decorate('sql', sql)

    app.addHook('onClose', async () => {
      await sql.end()
    })
  },
  { name: 'db' },
)
