import { vi, type Mock } from 'vitest'

/**
 * One vi.fn() per method design.md's API contracts table maps onto 7.4.1's
 * typed client (src/lib/api/client.ts). 7.4.1 does not exist yet as of
 * 7.1.1 — this module owns the method surface so every later unit imports
 * `mockClient` instead of re-declaring it (D16: one owner per shared
 * piece), and `vi.mock('@/lib/api/client', ...)` below replaces whatever
 * 7.4.1 ships with these stubs for any test that imports this module.
 */
// `vi.hoisted`'s result cannot be exported directly at its declaration site
// (Vitest's hoisting transform rejects `export const x = vi.hoisted(...)`);
// the const is declared here and re-exported as a separate statement below.
const hoistedMockApi = vi.hoisted(() => {
  const leaf = (): Mock => vi.fn()
  return {
    me: {
      get: leaf(),
      patchPreferences: leaf(),
    },
    demo: {
      clock: leaf(),
      loadScenario: leaf(),
      reset: leaf(),
    },
    programs: {
      create: leaf(),
      current: leaf(),
      patch: leaf(),
      putSlots: leaf(),
      createRevision: leaf(),
      today: leaf(),
    },
    sessions: {
      create: leaf(),
      active: leaf(),
      get: leaf(),
      postEvents: leaf(),
      void: leaf(),
      transition: leaf(),
      clockGap: leaf(),
      putAgentPlan: leaf(),
      recall: leaf(),
      finalize: leaf(),
      amend: leaf(),
    },
    days: {
      get: leaf(),
      put: leaf(),
    },
    report: {
      get: leaf(),
    },
    export: {
      get: leaf(),
    },
    research: {
      cards: leaf(),
    },
  }
})

export const mockApi = hoistedMockApi

vi.mock('@/lib/api/client', () => ({ api: hoistedMockApi }))

type MockApi = typeof mockApi
type MethodGroup = keyof MockApi

/** Dotted "group.method" identifiers for every stubbed client method. */
export type MockClientMethod = {
  [G in MethodGroup]: `${G & string}.${keyof MockApi[G] & string}`
}[MethodGroup]

/** The D18 error envelope shape, as passed to `reject()`. */
export interface MockApiErrorEnvelope {
  status: number
  code: string
  message?: string
  fieldErrors?: Record<string, string[]>
  details?: Record<string, unknown>
  retryable?: boolean
  requestId?: string
}

/** An error built by `reject()` — the D18 envelope fields plus Error. */
export interface MockApiError extends Error {
  status: number
  code: string
  fieldErrors?: Record<string, string[]>
  details?: Record<string, unknown>
  retryable: boolean
  requestId: string
}

function resolveMockFn(method: MockClientMethod): ReturnType<typeof vi.fn> {
  const [group, name] = method.split('.') as [MethodGroup, string]
  const groupObj = mockApi[group] as Record<string, ReturnType<typeof vi.fn>>
  const fn = groupObj[name]
  if (!fn) {
    throw new Error(`mockClient: unknown client method "${method}"`)
  }
  return fn
}

/** Stub `method` to resolve with `value` on every call until reset. */
export function respond(method: MockClientMethod, value: unknown): void {
  resolveMockFn(method).mockResolvedValue(value)
}

/** Stub `method` to reject with a D18-shaped error on every call until reset. */
export function reject(method: MockClientMethod, envelope: MockApiErrorEnvelope): MockApiError {
  const {
    status,
    code,
    message = `Mock ${status} ${code}`,
    fieldErrors,
    details,
    retryable = status >= 500 || status === 429,
    requestId = 'mock-request-id',
  } = envelope

  const error = Object.assign(new Error(message), {
    status,
    code,
    fieldErrors,
    details,
    retryable,
    requestId,
  }) as MockApiError

  resolveMockFn(method).mockRejectedValue(error)
  return error
}
