import { pathToFileURL } from 'node:url'
import type { Realm } from '@attention-lab/shared'
import {
  ConfigError,
  formatRefusal,
  loadConfig,
  validateRequiredSettings,
  type ValidateRequiredSettingsResult,
} from './config.js'
import { installSignalHandlers, startServer } from './boot.js'

export type { Realm }
// Re-exported so 1.3.2's tests (which import these from server.js) keep
// passing unchanged now that config.ts owns them (3.1.1).
export { formatRefusal, validateRequiredSettings }
export type { ValidateRequiredSettingsResult }

/**
 * Loads config (process.env only — server.ts never reads a .env file
 * itself; env comes from the workspace scripts'
 * `--env-file-if-exists=../../.env`), boots the app and installs signal
 * handlers. A `ConfigError` is written to stderr and exits the process with
 * code 1 before anything ever listens; any other startup failure logs and
 * sets `process.exitCode = 1` instead, letting the event loop drain.
 */
export async function start(): Promise<void> {
  const config = loadConfig(process.env)
  const app = await startServer(config)
  installSignalHandlers(app)
}

/**
 * True only when this module is the process entry point (`tsx src/server.ts`),
 * never when a test runner imports it — that is what keeps `start()` from
 * firing (and binding a real port) as a side effect of import.
 */
export function isEntryModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  return moduleUrl === pathToFileURL(argv1).href
}

if (isEntryModule(import.meta.url, process.argv[1])) {
  try {
    await start()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      process.exit(1)
    } else {
      console.error(err)
      process.exitCode = 1
    }
  }
}
