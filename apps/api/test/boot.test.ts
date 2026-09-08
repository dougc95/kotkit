import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_TIMEOUT = 15000

/**
 * Every setting `loadConfig` cares about, deleted from a copy of the parent
 * env before any override is applied — so a case never inherits IDENTITY_MODE
 * (or anything else config-related) from this test process's own env, which
 * setup/env.ts has already populated from the repo root `.env`.
 */
const CONTROLLED_KEYS = [
  'DATABASE_URL',
  'API_HOST',
  'API_PORT',
  'IDENTITY_MODE',
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'AUTH_INVITE_ALLOWLIST',
  'WEB_ORIGIN',
  'WEB_DIST_DIR',
  'LOG_LEVEL',
] as const

function buildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of CONTROLLED_KEYS) delete env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function runServer(overrides: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: buildEnv(overrides),
    encoding: 'utf8',
    timeout: TEST_TIMEOUT,
  })
}

describe('boot (real process)', () => {
  it(
    '(a) IDENTITY_MODE unset -> exit 1, stderr names IDENTITY_MODE and both accepted values, nothing listening',
    () => {
      const result = runServer({
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
        API_HOST: '127.0.0.1',
        API_PORT: '18787',
        IDENTITY_MODE: undefined,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('IDENTITY_MODE')
      expect(result.stderr).toContain('local-demo, real')
      expect(result.stdout).not.toContain('listening')
    },
    TEST_TIMEOUT,
  )

  it(
    '(b) IDENTITY_MODE=pilot -> exit 1, stderr lists the accepted values',
    () => {
      const result = runServer({
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
        API_HOST: '127.0.0.1',
        API_PORT: '18787',
        IDENTITY_MODE: 'pilot',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('local-demo')
      expect(result.stderr).toContain('real')
      expect(result.stdout).not.toContain('listening')
    },
    TEST_TIMEOUT,
  )

  it(
    '(c) local-demo + API_HOST=0.0.0.0 -> exit 1, stderr warns demo mode must never be exposed on a network interface',
    () => {
      const result = runServer({
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
        API_HOST: '0.0.0.0',
        API_PORT: '18787',
        IDENTITY_MODE: 'local-demo',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('demo mode must never be exposed on a network interface')
      expect(result.stdout).not.toContain('listening')
    },
    TEST_TIMEOUT,
  )

  it(
    '(d) real with no secrets -> exit 1, stderr lists all four prerequisites plus the refusal text',
    () => {
      const result = runServer({
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
        API_HOST: '127.0.0.1',
        API_PORT: '18787',
        IDENTITY_MODE: 'real',
      })
      expect(result.status).toBe(1)
      for (const needle of [
        'AUTH_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'AUTH_INVITE_ALLOWLIST',
        'not yet implemented',
        'LIMITATIONS.md',
      ]) {
        expect(result.stderr).toContain(needle)
      }
      expect(result.stdout).not.toContain('listening')
    },
    TEST_TIMEOUT,
  )

  it(
    '(e) real with all four dummy values -> exit 1, no listening line',
    () => {
      const result = runServer({
        DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
        API_HOST: '127.0.0.1',
        API_PORT: '18787',
        IDENTITY_MODE: 'real',
        AUTH_SECRET: 'dummy',
        GOOGLE_CLIENT_ID: 'dummy',
        GOOGLE_CLIENT_SECRET: 'dummy',
        AUTH_INVITE_ALLOWLIST: 'dummy@example.com',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('not yet implemented')
      expect(result.stderr).toContain('LIMITATIONS.md')
      expect(result.stdout).not.toContain('listening')
    },
    TEST_TIMEOUT,
  )

  it(
    '(f) local-demo on 127.0.0.1:0 with the real test database listens, accepts a TCP connect, then shuts down on SIGTERM',
    async () => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: apiDir,
        env: buildEnv({
          DATABASE_URL: process.env.DATABASE_URL_TEST,
          API_HOST: '127.0.0.1',
          API_PORT: '0',
          IDENTITY_MODE: 'local-demo',
        }),
      })

      let stdout = ''
      const port = await new Promise<number>((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for a listening line; stdout so far: ${stdout}`))
        }, TEST_TIMEOUT - 2000)

        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
          const match = /127\.0\.0\.1:(\d+)/.exec(stdout)
          if (match?.[1]) {
            clearTimeout(timer)
            resolvePromise(Number(match[1]))
          }
        })
        child.once('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`server exited early with code ${code}; stdout: ${stdout}`))
        })
      })

      await new Promise<void>((resolvePromise, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => {
          socket.destroy()
          resolvePromise()
        })
        socket.once('error', reject)
      })

      const exitCode = await new Promise<number | null>((resolvePromise) => {
        child.once('exit', (code) => resolvePromise(code))
        child.kill('SIGTERM')
      })

      if (process.platform !== 'win32') {
        // D40: graceful shutdown (SIGTERM -> app.close() -> exit 0) is
        // verified on POSIX only.
        expect(exitCode).toBe(0)
      } else {
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      }

      await new Promise<void>((resolvePromise, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => {
          socket.destroy()
          reject(new Error('connection unexpectedly succeeded after shutdown'))
        })
        socket.once('error', (err: NodeJS.ErrnoException) => {
          expect(err.code).toBe('ECONNREFUSED')
          resolvePromise()
        })
      })
    },
    TEST_TIMEOUT,
  )
})
