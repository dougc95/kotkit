/**
 * The typed API client (task 7.4.1; design.md's API contracts table, D18-
 * D22). `api` is the one object every later hook and screen imports —
 * `src/test/mockClient.ts` (7.1.1) already fixes this exact method surface
 * by mocking this module's path (`@/lib/api/client`), so the shape below is
 * binding, not just a convenience.
 *
 * Every request: base `/api/v1`, `credentials: 'same-origin'`,
 * `Accept: application/json`, `Content-Type: application/json` only when a
 * body is sent, and a 30-second `AbortSignal.timeout`. An `Idempotency-Key`
 * header is attached only when the caller passes `{ idempotencyKey }` — the
 * four routes design.md marks `(IK)` (`programs.create`, `sessions.create`,
 * `sessions.recall`, `sessions.finalize`); the client never mints a key
 * itself (`newIdempotencyKey.ts` does that, for a caller to own — D6, D16).
 *
 * Response shapes are the `Static<>` types of the shared TypeBox contracts
 * (`@attention-lab/shared`) one-to-one; `Obj(...)`'s `additionalProperties:
 * false` on every request body means an object literal carrying an
 * unexpected key (a caller-supplied `realm`, say) is already a compile
 * error at the call site (identity-realm: "Client cannot choose the realm"
 * — `client.test-d.ts` proves it for `programs.create`).
 *
 * A few response envelopes (`POST /programs`, `PATCH /programs/{id}`,
 * `POST /programs/{id}/revisions`, `POST /demo/clock`) are assembled ad hoc
 * by their route handlers in `apps/api` rather than published as a shared
 * contract type (see those files' own header comments) — this module
 * declares the matching local interfaces immediately below, the same way
 * each API route file declares its own local response interface.
 */
import type {
  AgentPlanBodyValue,
  AgentPlanResponseValue,
  AmendmentBodyValue,
  AmendmentResponseValue,
  ClockGapBodyValue,
  CreateProgramBodyValue,
  CreateRevisionBodyValue,
  CreateSessionBodyValue,
  CurrentProgramResponseValue,
  DayResponseValue,
  DemoClockBodyValue,
  DemoScenarioName,
  EventResponseValue,
  EventsBatchBodyValue,
  EventsBatchResponseValue,
  FinalizeBodyValue,
  FinalizeResponseValue,
  MeResponseValue,
  PatchPreferencesBodyValue,
  PatchProgramBodyValue,
  ProgramResponseValue,
  PutDayBodyValue,
  PutSlotsBodyValue,
  PutSlotsResponseValue,
  RecallBodyValue,
  ReportResponseValue,
  ResearchCardsResponseValue,
  RevisionResponseValue,
  ReviewResponseValue,
  ScenarioLoadResponseValue,
  SessionResponseValue,
  TodayResponseValue,
  TransitionBodyValue,
} from '@attention-lab/shared'
import { mapApiError, NetworkError } from './errors.js'
import { routes, type RequestDescriptor } from './routes.js'

const BASE_URL = '/api/v1'
const TIMEOUT_MS = 30_000

/** Options an idempotent-mutation caller passes; the key is always caller-owned (D6, D16). */
export interface RequestOptions {
  readonly idempotencyKey: string
}

// ---------------------------------------------------------------------------
// Response envelopes assembled ad hoc by their `apps/api` route handler —
// not published from `packages/shared/src/contracts` (see those routes'
// own header comments for why). Declared once here, matching them field for
// field.
// ---------------------------------------------------------------------------

export interface CreateProgramResult {
  readonly program: ProgramResponseValue
  readonly revision: RevisionResponseValue
}

export interface PatchProgramResult {
  readonly program: ProgramResponseValue
}

export interface CreateRevisionResult {
  readonly revision: RevisionResponseValue
  readonly program: ProgramResponseValue
}

export interface DemoClockResult {
  readonly demoClockOffsetSeconds: number
}

// ---------------------------------------------------------------------------
// Transport: one fetch, mapped to either a thrown ApiError or a Response the
// caller may read as JSON (`send`) or text (`sendText`).
// ---------------------------------------------------------------------------

function buildHeaders(hasBody: boolean, options: RequestOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }
  if (options !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey
  }
  return headers
}

/**
 * Runs one request and returns the raw `Response` on success (2xx). A fetch
 * rejection or the timeout signal firing becomes `NetworkError`; any non-2xx
 * response becomes the `ApiError` subclass `mapApiError` (`errors.ts`)
 * derives from its status and (best-effort JSON-parsed) body — never thrown
 * as a bare fetch/HTTP error a caller would have to re-interpret.
 */
