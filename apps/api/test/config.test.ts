import { describe, expect, it } from 'vitest'
import { ConfigError, LOOPBACK_HOSTS, loadConfig } from '../src/config.js'
import { DEFAULT_PREFERENCES } from '../src/preferences.js'

/** A complete, valid local-demo env — tests override just the field under test. */
function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:55432/attention_lab',
    API_HOST: '127.0.0.1',
    API_PORT: '8787',
    IDENTITY_MODE: 'local-demo',
    ...overrides,
  }
}

function loadConfigThrowMessage(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as ConfigError).message
  }
  throw new Error('loadConfig did not throw')
}

describe('loadConfig', () => {
  it('(1) IDENTITY_MODE absent -> ConfigError naming IDENTITY_MODE and both accepted values', () => {
    const message = loadConfigThrowMessage(validEnv({ IDENTITY_MODE: undefined }))
    expect(message).toContain('IDENTITY_MODE')
    expect(message).toContain('local-demo')
    expect(message).toContain('real')
  })

  it("(2) IDENTITY_MODE '' -> same as absent", () => {
    const message = loadConfigThrowMessage(validEnv({ IDENTITY_MODE: '' }))
    expect(message).toContain('IDENTITY_MODE')
    expect(message).toContain('local-demo')
    expect(message).toContain('real')
  })

  it("(3) IDENTITY_MODE 'demo' -> refused, message lists both accepted values", () => {
    const message = loadConfigThrowMessage(validEnv({ IDENTITY_MODE: 'demo' }))
    expect(message).toContain('local-demo')
    expect(message).toContain('real')
  })

  it("(4) IDENTITY_MODE 'Local-Demo' -> refused (no case normalization)", () => {
    const message = loadConfigThrowMessage(validEnv({ IDENTITY_MODE: 'Local-Demo' }))
    expect(message).toContain('local-demo')
    expect(message).toContain('real')
  })

  it('(5) local-demo + API_HOST 127.0.0.1 -> ok, host 127.0.0.1', () => {
    const config = loadConfig(validEnv({ API_HOST: '127.0.0.1' }))
    expect(config.host).toBe('127.0.0.1')
    expect(config.identityMode).toBe('local-demo')
  })

  it('(6) local-demo + API_HOST localhost -> ok', () => {
    const config = loadConfig(validEnv({ API_HOST: 'localhost' }))
    expect(config.host).toBe('localhost')
  })

  it('(7) local-demo + API_HOST ::1 -> ok (D35)', () => {
    const config = loadConfig(validEnv({ API_HOST: '::1' }))
    expect(config.host).toBe('::1')
  })

  it("(8) local-demo + API_HOST 0.0.0.0 -> refused, names API_HOST and the network-interface warning", () => {
    const message = loadConfigThrowMessage(validEnv({ API_HOST: '0.0.0.0' }))
    expect(message).toContain('API_HOST')
    expect(message).toContain('demo mode must never be exposed on a network interface')
  })

  it('(9) local-demo + API_HOST :: -> refused', () => {
    const message = loadConfigThrowMessage(validEnv({ API_HOST: '::' }))
    expect(message).toContain('API_HOST')
    expect(message).toContain('demo mode must never be exposed on a network interface')
  })

  it('(10) local-demo + API_HOST 192.168.1.5 -> refused', () => {
    const message = loadConfigThrowMessage(validEnv({ API_HOST: '192.168.1.5' }))
    expect(message).toContain('API_HOST')
    expect(message).toContain('demo mode must never be exposed on a network interface')
  })

  it('(11) API_HOST unset -> refused naming API_HOST', () => {
    const message = loadConfigThrowMessage(validEnv({ API_HOST: undefined }))
    expect(message).toContain('API_HOST')
  })

  it('(12) real with none of the four prerequisites -> lists all four in order plus the refusal text', () => {
    const message = loadConfigThrowMessage(
      validEnv({
        IDENTITY_MODE: 'real',
        AUTH_SECRET: undefined,
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        AUTH_INVITE_ALLOWLIST: undefined,
      }),
    )
    const authSecretIndex = message.indexOf('AUTH_SECRET')
    const googleIdIndex = message.indexOf('GOOGLE_CLIENT_ID')
    const googleSecretIndex = message.indexOf('GOOGLE_CLIENT_SECRET')
    const allowlistIndex = message.indexOf('AUTH_INVITE_ALLOWLIST')
    expect(authSecretIndex).toBeGreaterThanOrEqual(0)
    expect(googleIdIndex).toBeGreaterThan(authSecretIndex)
    expect(googleSecretIndex).toBeGreaterThan(googleIdIndex)
    expect(allowlistIndex).toBeGreaterThan(googleSecretIndex)
    expect(message).toContain('not yet implemented')
    expect(message).toContain('LIMITATIONS.md')
  })

  it('(13) real with only AUTH_SECRET -> lists the other three, not AUTH_SECRET', () => {
    const message = loadConfigThrowMessage(
      validEnv({
        IDENTITY_MODE: 'real',
        AUTH_SECRET: 'dummy',
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        AUTH_INVITE_ALLOWLIST: undefined,
      }),
    )
    expect(message).not.toContain('AUTH_SECRET')
    expect(message).toContain('GOOGLE_CLIENT_ID')
    expect(message).toContain('GOOGLE_CLIENT_SECRET')
    expect(message).toContain('AUTH_INVITE_ALLOWLIST')
  })

  it('(14) real with all four dummy values -> still refused: not yet implemented, LIMITATIONS.md', () => {
    const message = loadConfigThrowMessage(
      validEnv({
        IDENTITY_MODE: 'real',
        AUTH_SECRET: 'dummy',
        GOOGLE_CLIENT_ID: 'dummy',
        GOOGLE_CLIENT_SECRET: 'dummy',
        AUTH_INVITE_ALLOWLIST: 'dummy@example.com',
      }),
    )
    expect(message).toContain('not yet implemented')
    expect(message).toContain('LIMITATIONS.md')
  })

  it('(15) DATABASE_URL missing -> message names DATABASE_URL', () => {
    const message = loadConfigThrowMessage(validEnv({ DATABASE_URL: undefined }))
    expect(message).toContain('DATABASE_URL')
  })

  it("(16) API_PORT 'abc' -> names API_PORT", () => {
    const message = loadConfigThrowMessage(validEnv({ API_PORT: 'abc' }))
    expect(message).toContain('API_PORT')
  })

  it("(17) API_PORT '70000' -> names API_PORT", () => {
    const message = loadConfigThrowMessage(validEnv({ API_PORT: '70000' }))
    expect(message).toContain('API_PORT')
  })

  it('(18) purity: process.env.IDENTITY_MODE does not leak into loadConfig({})', () => {
    const previous = process.env.IDENTITY_MODE
    process.env.IDENTITY_MODE = 'local-demo'
    try {
      const message = loadConfigThrowMessage({})
      expect(message).toContain('IDENTITY_MODE')
    } finally {
      if (previous === undefined) delete process.env.IDENTITY_MODE
      else process.env.IDENTITY_MODE = previous
    }
  })

  it('(20) WEB_DIST_DIR passthrough; absent or empty -> undefined', () => {
    const withDir = loadConfig(validEnv({ WEB_DIST_DIR: 'apps/web/dist' }))
    expect(withDir.webDistDir).toBe('apps/web/dist')

    const absent = loadConfig(validEnv())
    expect(absent.webDistDir).toBeUndefined()

    const empty = loadConfig(validEnv({ WEB_DIST_DIR: '' }))
    expect(empty.webDistDir).toBeUndefined()
  })

  it('(21) LOOPBACK_HOSTS deep-equals the three accepted hosts', () => {
    expect(LOOPBACK_HOSTS).toEqual(['127.0.0.1', 'localhost', '::1'])
  })

})

describe('DEFAULT_PREFERENCES', () => {
  it('(19) deep-equals the fixed default set', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      hideTimerDefault: false,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: false,
    })
  })
})
