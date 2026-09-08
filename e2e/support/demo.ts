/**
 * The one demo-data fixture every later e2e unit imports rather than
 * re-creates (design.md D16: "Playwright support helpers
 * (`e2e/support/{demo,clock,copy,a11y}.ts`) are created in 7.1.5 and reused
 * by every later e2e unit"). Exports `test` — `@playwright/test`'s own
 * `test` extended with one fixture, `demo` — and `expect`, re-exported
 * unchanged so a spec never has to import both this module and
 * `@playwright/test` itself just to get matchers.
 *
 * `demo` wraps its own `APIRequestContext` scoped to the API's origin
 * directly (`http://127.0.0.1:8787/api/v1`, task 7.1.5's own brief) —
 * deliberately NOT the built-in `request` fixture, which Playwright scopes
 * to `use.baseURL` (the WEB origin for every project in `playwright.config.ts`
 * that navigates a `page`). Keeping the demo API calls on their own context
 * means a spec can call `demo.*` and `page.goto('/...')` in the same test
 * without the two ever fighting over what "the base URL" means.
 *
 * Every method is typed against the 2.7 `Static<>` contracts
 * (`@attention-lab/shared`) — never a hand-rolled shape — so a contract
 * change that breaks the wire shape breaks this file's typecheck too,
 * exactly the guarantee `npm run typecheck:e2e` (this task's own verify)
 * exists to catch with no server running. Only `type` imports are taken from
 * `@attention-lab/shared`: nothing here calls into `packages/shared`'s
 * domain functions (`localDateAt` and friends) even though the barrel
 * re-exports them — `readyProgram`'s own local-date/local-time arithmetic
 * below is deliberately self-contained, so this file's only *runtime*
 * dependency is Playwright itself.
 */
