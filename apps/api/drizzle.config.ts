import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs as a separate process from the API, so the API scripts'
// `--env-file-if-exists` flag does not reach it. Load <repo root>/.env
// ourselves; an already-set env var wins over the file (matches
// process.loadEnvFile's own precedence).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (see .env.example) to run drizzle-kit')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
