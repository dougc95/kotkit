## Context

See proposal.md — Why. Current state that shapes the approach:

- **Scaffold**: root `package.json` with npm workspaces (`packages/*`, `apps/*`), scripts for `db:up` (Postgres 17 in Docker on 55432), `typecheck`, `test`, `build`, `dev:api`, `dev:web`; `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: bundler`); `packages/shared` with `domain/types.ts` only. `apps/*`, `packages/shared/src/index.ts` and `LIMITATIONS.md` are referenced but absent.
- **`types.ts` already decides**: `ReportedCount = number | null` with no `countOrZero`; `Realm = 'demo' | 'pilot'` with `assertSameRealm` throwing; `TimeSource = measured | demo_clock | attested`; `FirstSwitch` as a three-state union; `ObservedConditions` on the attempt including `materialLevel` and `accommodations`; `ExclusionReason` including `materially_disrupted`, `recall_missing`, `scoring_incomplete`, `timer_uncertain`, `timing_deviation`, `excluded_by_amendment`, `simulated_time`. This design extends it and does not contradict it.
- **Machine**: Node 24.14, npm 11, pnpm available, Docker available. No hosted environment, no OAuth client, no secrets.
- **Registry check (6 Sep 2026)**: react 19.2, vite 8.2, @vitejs/plugin-react 6.1, react-router 8.3, @tanstack/react-query 5.102, tailwindcss 4.3 (+ @tailwindcss/vite), radix-ui 1.6, recharts 3.10, fastify 5.12, @fastify/type-provider-typebox 6.1, @sinclair/typebox 0.34, drizzle-orm 0.45, drizzle-kit 0.31, postgres 3.4, pino 10.3, vitest 5.0, @playwright/test 1.63, @axe-core/playwright 4.13, tsx 4.23, typescript 7.0 (scaffold pins 5.9.3). Existence is verified; mutual compatibility is not — see D3.
- **Authority**: PRD v0.2 governs scope and interactions; PoC v0.1 is the technical reference; protocol v1.1 defines measures; wireframes are illustrative. The specs in this change are the behavior contract; where they refine the PoC (e.g., separate recall write, result-state precedence), the specs win.

## Goals / Non-Goals

**Goals:**
- A runnable P0 journey in `local-demo` mode that exercises every measurement contract and every acceptance scenario in PRD §6 and PoC §12 that does not require hosting or real identity.
- Domain rules (calendar, eligibility, comparison, result state, progression) implemented once in `packages/shared`, unit-tested without a browser or database, and applied authoritatively by the API.
- Real recovery behavior (idempotency, dedupe, reload, clock-gap detection) rather than simulated recovery screens, because the brief asks for it and the same code is needed for a later pilot.
- A schema that a future `real` identity mode can adopt without migration of measurement tables: owner id is a text column, realm is a column, nothing assumes a single user.

**Non-Goals:**
- Better Auth / Google OAuth wiring (follow-up change `add-real-identity`); the `real` mode refusal path is the whole of auth in this change.
- Full offline-first: only an active session's events are buffered; new starts need the server.
- Research discovery, editorial queue, research tables; cards are a static fixture.
- `attested` time source entry UI (a benchmark performed entirely off-app and typed in later). The type stays; the form is deferred.
- Hosting, HTTPS, backups, rate limiting beyond a basic write limiter, email, push.
- Midpoint (Day 7) slot UI: the slot type is allowed in the schema; no screen offers it.

## Architecture

### Monorepo

```
kotkit/
  apps/
    web/                          React 19 + Vite, React Router, TanStack Query
      src/
        app/                      router.tsx, providers.tsx, layouts: RailLayout, SessionLayout
        features/
          setup/                  PlanForm, ReadinessForm
          benchmark/              Ready, Running, Recall, Scoring, BenchmarkReview
          today/                  Today, NextAction, BlockCard, CheckinCard
          focus/                  Focus, TimerDisplay, EventButtons, AgentPanel, ClockGapPrompt
          review/                 PracticeReview
          checkin/                CheckinForm, FeedRows
          progress/               Progress, ResultState, AttemptTable, PracticeTrend, ExportPreview
          research/               ResearchCards
          settings/               Preferences, DemoControls
        lib/
          api/                    typed client generated from shared contracts
          clock/                  monotonic clock, gap detector, remaining-time derivation
          outbox/                 IndexedDB buffer for the active session's events
          query/                  query keys, session-aware refetch policy
    api/                          Fastify 5 + TypeBox type provider
      src/
        server.ts                 boot: env validation, identity mode gate, host check
        plugins/                  db, identity, requestId, errors, noStore
        routes/                   me, demo, programs, sessions, days, report, export, research
        db/
          schema/                 drizzle tables (one file per aggregate)
          migrations/             drizzle-kit output, reviewed and committed
          seed/                   demo scenario fixtures
        services/                 program, session, review, checkin, report (thin orchestration over shared domain)
      test/                       inject tests against a real Postgres test database
  packages/
    shared/
      src/
        index.ts
        domain/
          types.ts                (exists) core unions and ReportedCount
          calendar.ts             program day <-> local date in stored tz
          eligibility.ts          exclusion reasons -> eligible
          firstSwitch.ts          derive FirstSwitch from events/review
          comparison.ts           S0/S14, %, low/zero baseline, result state precedence
          progression.ts          band ceilings, +5 suggestion rule
          feed.ts                 feed aggregates by scope; subset rule
        contracts/                TypeBox schemas: one file per route group; Static<> types
        fixtures/                 demo scenarios (PRD §6), research cards
  e2e/                            Playwright: acceptance scenarios + axe checks
```

### Runtime topology

