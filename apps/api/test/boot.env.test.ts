import { describe, expect, it } from 'vitest'
import { formatRefusal, validateRequiredSettings } from '../src/server.js'

describe('validateRequiredSettings', () => {
  it('empty env -> ok:false with missing in declared order', () => {
    const result = validateRequiredSettings({})
    expect(result).toEqual({
      ok: false,
      missing: ['DATABASE_URL', 'API_HOST', 'API_PORT', 'IDENTITY_MODE'],
    })
  })

  it('env lacking only IDENTITY_MODE -> missing = [IDENTITY_MODE]', () => {
    const result = validateRequiredSettings({
      DATABASE_URL: 'postgres://x',
      API_HOST: '127.0.0.1',
      API_PORT: '8787',
    })
    expect(result).toEqual({ ok: false, missing: ['IDENTITY_MODE'] })
  })

  it('API_PORT="abc" -> missing includes API_PORT', () => {
    const result = validateRequiredSettings({
      DATABASE_URL: 'postgres://x',
      API_HOST: '127.0.0.1',
      API_PORT: 'abc',
      IDENTITY_MODE: 'local-demo',
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.missing).toContain('API_PORT')
  })

  it('complete env -> ok:true with apiPort parsed as the number 8787', () => {
    const result = validateRequiredSettings({
      DATABASE_URL: 'postgres://x',
      API_HOST: '127.0.0.1',
      API_PORT: '8787',
      IDENTITY_MODE: 'local-demo',
    })
    expect(result).toEqual({
      ok: true,
      settings: {
        databaseUrl: 'postgres://x',
        apiHost: '127.0.0.1',
        apiPort: 8787,
        identityMode: 'local-demo',
      },
    })
  })

  it('no default value is substituted for IDENTITY_MODE (absent stays absent, never local-demo)', () => {
    const result = validateRequiredSettings({
      DATABASE_URL: 'postgres://x',
      API_HOST: '127.0.0.1',
      API_PORT: '8787',
    })
    expect(result).toEqual({ ok: false, missing: ['IDENTITY_MODE'] })
  })
})

describe('formatRefusal', () => {
  it('names every missing setting, .env.example, and both accepted IDENTITY_MODE values', () => {
    const message = formatRefusal(['DATABASE_URL', 'API_HOST', 'API_PORT', 'IDENTITY_MODE'])
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('API_HOST')
    expect(message).toContain('API_PORT')
    expect(message).toContain('IDENTITY_MODE')
    expect(message).toContain('.env.example')
    expect(message).toContain('local-demo')
    expect(message).toContain('real')
  })
})
