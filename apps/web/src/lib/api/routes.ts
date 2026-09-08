/**
 * Route descriptors for every endpoint in design.md's API contracts table
 * (task 7.4.1). Pure and side-effect free: each function below only builds
 * an HTTP method plus a path relative to the '/api/v1' base (and, for a
 * write, the request body already typed against the shared TypeBox
 * contract's `Static<>` type) — never touches `fetch`, headers, timeouts or
 * error mapping. `client.ts` pairs each descriptor with `send()`/`sendText()`
 * and the call's response `Static<>` type, and is where `api` (the object
 * every later hook/screen imports) is assembled and exported.
 *
 * One path segment is interpolated per dynamic parameter (`id`,
 * `clientEventId`, `date`, the demo scenario `name`); every one of them is
 * `encodeURIComponent`-escaped even though every current caller already
 * supplies a UUID, an ISO local date or a fixed scenario-name literal — so a
 * future caller can never turn a path parameter into an extra segment.
 */
import type {
  AgentPlanBodyValue,
  AmendmentBodyValue,
  ClockGapBodyValue,
  CreateProgramBodyValue,
  CreateRevisionBodyValue,
  CreateSessionBodyValue,
  DemoClockBodyValue,
  DemoScenarioName,
  EventsBatchBodyValue,
  FinalizeBodyValue,
  PatchPreferencesBodyValue,
  PatchProgramBodyValue,
  PutDayBodyValue,
  PutSlotsBodyValue,
  RecallBodyValue,
  TransitionBodyValue,
} from '@attention-lab/shared'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH'

/** What one call needs to become an HTTP request: nothing more. */
export interface RequestDescriptor {
  readonly method: HttpMethod
  /** Relative to the '/api/v1' base client.ts prefixes onto every path. */
  readonly path: string
  readonly body?: unknown
}

function path(strings: TemplateStringsArray, ...parts: string[]): string {
  return strings.reduce((acc, part, index) => {
    const raw = parts[index]
    return raw === undefined ? acc + part : acc + part + encodeURIComponent(raw)
  }, '')
}

export const routes = {
  me: {
    get: (): RequestDescriptor => ({ method: 'GET', path: '/me' }),
    patchPreferences: (body: PatchPreferencesBodyValue): RequestDescriptor => ({
      method: 'PATCH',
      path: '/me/preferences',
      body,
    }),
  },
  demo: {
    clock: (body: DemoClockBodyValue): RequestDescriptor => ({ method: 'POST', path: '/demo/clock', body }),
    loadScenario: (name: DemoScenarioName): RequestDescriptor => ({
      method: 'POST',
      path: path`/demo/scenarios/${name}/load`,
    }),
    reset: (): RequestDescriptor => ({ method: 'POST', path: '/demo/reset' }),
  },
  programs: {
    create: (body: CreateProgramBodyValue): RequestDescriptor => ({ method: 'POST', path: '/programs', body }),
    current: (): RequestDescriptor => ({ method: 'GET', path: '/programs/current' }),
    patch: (id: string, body: PatchProgramBodyValue): RequestDescriptor => ({
      method: 'PATCH',
      path: path`/programs/${id}`,
      body,
    }),
    putSlots: (id: string, body: PutSlotsBodyValue): RequestDescriptor => ({
      method: 'PUT',
      path: path`/programs/${id}/benchmark-slots`,
      body,
    }),
    createRevision: (id: string, body: CreateRevisionBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/programs/${id}/revisions`,
      body,
    }),
    today: (id: string): RequestDescriptor => ({ method: 'GET', path: path`/programs/${id}/today` }),
  },
  sessions: {
    create: (body: CreateSessionBodyValue): RequestDescriptor => ({ method: 'POST', path: '/sessions', body }),
    active: (): RequestDescriptor => ({ method: 'GET', path: '/sessions/active' }),
    get: (id: string): RequestDescriptor => ({ method: 'GET', path: path`/sessions/${id}` }),
    postEvents: (id: string, body: EventsBatchBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/events`,
      body,
    }),
    void: (id: string, clientEventId: string): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/events/${clientEventId}/void`,
    }),
    transition: (id: string, body: TransitionBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/transitions`,
      body,
    }),
    clockGap: (id: string, body: ClockGapBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/clock-gap`,
      body,
    }),
    putAgentPlan: (id: string, body: AgentPlanBodyValue): RequestDescriptor => ({
      method: 'PUT',
      path: path`/sessions/${id}/agent-plan`,
      body,
    }),
    recall: (id: string, body: RecallBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/recall`,
      body,
    }),
    finalize: (id: string, body: FinalizeBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/finalize`,
      body,
    }),
    amend: (id: string, body: AmendmentBodyValue): RequestDescriptor => ({
      method: 'POST',
      path: path`/sessions/${id}/amendments`,
      body,
    }),
  },
  days: {
    get: (programId: string, date: string): RequestDescriptor => ({
      method: 'GET',
      path: path`/programs/${programId}/days/${date}`,
    }),
    put: (programId: string, date: string, body: PutDayBodyValue): RequestDescriptor => ({
      method: 'PUT',
      path: path`/programs/${programId}/days/${date}`,
      body,
    }),
  },
  report: {
    get: (programId: string): RequestDescriptor => ({ method: 'GET', path: path`/programs/${programId}/report` }),
  },
  export: {
    get: (programId: string, format: 'csv' | 'markdown'): RequestDescriptor => ({
      method: 'GET',
      path: path`/programs/${programId}/export?format=${format}`,
    }),
  },
  research: {
    cards: (): RequestDescriptor => ({ method: 'GET', path: '/research/cards' }),
  },
} as const