```
  Browser (127.0.0.1:5173 dev)                 API (127.0.0.1:8787)               Postgres (55432)
  +-----------------------------+   /api/*     +-----------------------------+    +------------+
  | React app                   | -----------> | Fastify                     | -> | attention_ |
  |  TanStack Query cache       |  Vite proxy  |  identity plugin (mode gate)|    | lab        |
  |  session reducer            |              |  TypeBox validation         |    +------------+
  |  monotonic clock + gap det. |              |  services -> shared/domain  |
  |  IndexedDB outbox           |              |  drizzle                    |
  +-----------------------------+              +-----------------------------+
                                               static: serves built web in `build` mode
```

Dev runs two processes with a Vite proxy so cookies and origins stay simple; the production-like build serves the compiled web app from the API process on one origin, as the PoC proposes.

### Module boundaries (unchanged from PoC §4, made concrete)

| Module | Owns | Boundary enforced by |
|---|---|---|
| identity (api/plugins/identity) | mode gate, fixed principal, realm stamping, demo clock | every service receives `{ principalId, realm, now }` from the plugin; no route reads env directly |
| programs | programs, revisions, slots, calendar | `shared/domain/calendar.ts`; slot freeze check in the service transaction |
| sessions | lifecycle, events, transitions, agent plans | partial unique index for one active session; transition table in service |
| measurement | recall lock, review, eligibility, comparison | `shared/domain/{eligibility,firstSwitch,comparison}.ts`; eligibility written only by finalize |
| daily records | check-ins, feed rows | `shared/domain/feed.ts`; DB check constraint for subset |
| report/export | derived views | pure functions over stored rows; `assertSameRealm` at entry |

## Decisions

### D1 — npm workspaces, not pnpm
The scaffold's scripts already use `npm run -w`; pnpm is on the machine but adds nothing at this scale. **Alternative**: switch to pnpm as the PoC says. Rejected: churn without benefit; note the supersession in the PoC decision log.

### D2 — Identity: `local-demo` fully working, `real` refuses to boot, `local-pilot` deferred
`local-demo`: fixed principal id `local-demo`, realm `demo`, host must be loopback, banner, demo controls. `real`: boot validation lists missing prerequisites and exits; nothing else is implemented. **Alternative A**: add `local-pilot` (real data on loopback without OAuth). Rejected for this change because the brief keeps real authentication as the prerequisite for private data; recorded here so it can be reversed by a one-decision follow-up (it needs no schema change — realm and owner columns already exist). **Alternative B**: wire Better Auth now. Rejected: cannot be exercised without an OAuth client Douglas must create; would ship untested auth code.