import {
  expect,
  request as apiRequest,
  test as base,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'
import type {
  CreateProgramBodyValue,
  CurrentProgramResponseValue,
  DemoScenarioName,
  MeResponseValue,
  ProgramResponseValue,
  PutSlotsBodyValue,
  PutSlotsResponseValue,
  ReportResponseValue,
  RevisionResponseValue,
  ScenarioLoadResponseValue,
  SessionResponseValue,
  SlotResponseValue,
  TodayResponseValue,
} from '@attention-lab/shared'

/**
 * The API's own origin, never the web dev server's (design.md's Runtime
 * topology; task 7.1.5's brief). The trailing slash is load-bearing: WHATWG
 * URL resolution (what `APIRequestContext` uses to join a relative call
 * against `baseURL`) treats everything after the last `/` in `baseURL` as a
 * "file", not a path segment, so a `baseURL` ending in `.../api/v1` (no
 * trailing slash) would resolve a call to `'me'` as `.../api/me` — dropping
 * `v1` — and a call to `'/me'` (leading slash) as `http://host/me` —
 * dropping `api/v1` entirely. Every call below therefore uses a path with
 * NO leading slash (`me`, `programs/current`, ...), relative to this exact
 * trailing-slash base.
 */
export const DEMO_API_BASE_URL = 'http://127.0.0.1:8787/api/v1/'

/** One idempotency key per logical mutation (design.md D6/D21/D16), same contract `newIdempotencyKey.ts` documents for the web app. */
function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Local-date / local-time arithmetic for `readyProgram()`. Deliberately
// duplicated rather than imported from `packages/shared/src/domain/
// calendar.ts` (see the file header) — small enough to own here, and it
// keeps this file's dependency surface to Playwright/axe types and the 2.7
// contracts, per this task's own brief.
// ---------------------------------------------------------------------------

/** The local calendar date (`YYYY-MM-DD`) of `instant` in IANA zone `timeZone`. */
function localDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not resolve a local date for timeZone "${timeZone}"`)
  }
  return `${year}-${month}-${day}`
}

/** `timeZone`'s UTC offset in milliseconds AT `instant` (varies across a DST transition). */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - instant.getTime()
}

/**
 * The UTC instant (epoch ms) of local wall-clock `HH:MM` on `localDate` in
 * IANA zone `timeZone`. Two-pass fixed point (a same-day DST transition
 * inside the loop would need a third pass, which no program timezone this
 * app exercises does): guess as if the wall-clock components were UTC, then
 * correct by the zone's actual offset at that guess.
 */
function zonedWallClockToUtcMs(localDate: string, hhmm: string, timeZone: string): number {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    throw new Error(`Malformed local date/time: "${localDate}" "${hhmm}"`)
  }
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 2; i++) {
    const offsetMs = timeZoneOffsetMs(new Date(guessMs), timeZone)
    guessMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMs
  }
  return guessMs
}

// ---------------------------------------------------------------------------
// Response handling: every call below either resolves the parsed body or
// throws with the url, status and (best-effort) body text attached — a spec
// failure names the actual HTTP call that misbehaved rather than a bare
// "undefined" from a swallowed non-2xx response. (`APIResponse` carries no
// `.request()`/method accessor — `url()` plus `status()` is all it exposes
// about what was asked for.)
// ---------------------------------------------------------------------------

async function readJson<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    const bodyText = await response.text().catch(() => '<unreadable body>')
    throw new Error(`${response.url()} -> ${response.status()}: ${bodyText}`)
  }
  return (await response.json()) as T
}

async function expectStatus(response: APIResponse, status: number): Promise<void> {
  if (response.status() !== status) {
    const bodyText = await response.text().catch(() => '<unreadable body>')
    throw new Error(`${response.url()} -> ${response.status()} (expected ${status}): ${bodyText}`)
  }
}

/** `POST /programs`'s response envelope — assembled ad hoc by its route handler, not a published contract (see `apps/api/src/routes/programs.ts`'s own header comment). */
interface CreateProgramResult {
  readonly program: ProgramResponseValue
  readonly revision: RevisionResponseValue
}

/** `readyProgram()`'s own return shape (task 7.1.5's brief: `{programId, slots, revision}`). */
export interface ReadyProgramResult {
  readonly programId: string
  readonly slots: readonly SlotResponseValue[]
  readonly revision: RevisionResponseValue
}

/**
 * The `demo` fixture value. One method per call this task's brief names —
 * `reset`, `load`, `setClock`, `offset`, `current`, `today`, `active`,
 * `session`, `report`, `readyProgram` — nothing else, so a later spec that
 * needs a new demo-data operation adds a method here rather than reaching
 * for a raw `APIRequestContext` of its own (D16).
 */
export class DemoClient {
  constructor(private readonly context: APIRequestContext) {}

  /** `POST /demo/reset` -> 204. Deletes every demo row for the fixed principal. */
  async reset(): Promise<void> {
    const response = await this.context.post('demo/reset')
    await expectStatus(response, 204)
  }

  /** `POST /demo/scenarios/{name}/load` -> `{programId}`. Replaces the principal's demo data with one PRD §6 scenario. */
  async load(name: DemoScenarioName): Promise<ScenarioLoadResponseValue> {
    const response = await this.context.post(`demo/scenarios/${name}/load`)
    return readJson<ScenarioLoadResponseValue>(response)
  }

  /** `POST /demo/clock` — D35: an ABSOLUTE offset from real time, never a delta on top of whatever is already stored (distinct from `clock.ts`'s `advance`, which reads the current offset first). */
  async setClock(offsetSeconds: number): Promise<void> {
    const response = await this.context.post('demo/clock', { data: { offsetSeconds } })
    await expectStatus(response, 200)
  }

  /** The current `demoClockOffsetSeconds`, read from `GET /me`. */
  async offset(): Promise<number> {
    return (await this.me()).demoClockOffsetSeconds
  }

  /** `GET /me`. */
  async me(): Promise<MeResponseValue> {
    const response = await this.context.get('me')
    return readJson<MeResponseValue>(response)
  }

  /** `GET /programs/current`. */
  async current(): Promise<CurrentProgramResponseValue> {
    const response = await this.context.get('programs/current')
    return readJson<CurrentProgramResponseValue>(response)
  }

  /** `GET /programs/{id}/today`. */
  async today(programId: string): Promise<TodayResponseValue> {
    const response = await this.context.get(`programs/${programId}/today`)
    return readJson<TodayResponseValue>(response)
  }

  /** `GET /sessions/active`; 204 -> `null`. */
  async active(): Promise<SessionResponseValue | null> {
    const response = await this.context.get('sessions/active')
    if (response.status() === 204) {
      return null
    }
    return readJson<SessionResponseValue>(response)
  }

  /** `GET /sessions/{id}`. */
  async session(id: string): Promise<SessionResponseValue> {
    const response = await this.context.get(`sessions/${id}`)
    return readJson<SessionResponseValue>(response)
  }

  /** `GET /programs/{id}/report`. */
  async report(programId: string): Promise<ReportResponseValue> {
    const response = await this.context.get(`programs/${programId}/report`)
    return readJson<ReportResponseValue>(response)
  }

  /**
   * Creates a program (`baselineDate` = today in the `GET /me` timezone,
   * `practiceTargetSeconds` 900) and saves readiness for all four required
   * slots (baseline A 09:00 / B 14:00 local; finals left without a planned
   * time — "defaulted", per this task's brief — which the readiness-complete
   * rule does not require: program-setup spec, "Readiness complete" needs
   * only the four references plus both baseline times). Then pins the demo
   * clock to 09:00 local on Day 0, so the caller lands exactly at "Start with
   * your baseline" with baseline A's own planned time already current.
   * Returns `{programId, slots, revision}` (task 7.1.5's own brief).
   */
  async readyProgram(): Promise<ReadyProgramResult> {
    const me = await this.me()
    const baselineDate = localDateAt(new Date(), me.timezone)

    const createBody: CreateProgramBodyValue = {
      baselineDate,
      timezone: me.timezone,
      practiceTargetSeconds: 900,
    }
    const createResponse = await this.context.post('programs', {
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      data: createBody,
    })
    const created = await readJson<CreateProgramResult>(createResponse)

    const slotsBody: PutSlotsBodyValue = {
      expectedVersion: created.program.version,
      slots: [
        { phase: 'baseline', label: 'A', materialRef: 'Baseline A — assigned reading', plannedLocalTime: '09:00' },
        { phase: 'baseline', label: 'B', materialRef: 'Baseline B — assigned reading', plannedLocalTime: '14:00' },
        { phase: 'final', label: 'A', materialRef: 'Final A — assigned reading' },
        { phase: 'final', label: 'B', materialRef: 'Final B — assigned reading' },
      ],
    }
    const slotsResponse = await this.context.put(`programs/${created.program.id}/benchmark-slots`, {
      data: slotsBody,
    })
    const slotsResult = await readJson<PutSlotsResponseValue>(slotsResponse)

    const day0NineAmMs = zonedWallClockToUtcMs(baselineDate, '09:00', me.timezone)
    const offsetSeconds = Math.round((day0NineAmMs - Date.now()) / 1000)
    await this.setClock(offsetSeconds)

    return { programId: created.program.id, slots: slotsResult.slots, revision: created.revision }
  }
}

export interface DemoFixtures {
  readonly demo: DemoClient
}

/**
 * `@playwright/test`'s own `test`, extended with the `demo` fixture. Every
 * later e2e spec imports `test`/`expect` from HERE, not from
 * `@playwright/test` directly, so the fixture is always available (D16).
 */
export const test = base.extend<DemoFixtures>({
  demo: async ({}, use) => {
    const context = await apiRequest.newContext({ baseURL: DEMO_API_BASE_URL })
    await use(new DemoClient(context))
    await context.dispose()
  },
})

export { expect }