async function fetchMapped(descriptor: RequestDescriptor, options: RequestOptions | undefined): Promise<Response> {
  const hasBody = descriptor.body !== undefined
  const headers = buildHeaders(hasBody, options)

  const init: RequestInit = {
    method: descriptor.method,
    credentials: 'same-origin',
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }
  // `exactOptionalPropertyTypes` rejects an explicit `body: undefined` (the
  // property is genuinely absent for a bodyless request, not present-but-
  // undefined), so the key is only ever set when there is a body to send.
  if (hasBody) {
    init.body = JSON.stringify(descriptor.body)
  }

  let response: Response
  try {
    response = await fetch(BASE_URL + descriptor.path, init)
  } catch (cause) {
    throw new NetworkError('The request could not be completed.', cause)
  }

  if (!response.ok) {
    let rawBody: unknown = null
    try {
      rawBody = await response.json()
    } catch {
      rawBody = null
    }
    throw mapApiError(response.status, rawBody)
  }

  return response
}

/** A JSON-bodied call. A 204 (no content — only `GET /sessions/active` today) resolves `null`. */
async function send<TResponse>(descriptor: RequestDescriptor, options?: RequestOptions): Promise<TResponse> {
  const response = await fetchMapped(descriptor, options)
  if (response.status === 204) {
    return null as TResponse
  }
  return (await response.json()) as TResponse
}

/** The one text-bodied call (`GET /programs/{id}/export`) — CSV or Markdown, never parsed as JSON. */
async function sendText(descriptor: RequestDescriptor, options?: RequestOptions): Promise<string> {
  const response = await fetchMapped(descriptor, options)
  return response.text()
}

// ---------------------------------------------------------------------------
// The client: every route in design.md's API table, one method each.
// ---------------------------------------------------------------------------

export const api = {
  me: {
    get: (): Promise<MeResponseValue> => send(routes.me.get()),
    patchPreferences: (body: PatchPreferencesBodyValue): Promise<MeResponseValue> =>
      send(routes.me.patchPreferences(body)),
  },
  demo: {
    clock: (body: DemoClockBodyValue): Promise<DemoClockResult> => send(routes.demo.clock(body)),
    loadScenario: (name: DemoScenarioName): Promise<ScenarioLoadResponseValue> =>
      send(routes.demo.loadScenario(name)),
    reset: (): Promise<void> => send(routes.demo.reset()),
  },
  programs: {
    create: (body: CreateProgramBodyValue, options: RequestOptions): Promise<CreateProgramResult> =>
      send(routes.programs.create(body), options),
    current: (): Promise<CurrentProgramResponseValue> => send(routes.programs.current()),
    patch: (id: string, body: PatchProgramBodyValue): Promise<PatchProgramResult> =>
      send(routes.programs.patch(id, body)),
    putSlots: (id: string, body: PutSlotsBodyValue): Promise<PutSlotsResponseValue> =>
      send(routes.programs.putSlots(id, body)),
    createRevision: (id: string, body: CreateRevisionBodyValue): Promise<CreateRevisionResult> =>
      send(routes.programs.createRevision(id, body)),
    today: (id: string): Promise<TodayResponseValue> => send(routes.programs.today(id)),
  },
  sessions: {
    create: (body: CreateSessionBodyValue, options: RequestOptions): Promise<SessionResponseValue> =>
      send(routes.sessions.create(body), options),
    active: (): Promise<SessionResponseValue | null> => send(routes.sessions.active()),
    get: (id: string): Promise<SessionResponseValue> => send(routes.sessions.get(id)),
    postEvents: (id: string, body: EventsBatchBodyValue): Promise<EventsBatchResponseValue> =>
      send(routes.sessions.postEvents(id, body)),
    void: (id: string, clientEventId: string): Promise<EventResponseValue> =>
      send(routes.sessions.void(id, clientEventId)),
    transition: (id: string, body: TransitionBodyValue): Promise<SessionResponseValue> =>
      send(routes.sessions.transition(id, body)),
    clockGap: (id: string, body: ClockGapBodyValue): Promise<SessionResponseValue> =>
      send(routes.sessions.clockGap(id, body)),
    putAgentPlan: (id: string, body: AgentPlanBodyValue): Promise<AgentPlanResponseValue> =>
      send(routes.sessions.putAgentPlan(id, body)),
    recall: (id: string, body: RecallBodyValue, options: RequestOptions): Promise<ReviewResponseValue> =>
      send(routes.sessions.recall(id, body), options),
    finalize: (id: string, body: FinalizeBodyValue, options: RequestOptions): Promise<FinalizeResponseValue> =>
      send(routes.sessions.finalize(id, body), options),
    amend: (id: string, body: AmendmentBodyValue): Promise<AmendmentResponseValue> =>
      send(routes.sessions.amend(id, body)),
  },
  days: {
    get: (programId: string, date: string): Promise<DayResponseValue> => send(routes.days.get(programId, date)),
    put: (programId: string, date: string, body: PutDayBodyValue): Promise<DayResponseValue> =>
      send(routes.days.put(programId, date, body)),
  },
  report: {
    get: (programId: string): Promise<ReportResponseValue> => send(routes.report.get(programId)),
  },
  export: {
    get: (programId: string, format: 'csv' | 'markdown'): Promise<string> =>
      sendText(routes.export.get(programId, format)),
  },
  research: {
    cards: (): Promise<ResearchCardsResponseValue> => send(routes.research.cards()),
  },
} as const