### D3 — Version policy: verify, pin, prefer latest stable major that typechecks together
At kickoff run a scripted install of the registry versions above, then `typecheck` and a smoke test. If a peer-dependency or type conflict appears, step that package back one major and record it in `LIMITATIONS.md`. TypeScript stays on 5.9.x (the scaffold's pin); 7.x is a different compiler and out of scope to validate. Lockfile committed. **Alternative**: trust the document's implied versions. Rejected by the brief.

### D4 — Domain rules live in `packages/shared`; the API is the only writer of derived fields
`eligible`, `exclusion_reasons`, `first_switch_*`, `recall_score`, result state and progression suggestions are computed by shared pure functions and persisted (or returned) only by the API. The web app calls the same functions for previews labeled as previews. **Alternative**: compute in the API only. Rejected: the UI needs previews (eligibility hint before finalize) and duplicating logic is the bug the bundle warns about.

### D5 — Timer truth: server timestamps + monotonic display + heartbeat gap detection
`started_at`, `target_seconds`, `paused_seconds` (and `current_pause_started_at`) are the truth. The client computes remaining = target − (serverNowAtLoad + monotonicDelta − started_at − paused). A 5-second heartbeat compares `Date.now()` drift against `performance.now()`; drift > 60 s raises the clock-gap prompt and posts a `clock_gap` event. Deadline reached → client shows awaiting review; server confirms on the next transition. **Alternative**: `setInterval` accumulation. Rejected: background throttling makes it lie.

### D6 — Recovery: small IndexedDB outbox + server idempotency, not offline-first
Outbox holds only `{sessionId, events[]}` for the active session. Batches of ≤100 events. `mutation_receipts` table dedupes start/finalize by `(user_id, idempotency_key)` with a request hash; events dedupe by `(session_id, client_event_id)`. Pending/Saved/Could-not-save is a three-state derived from local-write result and ack. **Alternative**: full offline app. Rejected by PoC scope and unnecessary on loopback.

### D7 — Settling the six specification defects
1. **Nullable counts**: `episode_count`, `external_count`, `unplanned_agent_checks`, `mind_wandering_count`, `recall_score` are nullable columns; `ReportedCount` end to end; export writes empty cells. A Drizzle-level test asserts no `COALESCE(...,0)` in report queries.
2. **Disqualifying interruption**: user self-attestation `materially_disrupted` (required Yes/No on benchmark review). No threshold on `E`. One replacement per slot with reason.
3. **Recall lock**: separate `POST /sessions/{id}/recall` write sets `recall_points`, `recall_started_at`, `recall_locked_at`, `recall_delay_seconds`, `recall_duration_seconds`, `recall_flags`. Finalize requires `recall_locked_at` for benchmarks. Thresholds: delay > 600 s → `recall_delayed`; duration > 210 s → `recall_overrun` (flags, not exclusions).
4. **Result states**: precedence order fixed in `comparison.ts` (baseline pending → final pending → insufficient → zero baseline → more → unchanged → mixed → improvement). "Unchanged" added. The PRD "Mixed result" fixture is read as fewer switches (6/4 → 3/3) with lower recall (4/4 → 2/2). Every state has a fixture.
5. **Comparability on the attempt**: `session_reviews.observed_conditions` JSONB `{deviceFormat, language, materialLevel, accommodations[]}` defaulted from the slot at start, confirmed at review. Warnings computed by comparing baseline vs final attempts in the same label.
6. **Auth trigger**: identity mode is the gate. `pilot` realm rows can only be created when mode = `real`; since `real` refuses to boot, no pilot row can exist in this change. `LIMITATIONS.md` states this in one place; the three documents get a dated decision-log entry pointing to it.

### D8 — Demo clock is server-side, per principal
`user_profiles.demo_clock_offset_seconds` (only writable in demo mode). The identity plugin computes `now = realNow + offset` and every service uses `ctx.now`. Records created with offset ≠ 0 get `time_source = 'demo_clock'`. **Alternative**: client-side fake time. Rejected: the server derives program day and eligibility; two clocks would disagree.

### D9 — Events are append-only; undo is a void marker
`session_events.voided_at` set by `POST /sessions/{id}/events/{clientEventId}/void`; counts exclude voided rows; void is refused after finalize. **Alternative**: delete row. Rejected: loses the audit trail the measurement contract wants.

### D10 — Two writes for a benchmark review, one for practice
Benchmark: `recall` (lock) then `finalize` (scores + counts + attestation + conditions). Practice: `finalize` only. Both idempotent. This is the smallest API change that satisfies P-03.

### D11 — Agent check as a subtype
An `agent_check` event carries `details.alsoOffTask: boolean`. Off-task tally = off_task events + agent_check events with `alsoOffTask`; agent-check tally = all agent_check events. Nothing is summed across the two tallies.

### D12 — Check-in completeness
Complete = `sleep_minutes` reported AND at least one `feed_usage` row (an explicit zero row counts). Stored as derived status, computed in `feed.ts`, never inferred from row existence alone.

### D13 — Research cards are a fixture
Three cards from the protocol's evidence table (Castelo 2025; Mrazek 2013; Leroy & Glomb 2018) in `shared/fixtures/researchCards.ts`, curated date 2026-09-06. No table, no job.

### D14 — Test strategy
- `packages/shared`: Vitest unit tests for every domain function; the PRD §6 and PoC §12 numeric scenarios are table-driven tests.
- `apps/api`: Fastify `inject` tests against a real Postgres test database (`attention_lab_test`), covering idempotency, one-active-session, slot freeze, recall lock, finalize count mismatch, realm stamping, ownership 404s, mode refusal.
- `e2e/`: Playwright against the built app in demo mode: the eight PRD scenarios as journeys, hidden-tab-no-episode, refresh recovery, two-tab conflict, keyboard-only review, axe on core screens. Clock gaps are simulated by overriding `Date.now` via `page.clock`.

### D15 — Session-aware query policy
TanStack Query `refetchOnWindowFocus` is disabled while a session is active so returning to the tab never triggers a refetch storm or a visibility side effect. Visibility is never recorded as an event unless the user enables the opt-in context flag in Settings (default off; when on, it is a `visibility` event type excluded from every count).

## Decisions settled during task decomposition (D16–D40)

The task decomposition (2026-09-07) exposed points the sections above leave open or state inconsistently. These decisions are binding for tasks.md; where they differ from a table above, the decision wins and the table is read as amended.

### Ownership and de-duplication

- **D16 — One owner per shared piece.** Web component-test harness (jsdom, Testing Library, `renderWithProviders`, `mockClient`, `fakeOutbox`, `expectNoIdentifiers`) is created once in group 7 (7.1.1). `useStartSession` lives in 7.4.4; `finalizeWithSync`/`abandonWithPurge` in 7.3.4 and the React hook `useFinalizeSession` (7.3.5) wraps them, persisting the idempotency key in `sessionStorage` under `finalize:{sessionId}` (the only browser-storage write besides IndexedDB). One `SyncStatus` component (8.5.2: Pending + Retry, Saved, "could not be saved on this device" + keep-trying) is used by Focus and Benchmark Running. One `ActiveSessionCard` (8.2.5) replaces Start controls on Today and Benchmark Ready and renders the 409 `active_session_exists` / stale-transition notices. One `AbandonSession` control (8.10.7) is mounted in `SessionLayout` for every session screen; Focus and Benchmark Running render no Abandon of their own. Recall rules live in `packages/shared/src/domain/recall.ts` (2.3.2). Check-in completeness lives only in `packages/shared/src/domain/feed.ts` (`checkinStatus`, 2.6.2) and is called by Today (4.5) and days (6.1). Playwright support helpers (`e2e/support/{demo,clock,copy,a11y}.ts`) are created in 7.1.5 and reused by every later e2e unit. API test infrastructure: 1.5.1 Vitest configs, 1.5.2 test-DB globalSetup, 3.2.1 `buildTestApp`/`captureLogs`/`truncateAll`, 4.1.1 program seed helpers, 5.1.3 session seed helpers — no unit re-creates a lower layer.
- **D17 — No page-load auto-redirect.** On boot the `SessionModeProvider` (7.4.2) fetches `GET /sessions/active`, replays that session's outbox rows once, purges rows of any other session, and exposes the session; screens decide what to render (Today shows `ActiveSessionCard`; a session route re-derives remaining time from server fields). No resolver redirects the user.

### Contracts and error envelope

- **D18 — Error envelope carries `details`.** `{ code, message, fieldErrors?, details?, retryable, requestId }`. `details` is a small structured object and never carries note text: `active_session_exists → { activeSessionId }`; `event_count_mismatch → { expected, stored }`; `stale_version → { current: <resource> }`; `slot_frozen → { phase, label }`; `program_exists → { existingProgramId, existingStatus }`.
- **D19 — Error code vocabulary.** 400 `malformed_request`; 404 `not_found` (missing or not owned, message "Not found"); 409 `program_exists`, `active_session_exists`, `idempotency_mismatch`, `stale_version`, `slot_frozen`, `event_count_mismatch`, `already_finalized`, `session_not_active`, `session_not_ended`, `interval_not_ended`, `recall_locked`, `not_finalized`, `invalid_status_transition`, `program_terminal`; 422 `realm_mismatch`, `feed_subset_violation`, `feed_platform_conflict`, `duplicate_feed_row`, `baseline_times_too_close`, `readiness_regression`, `before_slot_date`, `slot_full`, `replacement_reason_required`, `eligible_attempt_not_retaken`, `practice_only`, `benchmark_only`, `benchmark_only_field`, `practice_only_field`, `impossible_offset`, `invalid_transition`, `recall_before_interval_end`, `recall_not_locked`, `effective_day_in_past`, `date_locked`; 429 `write_limit` (reserved; no limiter is implemented in this change — loopback only). `realm_mismatch` uses the fixed message "Simulated and real results are never combined." and never echoes realm values.
- **D20 — Session response shape** (POST /sessions 201, GET /sessions/active, GET /sessions/{id}, transitions, clock-gap, finalize): stored columns in camelCase plus `serverNow` (ISO, from `ctx.now`), `timing: { elapsedSeconds, remainingSeconds, deadlineReached, isPaused }`, `tallies: { offTask, external, agentChecks }` (no combined field), `eventCount` (every stored `session_events` row, voided included), `events[]` (voided rows carry `voidedAt`), `review` (every `ReportedCount` as JSON null, never 0; `firstSwitch` nullable), `agentPlan | null`, `amendments[]`. `GET /sessions/active` returns 204 when none. GET is strictly read-only; only transitions, clock-gap and finalize change lifecycle.
- **D21 — Idempotent creates** return 201 on first write and 200 on replay; a rejected request (any 4xx) records no receipt, so a finalize retried with the same key after an `event_count_mismatch` is accepted. `expectedEventCount` means the total `session_events` rows for the session (all types, voided included); clients derive it from `eventCount` + rows in `lastBatch`.
- **D22 — Other response shapes.** `GET /programs/current` → 200 with `program: null, revision: null, slots: [], day: null, nextAction: { kind: 'setup' }` when no open program; `slots[]` carry `attempts: [{ sessionId, lifecycle, eligible, excludedByAmendment }]`. `PUT /programs/{id}/benchmark-slots` → `{ program, slots, missing: [{ phase, label, fields }] }`. `GET /programs/{id}/today.checkin` → `{ status, missing[], values: { sleepMinutes, phoneFeedMinutes, desktopFeedMinutes } }` (nulls preserved). `GET /programs/{id}/days/{date}` with no row → 200 `{ checkin: all-null, feed: [], status: { status: 'not_reported', missing: ['sleep','feed'] }, aggregates, version: 0 }`; the first PUT sends `expectedVersion: 0`. `POST /demo/scenarios/{name}/load` takes no body (the UI confirms) and returns `{ programId: string | null }`. Preferences gain `milestoneAnnouncements: boolean` (default false). AJV is configured `coerceTypes: false, removeAdditional: false, useDefaults: false` so `null` is never coerced to `0` and unknown keys are 400.

### Sessions, benchmarks, recovery

- **D23 — Late starts.** A benchmark may start on or after its slot's assigned date (never before); a start after the date needs no reason, is recorded with the actual `local_date`, and eligibility labels it `timing_deviation`. `nextAction` keeps pointing at a pending baseline slot on Days 0–13 and at a pending final slot on Day 14 and after (`final(slot)` while any final slot lacks a finalized attempt), so late attempts remain reachable from Today; `progress` only when all four slots have finalized attempts or the program is terminal. The Ready screen offers Start with a visible timing-deviation notice on late dates.
- **D24 — Deadline is confirmed by an `end` transition, never by GET.** At the deadline the client shows "Close your reading material" / "Block time reached" and its continue action ("I'm ready for recall" / "Review") posts `transitions { type: 'end' }`; the server sets `ended_at` and `complete_interval = elapsed ≥ target`. A `finalize` on a session that is not `awaiting_review` is 409 `session_not_ended`.
- **D25 — Incomplete benchmarks and `recall_missing`.** After Stop early or `save_incomplete` (`complete_interval = false`) the client opens the incomplete review: recall is offered but may be skipped, and finalize is accepted without a recall lock; eligibility then carries `recall_missing` (and `scoring_incomplete`). For a complete interval, finalize without a recall lock is 422 `recall_not_locked`. `save_incomplete` = end + `timer_quality = 'uncertain'`; it never finalizes by itself.
- **D26 — Clock gaps.** `clock_gap_seconds` accumulates (explicit NULL branch, never `?? 0`). The client-posted `clock_gap` event carries `details: { gapSeconds, resolution }` once resolved; on reload a `clock_gap` event without a `resolution` re-opens the prompt. If a `clock_gap` event without resolution exists at finalize, the server forces `timer_quality = 'uncertain'` (unresolved uncertainty persists as a flag). Copy: title "Did the interval continue uninterrupted?", options "Yes, it continued", "No", "Not sure", "Save as incomplete".
- **D27 — Recall `startedAt`** is sent in server-aligned time (7.2.1 `serverNowMs`); the server rejects `startedAt < ended_at` (422 `recall_before_interval_end`) or `> now`.
- **D28 — Undo.** An unsent event is dropped from the outbox; a sent event is voided via `POST .../void`. Server-written `pause`/`resume` rows are not voidable (422).
- **D29 — Transitions `reason`** is stored only on `pause` events (`details.reason`, e.g. `planned_break`); it is accepted and ignored for `end`/`abandon`. `paused → abandoned` is allowed (abandon is always available).
- **D30 — Practice `targetSeconds`** on start may be any value in 300..1500 step 300 (contract); the server stores it as given (holding a target is a client choice). Benchmarks always store 1200; any other value is 422.
- **D31 — Review row** is created at session start (`observed_conditions` from the slot for benchmarks; the empty `ObservedConditions` for practice) and updated by recall/finalize. `session_reviews` gains `review_note text NULL` (the optional free-text note); `output_note` is the one-line "what did you finish". Prefill rule: a count field is prefilled with the tally and `countMethod = 'event'` when any counted event exists for the session, otherwise blank.
- **D32 — Amendments** are accepted on finalized sessions of either kind (201), listed on the session response, and honored by the report and the replacement rule through the shared `applyAmendmentExclusion` overlay; stored `eligible`/`exclusion_reasons` are never rewritten.
- **D33 — Program status.** `baseline_ready → active` happens automatically when the second baseline attempt is finalized; `completed`/`archived` are explicit via PATCH (`baseline_ready|active → completed`, any non-terminal → `archived`). Revision 1 is `{ effectiveDay 0, reason: 'initial plan' }`; later revisions need `effectiveDay ≥ current day` and `≤ 14`; `current_revision_id` is the newest revision and `governingRevisionFor(revisions, day)` picks the greatest `effective_day ≤ day`. Leisure allowance edits via PATCH change `programs.leisure_allowance_min` only.

### Data and demo

- **D34 — Realm columns** stay on the aggregate roots (`programs`, `focus_sessions`, `daily_checkins`); child rows inherit through their parent and every query scopes by the parent's `user_id`/`realm`. Fixture rows loaded by a scenario are `time_source = 'demo_clock'`.
- **D35 — Scenario fixtures** encode dates as program-day numbers and seconds relative to the load instant (`viewDay`, `startedAtOffsetSeconds`); loading resets the demo clock to 0 and sets `baseline_date = today(program tz) − viewDay`. `timing-deviation` loads a *running* baseline A (started 18 min before load) with an unresolved 300 s `clock_gap` event so the journey resolves it; `recovery` loads a running practice session (the unsynced batch is created client-side by the journey); each fixture exports `expected.resultState`. Loopback accepts `127.0.0.1`, `localhost` and `::1`. Demo reset keeps the profile row (timezone, preferences) and zeroes the offset. `POST /demo/clock` sets an absolute offset.
- **D36 — Feed rows.** The headline phone/desktop inputs are rows with `platform = 'all'`, scope `feed`, source `estimate`. A device may have either its `all` row or platform rows, never both (422 `feed_platform_conflict`); the UI disables the headline input when detail rows exist for that device. Completeness (D12 refined) = `sleep_minutes` reported AND at least one scope-`feed` row (an explicit zero counts). `partial` = phone or desktop has no feed-scope row.
- **D37 — Static serving and runtime.** The API runs from TypeScript source under `tsx` (no compiled API artifact); when `WEB_DIST_DIR` is set it serves that directory with an SPA fallback for non-`/api` paths (3.2.5). The Playwright acceptance project runs `npm run build` then starts the API with `WEB_DIST_DIR=apps/web/dist` against the `db:up` database, isolating tests with `POST /demo/reset`. `engines.node` becomes `>=22.9` (for `--env-file-if-exists`). Workspace names are `@attention-lab/shared|api|web`; every verify command uses them.

### UI additions the specs require

- **D38 — Missing screens/controls.** Progress attempts table gets an "Explain or exclude" control (`AmendmentDialog`, 8.8.6). Settings gets "Change practice duration" (manual revision with reason, 8.9.5) and a link "Edit benchmark materials" to `/setup/readiness`, which stays reachable while the program is open. Copy: leave guard "A session is in progress" / "Return to session" / "Leave anyway"; abandon "Abandon this session? Unsent entries on this device will be discarded; the attempt stays in your record as abandoned."; improvement headline "Fewer reported switches" above the PRD line.
- **D39 — Timer announcements** follow `preferences.milestoneAnnouncements` (5:00 and 0:00 only). Visibility context, when enabled, is recorded by the session screens as a `visibility` event (excluded from every tally).
- **D40 — Recorded in LIMITATIONS.md**: receipts expire on the demo clock; graceful shutdown verified on POSIX only; recovery and hidden-tab behavior verified under paired simulated clocks (`page.clock` + `POST /demo/clock`), not field-tested; touch targets use the WCAG 2.2 AA 24×24 minimum; research-card provenance recorded as abstract-reviewed pending Douglas's confirmation.

## Database model

All ids are UUID text unless noted; `user_id` is text (future auth adapter compatibility). Timestamps are `timestamptz`; local dates are `date`; durations are integer seconds. **Nullable means not reported.**

```
user_profiles            programs                       protocol_revisions
-------------            --------                       ------------------
id text PK               id PK                          id PK
timezone text            user_id -> user_profiles       program_id -> programs
preferences jsonb        realm demo|pilot               revision int
demo_clock_offset_s int  baseline_date date             effective_day int
created_at               timezone text                  settings jsonb
                         status draft|baseline_ready|     {practiceTargetSeconds,
                                active|completed|          bandCeilings, leisureAllowanceMin}
                                archived                reason text
                         leisure_allowance_min int      created_at
                         feed_estimate_min int NULL     UNIQUE(program_id, revision)
                         current_revision_id -> revisions
                         version int
                         PARTIAL UNIQUE(user_id) WHERE status IN (draft, baseline_ready, active)

benchmark_slots                          focus_sessions
---------------                          --------------
id PK                                    id PK
program_id -> programs                   user_id, program_id, revision_id, slot_id NULL
phase baseline|midpoint|final            realm
label A|B                                kind practice|benchmark
material_ref text                        lifecycle running|paused|awaiting_review|finalized|abandoned
language text NULL                       target_seconds int
device_format text NULL                  started_at, ended_at NULL
material_level text NULL                 paused_seconds int, current_pause_started_at NULL
planned_local_time time NULL             local_date date            (program tz at start)
assigned_local_date date                 intended_output text NULL  (practice)
frozen_at NULL                           time_source measured|demo_clock|attested
UNIQUE(program_id, phase, label)         timer_quality ok|uncertain
                                         clock_gap_seconds int NULL
                                         complete_interval bool NULL
                                         eligible bool NULL
                                         exclusion_reasons text[]
                                         replacement_reason text NULL
                                         version int
                                         CHECK (kind='benchmark') = (slot_id IS NOT NULL)
                                         PARTIAL UNIQUE(user_id) WHERE lifecycle IN (running, paused, awaiting_review)
                                         INDEX(program_id, kind, local_date)

session_events                           session_reviews
--------------                           ---------------
id PK                                    session_id PK -> focus_sessions
session_id -> focus_sessions             episode_count int NULL
client_event_id uuid                     count_method event|retrospective NULL
type off_task|external|agent_check|      first_switch_kind none_capped|known|unknown NULL
     pause|resume|clock_gap|visibility   first_switch_seconds int NULL
occurred_at                              first_switch_method event|estimate NULL
elapsed_ms int NULL                      external_count int NULL
received_at                              unplanned_agent_checks int NULL
details jsonb                            mind_wandering_count int NULL
voided_at NULL                           output_quality yes|partly|no NULL
UNIQUE(session_id, client_event_id)      output_note text NULL
INDEX(session_id, elapsed_ms)            materially_disrupted bool NULL
                                         disruption_note text NULL
session_amendments                       recall_points jsonb NULL      (5 strings)
------------------                       recall_started_at NULL
id PK                                    recall_locked_at NULL
session_id, user_id                      recall_delay_seconds int NULL
reason text                              recall_duration_seconds int NULL
exclude_from_report bool                 recall_flags text[]           (recall_delayed, recall_overrun)
created_at                               recall_scores jsonb NULL      (5 x 0|1)
                                         recall_score int NULL
agent_plans                              observed_conditions jsonb
-----------                              finalized_at NULL
session_id PK -> focus_sessions          version int
workstream, waiting_task, resume_note
review_checkpoint text ('end_of_block')  daily_checkins                 feed_usage
review_at NULL                           --------------                 ----------
version int                              id PK                          id PK
                                         program_id, realm              checkin_id -> daily_checkins
mutation_receipts                        local_date date                device phone|desktop|tablet|unspecified
-----------------                        sleep_minutes int NULL         platform text
user_id, idempotency_key uuid            stress int NULL (0-10)         minutes int
operation text                           mindfulness_minutes int NULL   short_video_minutes int NULL
request_hash text                        note text NULL                 measurement_scope feed|app_total
result_ref text                          version int                    source estimate|device_report
created_at, expires_at (7 days)          UNIQUE(program_id, local_date) planned_window bool NULL
PK(user_id, idempotency_key)                                            UNIQUE(checkin_id, device, platform, measurement_scope)
                                                                        CHECK(short_video_minutes IS NULL OR short_video_minutes <= minutes)
```

Relationships: `user_profiles 1-* programs 1-* protocol_revisions`; `programs 1-* benchmark_slots`; `programs 1-* focus_sessions`; `benchmark_slots 0..2 focus_sessions` (enforced in the start transaction with a slot row lock); `focus_sessions 1-* session_events`, `1-0..1 session_reviews`, `1-0..1 agent_plans`, `1-* session_amendments`; `programs 1-* daily_checkins 1-* feed_usage`. Ownership is checked on every nested resource by joining to `user_id` (sessions) or `programs.user_id` (checkins, slots). No research tables in this change.

Migrations: additive only; generated by drizzle-kit, reviewed and committed; applied by `npm run db:push` in dev and by `drizzle-kit migrate` in the test setup.

## API contracts

Base `/api/v1`. All bodies and responses are TypeBox schemas in `packages/shared/src/contracts`; the API rejects unknown properties. Every response carries `x-request-id`; private responses carry `Cache-Control: no-store`. Errors: `{ code, message, fieldErrors?, retryable, requestId }` with 400 malformed, 404 missing-or-not-owned, 409 conflict (stale version, active session exists, idempotency mismatch, frozen slot, event-count mismatch), 422 domain inconsistency (subset rule, realm mixing, replacement of eligible attempt), 429 write limit. Idempotent mutations take an `Idempotency-Key` header (UUID).

| Method and route | Body → Response | Behavior |
|---|---|---|
| `GET /me` | → `{ principalId, identityMode, realm, timezone, preferences, demoClockOffsetSeconds }` | Fixed principal in demo mode |
| `PATCH /me/preferences` | `{ timezone?, hideTimerDefault?, endChime?, visibilityContext? }` | Timezone validated as IANA |
| `POST /demo/clock` | `{ offsetSeconds }` | Demo mode only; 404 otherwise |
| `POST /demo/scenarios/{name}/load` | → `{ programId }` | Replaces principal's demo data; names per PRD §6 |
| `POST /demo/reset` | → 204 | Deletes all demo rows for the principal |
| `POST /programs` (IK) | `{ baselineDate, timezone, practiceTargetSeconds, leisureAllowanceMinutes?, feedEstimateMinutes? }` → program + revision 1 | 409 if a non-terminal program exists |
| `GET /programs/current` | → `{ program, revision, slots[], day, nextAction }` | `nextAction` ∈ setup, readiness, benchmark(slot), practice(block), final(slot), progress |
| `PATCH /programs/{id}` | `{ expectedVersion, status?, baselineDate?, leisureAllowanceMinutes? }` | Date edits only while draft |
| `PUT /programs/{id}/benchmark-slots` | `{ expectedVersion, slots: [{phase,label,materialRef,language?,deviceFormat?,materialLevel?,plannedLocalTime?}] }` | Atomic; frozen slots must be unchanged (409); baseline A/B ≥ 1 h apart (422); sets status baseline_ready when complete |
| `POST /programs/{id}/revisions` | `{ effectiveDay, settings, reason }` | Reason required; past sessions untouched |
| `GET /programs/{id}/today` | → `{ day, localDate, blocks[2], checkin: {status,missing[]}, suggestion?, nextAction }` | Uses program tz / demo clock |
| `POST /sessions` (IK) | `{ programId, kind, slotId?, intendedOutput?, targetSeconds?, replacementReason?, conditions? }` → session | 409 `active_session_exists` with id; 422 for slot rules |
| `GET /sessions/active` | → session or 204 | Includes derived remaining time and event tallies |
| `GET /sessions/{id}` | → session with events, review, plan | Owned only |
| `POST /sessions/{id}/events` | `{ events: [{clientEventId,type,elapsedMs,occurredAt,details?}] }` → `{ accepted[], duplicates[] }` | ≤100 per batch; impossible offsets 422; after finalize → stored with `reconciliation_warning` |
| `POST /sessions/{id}/events/{clientEventId}/void` | → event | 409 after finalize |
| `POST /sessions/{id}/transitions` | `{ expectedVersion, type: pause\|resume\|end\|abandon, reason? }` → session | Benchmark pause → 422; end → awaiting_review |
| `POST /sessions/{id}/clock-gap` | `{ gapSeconds, resolution: continued\|uncertain\|save_incomplete }` → session | Sets timer_quality; save_incomplete ends the session |
| `PUT /sessions/{id}/agent-plan` | `{ expectedVersion, workstream?, waitingTask?, reviewCheckpoint?, resumeNote? }` | Practice only |
| `POST /sessions/{id}/recall` (IK) | `{ points[5], startedAt, durationSeconds }` → review | Benchmark only; locks; second call same content → 200, different → 409 |
| `POST /sessions/{id}/finalize` (IK) | `{ expectedEventCount, lastBatch?, review: {episodeCount?, countMethod?, firstSwitchEstimateSeconds?, externalCount?, unplannedAgentChecks?, mindWanderingCount?, outputQuality?, outputNote?, materiallyDisrupted?, disruptionNote?, recallScores?, conditions?} }` → `{ session, review, eligible, exclusionReasons[] }` | Atomic; count mismatch 409 with `{expected, stored}`; benchmark requires recall locked and disruption answered |
| `POST /sessions/{id}/amendments` | `{ reason, excludeFromReport }` → amendment | Append-only |
| `GET/PUT /programs/{id}/days/{date}` | `{ expectedVersion, sleepMinutes?, stress?, mindfulnessMinutes?, note?, feed: [...] }` → checkin with status | Atomic replace of feed rows; subset rule 422 |
| `GET /programs/{id}/report` | → `{ realm, samples, attempts[], comparison?, resultState, warnings[], practice[], days[], revisions[] }` | `assertSameRealm`; no percentage unless 2+2 eligible |
| `GET /programs/{id}/export?format=csv\|markdown` | → text | no-store; demo label first line; blanks empty |
| `GET /research/cards` | → 3 cards | Static fixture |

## UX flows

### Route map

```
 /setup                 -> /setup/readiness -> /today
 /benchmark/:slotId     ready -> running -> /benchmark/:sessionId/recall -> /scoring -> /today (or next slot)
 /today                 -> /focus/:sessionId -> /review/:sessionId -> /today
 /today (check-in card) -> /checkin/:date -> /today
 /progress              (export preview inline)
 /research  /settings   (settings hosts demo controls in demo mode)
 Session layout (no nav): /benchmark/*, /focus/*, /review/*
```

### Session lifecycle (one machine, kind-gated)

```
        server accepts start
 [*] ---------------------------> Running
  Running --pause (practice only)--> Paused --resume--> Running
  Running --target reached-------> AwaitingReview
  Running --end (early)----------> AwaitingReview   (benchmark: complete_interval=false)
  Paused  --end------------------> AwaitingReview
  AwaitingReview --finalize------> Finalized        (benchmark: requires recall locked)
  Running|AwaitingReview --abandon-> Abandoned
  any --clock gap detected-------> same state + prompt; resolution sets timer_quality
```

### P0 journey, screen by screen

1. **Setup** (`/setup`): date, timezone (prefilled, must confirm), duration (5/10/15), leisure allowance (20 default), feed estimate (optional, "estimate"). Save → draft → `/setup/readiness`.
2. **Readiness**: four material refs with A/B baseline/final assignment, baseline A/B times (≥1 h apart), finals default to same times. Missing items listed. Save complete → baseline_ready → `/today` "Start with your baseline".
3. **Benchmark ready** (`/benchmark/:slotId`): material, checklist, "leaving this page to read does not count", Start. Unavailable before the slot date.
4. **Benchmark running**: 20:00 countdown (hide option), Record off-task, External interruption, Undo, Stop early. No pause. Hidden tab does nothing. Deadline → "Close your reading material" + "I'm ready for recall".
5. **Recall**: 3:00 countdown, five inputs, Save recall (locks). Delay/overrun flags recorded silently, shown in review.
6. **Scoring + review**: locked points read-only with Accurate/Not accurate per non-blank point; S (prefilled from events or blank), E, M optional, first-switch state (estimate optional when Unknown), disruption Yes/No (required), conditions confirm, Finalize → eligibility summary → next slot or Today.
7. **Today**: Day N of 14, next action, block 1/2 with target, check-in card (sleep, phone, desktop), suggestion banner when pending (Accept / Hold).
8. **Focus**: intended output entered on Today; timer (hide, chime), Record off-task (primary), External, Agent check (with "also off-task" toggle), Undo, Pause / Resume, Finish early; collapsed agent panel (workstream, useful task, checkpoint, resume note, Return to my task, Take a screen-free break = pause). Sync state word.
9. **Practice review**: output line, Yes/Partly/No, counts prefilled or blank, note, Save → finalized → Today.
10. **Check-in**: sleep, phone feed, desktop feed visible; expand for platform rows, scope, source, short-video, stress, mindfulness, note; Save (incomplete allowed; status shown).
11. **Day 14**: Today's next action becomes final A then B; same screens as 3–6 with phase final; conditions defaulted from the final slot.
12. **Progress**: samples line, attempts table, comparison card (state copy per precedence), comparability warnings, practice section, daily section, export preview with CSV/Markdown download.

### Recovery flows

```
 Connection lost:   event -> local write ok? --yes--> "Pending" + Retry ; timer continues
                                             --no---> "Entries could not be saved on this device"
 Reload:            GET /sessions/active -> derive remaining -> replay outbox -> resume view
 Clock gap > 60s:   prompt "Did the interval continue uninterrupted?"
                    Yes -> continued (gap recorded)   No/Not sure -> uncertain   Save as incomplete -> end
 Finalize mismatch: 409 {expected, stored} -> flush outbox -> retry same key
 Second tab:        GET /sessions/active returns existing -> render it; POST /sessions -> 409
```

## Non-functional requirements

| Area | Requirement | How verified |
|---|---|---|
| Measurement integrity | No null→0 coalescing; no visibility-derived events; no double counting; benchmark ≠ practice | Domain unit tests; API tests; a grep-based test that report queries contain no `COALESCE(..., 0)` |
| Idempotency | Same start/finalize/batch → one logical record | API inject tests |
| Concurrency | One unfinished session per user; stale version → 409 | Partial unique index + tests |
| Responsiveness | Local tally feedback < 100 ms; API p95 < 500 ms locally; report < 1 s at 100k events | Playwright timing assertion; simple load script against seeded DB |
| Timer accuracy | Foreground display within ~1 s of server truth; background alerts best-effort | Playwright with `page.clock` |
| Recovery | Refresh, disconnect, sleep, two tabs preserve consistent records | Playwright scenarios |
| Privacy | Note text never logged; `no-store` on private responses; no tokens in browser storage; loopback only in demo | Log capture test; header test; boot test |
| Accessibility | WCAG 2.2 AA on core flow; keyboard-only review; no per-second announcements; reduced motion | axe in Playwright; manual keyboard pass |
| Burden | Daily check-in ≤ 2 min | Usability script (PRD §9), not automated |
| Portability | CSV + Markdown export with provenance | Snapshot tests on fixtures |
| Observability | Request id, route, status, duration, failed-write and duplicate-suppression counts; no per-tick telemetry | Pino structured logs; log assertion tests |
| Data safety | Additive migrations only; local DB droppable; demo reset explicit | Migration review; reset test |

## Risks / Trade-offs

- [New majors (Vite 8, React Router 8, Tailwind 4) may not co-install cleanly] → D3 step-back policy; kickoff task verifies before any feature work.
- [Real recovery code is untestable for true network loss on loopback] → Playwright `route.abort()` and `context.setOffline()` simulate it; documented in LIMITATIONS.md as simulated, not field-tested.
- [Demo-only data means Douglas cannot start his real Day 0 on this build] → recorded in D2; follow-up change `add-real-identity` (or a `local-pilot` decision) unblocks it without schema change.
- [Self-attested disruption can be gamed] → it is the user's own experiment; the attestation is stored and exported; the report never hides excluded attempts.
- [Recall thresholds (600 s delay, 210 s duration) are chosen, not validated] → flags only, never exclusions; thresholds are constants in `shared/domain` and listed in LIMITATIONS.md.
- [Result-state precedence could surprise] → every state has a fixture and a test; copy comes from the PRD table; "unchanged" is the only new copy.
- [Scope is large for one change] → tasks are ordered so a vertical slice (setup → one benchmark → report) works before breadth; each group ends with a runnable state.
- [TypeScript 7 temptation] → explicitly out of scope; pinned 5.9.x.

## Migration Plan

Greenfield; no production data. Bootstrap: `cp .env.example .env` → `npm install` → `npm run db:up` → `npm run db:push` → `npm run dev:api` + `npm run dev:web`. Test DB `attention_lab_test` created by the test setup and migrated with drizzle-kit. Rollback is `npm run db:down` and dropping the container's volume; nothing else exists to roll back. Document edits are additive decision-log entries; `CLAUDE.md`'s stale "no source code" paragraph is corrected in place because it is guidance, not history.

## Open Questions

- Exact copy for the clock-gap prompt and the incomplete-save confirmation (does not change behavior).
- Whether the end-of-block chime should be on by default (preference default; either is spec-compliant).
- Which three research cards to feature if Douglas prefers different ones from the evidence table (fixture content only).
