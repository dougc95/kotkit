import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const here = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(here, '..')
const migrationsFolder = resolve(apiRoot, 'src/db/migrations')
const journalPath = resolve(migrationsFolder, 'meta/_journal.json')

export function parseDatabaseName(url: string): string {
  const parsed = new URL(url)
  const name = parsed.pathname.replace(/^\//, '')
  if (!name) throw new Error(`No database name found in URL: ${url}`)
  return name
}

export function maintenanceUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = '/postgres'
  return parsed.toString()
}

export async function bootstrapTestDb(env: NodeJS.ProcessEnv): Promise<void> {
  const testUrl = env.DATABASE_URL_TEST
  if (!testUrl) {
    throw new Error('DATABASE_URL_TEST must be set (see .env.example) to bootstrap the test database')
  }

  const testName = parseDatabaseName(testUrl)

  if (env.DATABASE_URL) {
    const devName = parseDatabaseName(env.DATABASE_URL)
    if (testName === devName) {
      throw new Error(
        `DATABASE_URL_TEST must name a different database from DATABASE_URL (both resolve to "${testName}"); ` +
          'the test suite truncates its tables between test files.',
      )
    }
  }

  if (!testName.endsWith('_test')) {
    throw new Error(`DATABASE_URL_TEST's database name must end in "_test" (got "${testName}")`)
  }

  const maintenanceClient = postgres(maintenanceUrl(testUrl), { max: 1 })
  try {
    const rows = await maintenanceClient/*sql*/`select 1 from pg_database where datname = ${testName}`
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE "${testName}"`)
    } else {
      console.log('already exists')
    }
  } finally {
    await maintenanceClient.end()
  }

  if (existsSync(journalPath)) {
    const testClient = postgres(testUrl, { max: 1 })
    try {
      const db = drizzle(testClient)
      await migrate(db, { migrationsFolder })
    } finally {
      await testClient.end()
    }
  } else {
    console.log('no migrations yet')
  }

  console.log(`test database ${testName} ready`)
}

function isEntryModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  return moduleUrl === pathToFileURL(argv1).href
}

if (isEntryModule(import.meta.url, process.argv[1])) {
  bootstrapTestDb(process.env).catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
