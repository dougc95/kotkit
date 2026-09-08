import { EventEmitter } from 'node:events'
import { Type } from '@sinclair/typebox'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { ConfigError, type AppConfig } from '../src/config.js'
import { installSignalHandlers, type SignalSource } from '../src/boot.js'
import type { FastifyInstance } from 'fastify'

function localDemoConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: process.env.DATABASE_URL_TEST ?? 'postgres://unused/unused_test',
    logLevel: 'silent',
    ...overrides,
  }
}

describe('buildApp', () => {
  it('(1) identityMode "real" rejects with a ConfigError mentioning local-demo, before any plugin registers', async () => {
    const config: AppConfig = {
      identityMode: 'real',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'unused',
      logLevel: 'silent',
    }

    const pending = buildApp(config)
    await expect(pending).rejects.toBeInstanceOf(ConfigError)
    await expect(pending).rejects.toThrow(/local-demo/)
  })

  it('(2) local-demo with host 0.0.0.0 rejects (assertLocalDemoConfig re-run in the factory)', async () => {
    await expect(buildApp(localDemoConfig({ host: '0.0.0.0' }))).rejects.toBeInstanceOf(ConfigError)
  })

  it('(3) local-demo, host 127.0.0.1, port 0, DATABASE_URL_TEST resolves and app.ready() succeeds', async () => {
    const app = await buildApp(localDemoConfig())
    // Fastify's `ready()` resolves with the instance itself (its own
    // SafePromiseLike shape), not `undefined` — succeeding without a thrown
    // rejection is what "succeeds" means here.
    await app.ready()
    await app.close()
  })

  it('(5) a null body value reaches the handler as null, not 0 (no coercion)', async () => {
    const app = await buildApp(localDemoConfig())
    app.post(
      '/api/v1/__test/coerce',
      { schema: { body: Type.Object({ n: Type.Union([Type.Integer(), Type.Null()]) }) } },
      async (request) => ({ n: (request.body as { n: number | null }).n }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/coerce',
      payload: { n: null },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ n: null })
    await app.close()
  })

  it('(6) a string value for an integer field is never coerced -> 400', async () => {
    const app = await buildApp(localDemoConfig())
    app.post(
      '/api/v1/__test/coerce',
      { schema: { body: Type.Object({ n: Type.Union([Type.Integer(), Type.Null()]) }) } },
      async (request) => ({ n: (request.body as { n: number | null }).n }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/coerce',
      payload: { n: '3' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('installSignalHandlers', () => {
  it('(4) SIGTERM awaits app.close() (spied) before calling exit(0)', async () => {
    const closeOrder: string[] = []
    const fakeApp = {
      log: { info: vi.fn(), error: vi.fn() },
      close: vi.fn().mockImplementation(async () => {
        closeOrder.push('close')
      }),
    } as unknown as FastifyInstance
    const closeSpy = vi.spyOn(fakeApp, 'close')

    const fakeProc = new EventEmitter() as unknown as SignalSource & EventEmitter
    const exitCalls: number[] = []
    fakeProc.exit = ((code?: number) => {
      closeOrder.push('exit')
      exitCalls.push(code ?? 0)
    }) as SignalSource['exit']

    installSignalHandlers(fakeApp, fakeProc)
    fakeProc.emit('SIGTERM')

    await vi.waitFor(() => {
      expect(exitCalls).toEqual([0])
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closeOrder).toEqual(['close', 'exit'])
  })
})
