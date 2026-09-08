import { connect } from 'node:net'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function spawnServerWithoutRequiredSettings() {
  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.API_HOST
  delete env.API_PORT
  delete env.IDENTITY_MODE

  // No --env-file flag: a .env file at the repo root, if present, is never read here.
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env,
    encoding: 'utf8',
  })
}

describe('boot refusal (real process)', () => {
  it('exits with code 1', () => {
    const result = spawnServerWithoutRequiredSettings()
    expect(result.status).toBe(1)
  })

  it('stderr names every missing setting and .env.example', () => {
    const result = spawnServerWithoutRequiredSettings()
    for (const needle of ['DATABASE_URL', 'API_HOST', 'API_PORT', 'IDENTITY_MODE', '.env.example']) {
      expect(result.stderr).toContain(needle)
    }
  })

  it('stdout never contains "listening"', () => {
    const result = spawnServerWithoutRequiredSettings()
    expect(result.stdout).not.toContain('listening')
  })

  it('a TCP connect to 127.0.0.1:8787 is refused after exit', async () => {
    spawnServerWithoutRequiredSettings()

    await new Promise<void>((resolvePromise, reject) => {
      const socket = connect({ host: '127.0.0.1', port: 8787 })
      socket.once('connect', () => {
        socket.destroy()
        reject(new Error('connection unexpectedly succeeded'))
      })
      socket.once('error', (err: NodeJS.ErrnoException) => {
        expect(err.code).toBe('ECONNREFUSED')
        resolvePromise()
      })
    })
  })
})
