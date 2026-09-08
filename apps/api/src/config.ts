/**
 * Boot-time configuration. Everything here is a PURE function of an env
 * record — nothing in this file ever reads `process.env` itself, so it can
 * be exercised with any env shape a test hands it (see design.md D2, D35 and
 * the 3.1.1 task brief).
 *
 * `loadConfig` is the single source of truth for whether the process is
 * allowed to boot at all: a `ConfigError` thrown from here is caught by
 * `server.ts`, printed to stderr, and the process exits 1 before anything
 * listens.
 */

/** Boot exits 1 whenever this is thrown — see server.ts. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type IdentityMode = 'local-demo' | 'real'

export interface AppConfig {
  readonly identityMode: IdentityMode
  readonly host: string
  readonly port: number
  readonly databaseUrl: string
  readonly webOrigin?: string
  readonly webDistDir?: string
  readonly logLevel: string
}

/** D35: the only hosts local-demo mode may bind to. */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const

/**
 * The four settings `real` mode needs before it can ever be satisfied. Even
 * with all four present, `real` still refuses to boot in this change — see
 * D2 and LIMITATIONS.md.
 */
export const REAL_MODE_PREREQUISITES = [
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'AUTH_INVITE_ALLOWLIST',
] as const

const REQUIRED_SETTINGS = ['DATABASE_URL', 'API_HOST', 'API_PORT', 'IDENTITY_MODE'] as const

interface ValidatedSettings {
  databaseUrl: string
  apiHost: string
  apiPort: number
  identityMode: string
}

export type ValidateRequiredSettingsResult =
  | { ok: true; settings: ValidatedSettings }
  | { ok: false; missing: string[] }

/**
 * Presence-only gate: absent, empty and (for API_PORT) non-integer count as
 * missing. Value enumeration of IDENTITY_MODE, the loopback host check and
 * the real-mode prerequisite listing are `loadConfig`'s, layered on top of
 * this. Moved here from server.ts (originally 1.3.2) so `loadConfig` can run
 * this refusal first without an import cycle; server.ts re-exports both this
 * and `formatRefusal` so 1.3.2's tests keep passing unchanged.
 */
export function validateRequiredSettings(
  env: Record<string, string | undefined>,
): ValidateRequiredSettingsResult {
  const missing: string[] = []
  for (const name of REQUIRED_SETTINGS) {
    const value = env[name]
    if (!value) {
      missing.push(name)
      continue
    }
    if (name === 'API_PORT' && !Number.isInteger(Number(value))) {
      missing.push(name)
    }
  }

  if (missing.length > 0) return { ok: false, missing }

  return {
    ok: true,
    settings: {
      databaseUrl: env.DATABASE_URL!,
      apiHost: env.API_HOST!,
      apiPort: Number(env.API_PORT),
      identityMode: env.IDENTITY_MODE!,
    },
  }
}

export function formatRefusal(missing: string[]): string {
  return (
    `Refusing to start: missing required settings: ${missing.join(', ')}. ` +
    'Copy .env.example to .env and fill them in. ' +
    'IDENTITY_MODE accepts exactly: local-demo, real.'
  )
}

function checkIdentityMode(env: Record<string, string | undefined>): IdentityMode {
  const raw = env.IDENTITY_MODE
  if (raw === 'local-demo' || raw === 'real') return raw
  throw new ConfigError('IDENTITY_MODE must be one of: local-demo, real')
}

function checkLoopbackHost(host: string): void {
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) {
    throw new ConfigError(
      `API_HOST '${host}' is not accepted: demo mode must never be exposed on a network interface. ` +
        `Use one of: ${LOOPBACK_HOSTS.join(', ')}.`,
    )
  }
}

function checkRealModePrerequisites(env: Record<string, string | undefined>): void {
  const missing = REAL_MODE_PREREQUISITES.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new ConfigError(
      `${missing.join('\n')}\n` + 'real authentication is not yet implemented (see LIMITATIONS.md).',
    )
  }
  // All four prerequisites present is still not enough in this change: no
  // fixed principal is ever configured for `real` mode (D2, D7.6).
  throw new ConfigError('real authentication is not yet implemented (see LIMITATIONS.md).')
}

function checkPort(rawPort: string): number {
  const parsed = Number(rawPort)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new ConfigError(`API_PORT must be an integer between 0 and 65535 (got '${rawPort}').`)
  }
  return parsed
}

/**
 * Pure: never touches `process.env`. Order: (0) required-settings presence
 * gate, (1) IDENTITY_MODE enum check, (2) local-demo loopback check /
 * (3) real prerequisites check, (4) API_PORT range plus the pass-through
 * optional settings.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const validated = validateRequiredSettings(env)
  if (!validated.ok) {
    throw new ConfigError(formatRefusal(validated.missing))
  }

  const identityMode = checkIdentityMode(env)

  if (identityMode === 'local-demo') {
    checkLoopbackHost(env.API_HOST!)
  } else {
    checkRealModePrerequisites(env)
  }

  const port = checkPort(env.API_PORT!)

  const webOrigin = env.WEB_ORIGIN ? env.WEB_ORIGIN : undefined
  const webDistDir = env.WEB_DIST_DIR ? env.WEB_DIST_DIR : undefined
  const logLevel = env.LOG_LEVEL ? env.LOG_LEVEL : 'info'

  return Object.freeze({
    identityMode,
    host: env.API_HOST!,
    port,
    databaseUrl: env.DATABASE_URL!,
    ...(webOrigin !== undefined ? { webOrigin } : {}),
    ...(webDistDir !== undefined ? { webDistDir } : {}),
    logLevel,
  })
}

/**
 * Re-runs the identity-mode and loopback rules against an already-built
 * config. Used by `buildApp` (3.1.2) as defense in depth: even a
 * hand-constructed `AppConfig` that skipped `loadConfig` cannot build an app
 * outside local-demo mode.
 */
export function assertLocalDemoConfig(config: AppConfig): void {
  if (config.identityMode !== 'local-demo') {
    throw new ConfigError(
      "buildApp requires identityMode 'local-demo'; real mode is not implemented yet " +
        '(see LIMITATIONS.md).',
    )
  }
  checkLoopbackHost(config.host)
}
