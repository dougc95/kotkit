# Limitations

This document is filled in incrementally as the `build-initial-mvp` change is implemented.
Sections marked "filled in 10.4" were completed by task 10.4.1 once every other group had
landed, so their content reflects what actually ran, not what was planned.

## Identity gate (D2)

`local-demo` is fully working: a single fixed principal (`local-demo`), every record stamped
`realm='demo'`, a permanent banner, and a boot-time refusal on any host other than `127.0.0.1`,
`localhost` or `::1`.

`real` refuses to boot until its four prerequisites exist (`AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `AUTH_INVITE_ALLOWLIST`) and Better Auth is wired in a follow-up change
(`add-real-identity`).

`local-pilot` (real data on loopback without OAuth) is deferred and reversible by one decision —
it needs no schema change, since the `realm` and `user_id` columns already exist. Because `real`
refuses to boot in this change, no `pilot`-realm row can ever be created here (see design.md D7.6).

## Version pins (D3)

Mutual compatibility between these packages was verified only by `typecheck` + `build` + boot
checks + `db:push` + `playwright --list` succeeding together on Node 24.14 / npm 11 / Windows 11
(task 1.1.2). No further cross-package integration testing beyond what this change's own test
suite exercises has been done.

| package | registry version (2026-09-06) | pinned | step-back reason |
|---|---|---|---|
| react | 19.2 | 19.2.8 | none |
| react-dom | 19.2 | 19.2.8 | none |
| vite | 8.2 | 8.2.2 | none |
| @vitejs/plugin-react | 6.1 | 6.1.1 | none |
| react-router | 8.3 | 8.3.1 | none |
| @tanstack/react-query | 5.102 | 5.102.8 | none |
| tailwindcss | 4.3 | 4.3.3 | none |
| @tailwindcss/vite | 4.3 | 4.3.3 | none |
| radix-ui | 1.6 | 1.6.7 | none |
| recharts | 3.10 | 3.10.1 | none |
| fastify | 5.12 | 5.12.3 | none |
| @fastify/type-provider-typebox | 6.1 | 6.1.0 | none |
| @sinclair/typebox | 0.34 | 0.34.52 | none |
| drizzle-orm | 0.45 | 0.45.2 | none |
| drizzle-kit | 0.31 | 0.31.10 | none |
| postgres | 3.4 | 3.4.9 | none |
| pino | 10.3 | 10.3.1 | none |
| vitest | 5.0 | 5.0.0 | none |
| @playwright/test | 1.63 | 1.63.0 | none |
| @axe-core/playwright | 4.13 | 4.13.0 | none |
| tsx | 4.23 | 4.23.13 | none |
| typescript | 5.9.3 (never 7.x) | 5.9.3 | none |

No install-time ERESOLVE or type conflict occurred; every package installed and typechecked
together at its intended major.minor on the first attempt, so no D3 step-back was needed.

**Web component-test harness packages (7.1.1), added to the registry check on 2026-09-08** — not
in the original 6 Sep list because it only covered group 1-6 packages:

| package | registry version (2026-09-08) | pinned | step-back reason |
|---|---|---|---|
| @testing-library/react | 16.3.3 | 16.3.3 | none |
| @testing-library/user-event | 14.6.7 | 14.6.7 | none |
| @testing-library/jest-dom | 7.0.1 | 7.0.1 | none |
| fake-indexeddb | 6.2.5 | 6.2.5 | none |
| jsdom | 30.0.1 | **29.1.1** | `jsdom@30.0.1` declares `engines.node: "^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0"`; this machine runs Node 24.14.1, one minor below the 24.x floor, so `npm install` printed an `EBADENGINE` warning (not a failure). Per D3's step-back policy the package was stepped back one major to `jsdom@29.1.1`, whose floor is `>=24.0.0` — this range includes 24.14.1 with no warning. Vitest's `jsdom` environment behaves identically for this change's needs at 29.x; nothing in the harness exercises a jsdom-30-only API. |

**Type-level conflict found during 3.5.1, no version step-back taken.**
`@fastify/type-provider-typebox@6.1.0`'s ESM entry point imports its `TSchema`/`Static<>` machinery
from its own bundled `typebox` package (v1.3.x, the successor library), not from
`@sinclair/typebox@0.34.52` (the package every schema in `packages/shared/src/contracts` is built
with). Registering a route with `FastifyPluginAsyncTypebox`'s automatic type inference against a
`Lit()`-built literal-union schema (e.g. `RealmSchema`, `IdentityModeSchema`) resolves
`Static<this['schema']>` to a field type of `never` instead of the real literal union — a real
type conflict, just one `pins.smoke.ts` and `contracts.typecheck.ts` (which only exercise each
package's type entry point and two plain object bodies, never a route registration) did not
exercise. Stepping either package back a major was not attempted: it is not known to fix a
cross-package type-brand mismatch like this, and would ripple into every other pinned version.
The chosen mitigation, used from 3.5.1 onward: routes are typed with Fastify's own manual
per-route generics (`app.get<{ Reply: X }>`, `app.patch<{ Body: Y; Reply: X }>`, `X`/`Y` the
contract's own exported `Static<>` alias) instead of `FastifyPluginAsyncTypebox`'s automatic
inference; the schema objects themselves are still passed to Fastify/AJV unchanged and validate
identically at runtime — only the compile-time inference path changes.

## Specification defects settled (D7)

One line per defect from `CLAUDE.md`'s "Known open defects in the specification"; the full
resolution for each is in `design.md`'s D7.

1. **Nullable count columns** — `episode_count`, `external_count`, `unplanned_agent_checks`,
   `mind_wandering_count` and `recall_score` are nullable columns end to end (design.md D7.1).
2. **Disqualifying interruption** — settled as a required self-attestation
   (`materially_disrupted`), not a threshold on the interruption count (design.md D7.2).
3. **Recall lock before self-scoring** — a separate `POST /sessions/{id}/recall` write locks the
   five points before scoring is reachable (design.md D7.3).
4. **Result-state precedence** — a fixed precedence order is implemented in `comparison.ts`, with
   a fixture for every state, including the added `unchanged` state (design.md D7.4).
5. **Comparability metadata** — recorded on the attempt itself (`session_reviews.observed_conditions`),
   not only on the frozen slot (design.md D7.5).
6. **Real-authentication trigger** — the identity mode is the single gate; see "Identity gate (D2)"
   above (design.md D7.6).

## What works

The full P0 journey described in the PRD is implemented and covered by the test suites recorded
under "What was tested" below: journey setup and benchmark-slot readiness; the Today screen with
practice blocks, a check-in card and the progression suggestion; the benchmark journey — Ready,
Running with event logging, Recall, Scoring and Finalize, with a shared-domain eligibility and
first-switch preview; the practice Focus screen with event logging, an agent-status panel,
screen-free-break pausing, sync status and clock-gap handling; the practice review screen; the
daily check-in form with headline and per-platform feed rows; the Progress screen with the attempt
table, result-state card, practice/daily trend charts, exact-values table, export preview and
amendment dialog; the research cards screen; and Settings (preferences, demo controls, manual
practice-duration revision). The shared recovery mechanics — the IndexedDB outbox, idempotency-keyed
writes, optimistic-version conflict handling and the clock-gap prompt — underlie every one of these
screens rather than being a separate feature.

Every response body is validated against its TypeBox contract by AJV configured
`coerceTypes: false, removeAdditional: false, useDefaults: false` (D22): a blank input reaches the
handler as `null` and is never coerced to `0`, and a request carrying an unknown key is rejected
with 400 rather than silently trimmed. This is the transport-layer half of the "unknown is not
zero" invariant; the domain-layer half (nullable count columns end to end, `ReportedCount` types)
is recorded under "Specification defects settled (D7)" above.

Accessibility scope actually exercised: zero serious/critical axe violations across every screen
and session flow, a keyboard-only practice-review walkthrough with focus visible at each stop,
`prefers-reduced-motion` disabling every transition and animation, a single-polite-region policy
with no per-second countdown announcements, and every interactive control at or above the WCAG 2.2
AA 2.5.8 24×24 CSS-pixel minimum touch-target size (D40).

The eight demo fixture scenarios (`new-user`, `working-day`, `comparable-change`, `mixed-result`,
`missing-final`, `zero-baseline`, `recovery`, `timing-deviation`) each exercise a distinct
result-state or recovery path and are asserted end-to-end in the acceptance suite (task group 9).

## What was tested

Numbers below are exactly what the verification commands printed on 2026-09-08 (Node 24.14.1,
npm 11, Windows 11, Postgres 17 in Docker on port 55432); nothing here is estimated or rounded.

| command | result |
|---|---|
| `npm run typecheck` (shared + api + web + e2e) | exit 0 |
| `npm run build` (shared typecheck, api typecheck, web tsc + vite build) | exit 0; vite built in 484 ms |
| `packages/shared` unit tests | 24 files, 233 tests, all passed, 5.6 s |
| `apps/web` unit tests | 63 files, 456 tests, all passed, 23.6 s |
| `apps/api` unit tests | 92 files, 1033 tests, all passed |
| Playwright, full suite, one config | 166 passed, 8.1 minutes, exit 0 |
| `npm run verify:all` (fresh container, six stages) | exit 0, PASS on every stage, twice consecutively; 12.0 and 12.3 minutes |

One `apps/api` case is environment-sensitive and is worth knowing about before running the suite.
`test/boot.process.test.ts`'s "a TCP connect to 127.0.0.1:8787 is refused after exit" probes a
hard-coded port, so it fails whenever a development API server already holds 8787. That is a
collision in the test's own design, not an application defect. With no dev server running, the
whole suite passes, which is how the two `verify:all` runs recorded above observed it; nothing
about what the case checks was weakened to make it pass.

Playwright's 166 passes break down per project: acceptance 120, acceptance-dev 42, shell 3,
toolchain 1. The `acceptance` project is the one described under "Recovery: simulated vs
field-tested" below — one worker, no retries, run against a real built API and web bundle on
loopback, reset between tests via `POST /api/v1/demo/reset`.

`scripts/check-pins.mjs` exited 1 when this section was first written: it reported that "jsdom:
LIMITATIONS.md says **29.1.1**, package-lock.json has 29.1.1" because the pinned cell in the
"Version pins (D3)" table above is written in bold Markdown (`**29.1.1**`) and the script compared
the cell's raw text, markup included, against `package-lock.json`'s plain version string. That was a
defect in the check script's parsing, not in the pin itself — `package-lock.json` does resolve
`jsdom@29.1.1` as recorded above. The script now strips Markdown emphasis from a cell before
comparing, and prints `PINS OK`. The table was left as written, so the one stepped-back pin keeps
its emphasis.

## Recovery: simulated vs field-tested

Idempotency-keyed writes (`mutation_receipts`), the IndexedDB outbox with batched flush and replay
on load, optimistic per-row versioning (`expectedVersion` / 409 `stale_version`), and the clock-gap
prompt are all implemented and covered by unit, integration and Playwright tests. Per D40, that
coverage has a specific, stated limit:

- **Recovery and hidden-tab behavior are verified under paired simulated clocks, not
  field-tested.** Every Playwright case that exercises a gap, a stale reload, an offline batch or a
  hidden tab pairs Playwright's `page.clock` (the browser's notion of time) with `POST
  /api/v1/demo/clock` (the server's notion of time, D8), so the two are never allowed to drift apart
  by construction. No test in this change ran against a real network interruption, a real
  multi-hour absence, or an uncontrolled system-clock change on either side — those are exactly the
  conditions this mechanism exists for, and none of them were produced here.
- **Receipts expire on the demo clock**, not wall time: `mutation_receipts`' 7-day expiry
  (`expires_at = ctx.now + 7 days`, task 3.4.2) was exercised by advancing `ctx.now` through `POST
  /api/v1/demo/clock`, never by waiting seven real days and never by an equivalent jump in `real`
  mode, which does not exist in this change (see "Identity gate (D2)" above).
- **Graceful shutdown is verified on POSIX only.** `installSignalHandlers`'s `SIGTERM`-then-close
  path is covered by a spawned-process integration test that sends POSIX signals; it was not
  exercised on Windows. This environment's own verification run — the one every other number in
  this document comes from — was on Windows 11, so the shutdown path itself ran unverified on the
  machine that produced this document.

## Thresholds chosen

Three numeric thresholds gate flags, never eligibility, and none of them were tuned or validated
against collected data — there is none to validate against (see the repository preamble). They are
constants in `packages/shared/src/domain/recall.ts` (task 2.3.2) and `apps/web/src/lib/clock` (task
7.2.2):

- **Recall delay strictly greater than 600 s** flags `recall_delayed`.
- **Recall duration strictly greater than 210 s** flags `recall_overrun`.
- **A clock gap strictly greater than 60 s** raises the "Did the interval continue uninterrupted?"
  prompt (D26); 59 s raises nothing.

All three are picked values, not validated ones. design.md states this plainly: recall thresholds
of 600 s delay and 210 s duration "are chosen, not validated" — flags only, never exclusions — and
the same caveat applies to the 60-second clock-gap threshold, which has never been checked against
a real interruption (see "Recovery: simulated vs field-tested" above).

## Deferred

Deferred out of this change, per the PRD's P0/P1 split and design.md's own decisions:

- Curated research-card **discovery** (the three cards behind `GET /research/cards` are a fixed
  fixture; the response's `discoveryNote` field reads "Automated discovery not enabled"), agent
  APIs, browser extensions, OS-level telemetry, notifications and LLM coaching — all explicitly out
  of scope per `CLAUDE.md`'s "Proposed architecture."
- **Research-card provenance is recorded as abstract-reviewed, pending Douglas's confirmation**
  (D40): the three fixture cards (Castelo 2025, Mrazek 2013, Leroy & Glomb 2018) were checked
  against their published abstracts, not against each paper's full text, and that check has not yet
  been confirmed by the product owner.
- **Real identity.** `real` mode still refuses to boot (see "Identity gate (D2)" above); Better Auth
  wiring is deferred to the follow-up change `add-real-identity`.
- **`local-pilot`** (real data on loopback without OAuth) — deferred and reversible by one decision,
  detailed in the next section.
- **Write-rate limiting.** No write limiter is implemented in this change; `429 write_limit` is
  reserved in the D19 error-code vocabulary and returned by nothing. Every write in this change is
  bounded only by the loopback restriction and the identity-mode gate, never by a request-rate
  limit.

## Reversible decision: local-pilot

`local-pilot` (real self-tracked data on loopback, without Google OAuth) was scoped out of this
change but was deliberately kept a one-decision reversal rather than a redesign:

- The schema already carries what it needs. `realm` and `user_id` columns exist on every root table
  (`programs`, `focus_sessions`, `daily_checkins`) precisely so a `pilot` realm needs no migration
  to switch on.
- Nothing in this change can create a `pilot`-realm row today: `real` mode refuses to boot (listing
  its four missing prerequisites), and `local-demo` mode stamps every row `realm='demo'`
  unconditionally (task 3.2.3). The identity mode is the single gate that decides this (D7.6), so
  there is exactly one place to change.
- Reversing the decision means adding an `IDENTITY_MODE=local-pilot` branch to `loadConfig` /
  `deriveContext` that stamps `realm='pilot'` without requiring OAuth — not touching the domain
  layer, the API contracts, or any stored table. Every downstream `assertSameRealm` check already
  treats `pilot` as its own realm and already refuses to mix it with `demo` (task 2.7.1), so no
  comparison or report logic changes either.

## Task-group coverage

One row per task group in `openspec/changes/build-initial-mvp/tasks.md`. "Verified by" names the
suite(s) whose numbers are recorded under "What was tested" above, not a re-run performed only for
this table.

| group | delivered | verified by |
|---|---|---|
| 1. Kickoff and workspace | npm workspaces for `@attention-lab/api` / `@attention-lab/web` / `@attention-lab/shared`; Fastify and Vite skeletons; `.env.example` and this file's skeleton; Vitest config for shared and api; Drizzle config, `db:push` and the test-database bootstrap; Playwright config and the toolchain smoke spec; the D3 compatibility gate | shared/api unit tests, `npm run typecheck`, `npm run build`, `npx playwright test --list`, `node scripts/check-pins.mjs` |
| 2. Shared domain rules and contracts | pure `packages/shared` domain logic — calendar and program-day math, benchmark eligibility, event tallies and first-switch derivation, recall thresholds and blank-aware scoring, comparison math and result-state precedence, comparability warnings, band ceilings and the progression suggestion — plus the shared TypeBox contracts and demo fixtures | `packages/shared` unit tests (24 files, 233 tests) |
| 3. API foundation | config and boot gates, `buildApp` and its AJV options, the db plugin and test harness, request-id/logging/no-store plugins, the error-envelope mapper, the `programs`/`sessions`/`daily_checkins`/`mutation_receipts` Drizzle schema and migrations, the identity-context plugin, idempotency (request hash plus `mutation_receipts`), `GET /me` / `PATCH /me/preferences`, static web serving, the demo-only clock/reset/scenario-load routes, log-privacy assertions | `apps/api` unit tests |
| 4. Programs API | the program service and DTO mappers; `POST /programs` with idempotency and the one-open-program constraint; today's block and next-action derivation (pure); benchmark-slot readiness validation and `PUT .../benchmark-slots`; `GET /programs/current`; protocol revisions and `PATCH /programs/{id}`; the progression-suggestion adapter and `GET /programs/{id}/today` | `apps/api` unit tests |
| 5. Sessions API | session start for practice and benchmark; `GET /sessions/{id}` and `/active`; the event-batch and void routes; the transition state machine; the clock-gap route; the agent-plan route; the recall-lock route; finalize mechanics and its practice/benchmark branches; shared-domain eligibility and first-switch applied at finalize; append-only amendments | `apps/api` unit tests |
| 6. Days, report, export and research API | the daily check-in read/write path with feed-usage rows; the report core (attempts, samples, realm guard, comparison) and its acceptance-scenario table; comparability warnings and the practice/daily report sections; the report-load performance script; CSV and Markdown export; `GET /research/cards` | `apps/api` unit tests; `npm run load:report -w @attention-lab/api` |
| 7. Web foundation | the router, providers and component-test harness; accessibility primitives (live region, reduced motion, milestone announcements); the client-side clock (remaining-time derivation, gap detector, `useSessionClock`); the IndexedDB outbox (store, flush, sync-state, finalize/abandon helpers); the typed API client; query keys and the session-mode provider; app bootstrap, the rail/session layouts and the shell smoke spec; the route-leave guard and `useStartSession` | `apps/web` unit tests; Playwright `shell.spec.ts` |
| 8. Web screens | every screen in the P0 journey — setup and readiness, Today and its cards, the benchmark journey (Ready/Running/Recall/Scoring/Finalize), the practice Focus and Review screens, check-in, Progress (attempt table, result state, trends, export, amendments), research cards, Settings/demo controls/duration revision, the clock-gap prompt and the abandon control — plus one Playwright spec per journey slice | `apps/web` unit tests; the per-screen Playwright specs |
| 9. End-to-end acceptance and accessibility | the `acceptance` Playwright project against a real built API and web bundle; the eight scenario journeys; the invariant specs (hidden tab, reload/navigation, never-completed, idempotency, Day 8 revision, progression, two tabs); axe checks on every screen and session flow; live-region and reduced-motion checks | Playwright, full suite (166 passed, 8.1 minutes) |
| 10. Documents and handoff | this document's remaining sections and `scripts/check-limitations.mjs`; one dated implementation entry appended to each of the PRD, Technical PoC and protocol decision logs; `scripts/verify-all.mjs` and the `verify:all` root script; the README local-setup and integrity rewrite; the `CLAUDE.md` correction and `scripts/check-claude-md.mjs` | `node scripts/check-limitations.mjs` prints `LIMITATIONS_OK`; `node scripts/check-claude-md.mjs` prints `CLAUDE_MD_OK`; `node scripts/check-pins.mjs` prints `PINS OK`; each decision-log entry verified as zero deletions and one added dated line against the root commit |
