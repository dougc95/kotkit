import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'

/** Builds the app and starts listening on `config.host`/`config.port`. */
export async function startServer(config: AppConfig): Promise<FastifyInstance> {
  const app = await buildApp(config)
  await app.listen({ host: config.host, port: config.port })

  // Port 0 resolves to an OS-assigned port; read it back from the bound
  // address rather than trusting the requested `config.port`.
  const [address] = app.addresses()
  const actualPort = address?.port ?? config.port
  app.log.info(`listening on http://${config.host}:${actualPort}`)

  return app
}

/**
 * Minimal shape `installSignalHandlers` needs from its second argument, so a
 * test double (a plain `EventEmitter` plus a fake `exit`) satisfies it
 * without impersonating the whole of `NodeJS.Process`.
 */
export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exit(code?: number): void
}

/**
 * SIGINT/SIGTERM -> graceful close -> exit(0). D40: verified on POSIX only
 * by the real spawn tests; the close path itself is covered by the unit
 * test's fake process/app pair on every platform.
 */
export function installSignalHandlers(
  app: FastifyInstance,
  proc: SignalSource = process as unknown as SignalSource,
): void {
  const shutdown = (signal: string): void => {
    app.log.info(`received ${signal}, closing`)
    app
      .close()
      .then(() => {
        proc.exit(0)
      })
      .catch((err: unknown) => {
        app.log.error(err)
        proc.exit(1)
      })
  }

  proc.on('SIGINT', () => shutdown('SIGINT'))
  proc.on('SIGTERM', () => shutdown('SIGTERM'))
}
