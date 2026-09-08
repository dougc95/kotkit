# Limitations

This document is filled in incrementally as the `build-initial-mvp` change is implemented.
Sections marked "filled in 10.4" are completed by task 10.4.1 once every other group has
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

filled in 10.4

## What was tested

filled in 10.4

## Recovery: simulated vs field-tested

filled in 10.4

## Thresholds chosen

filled in 10.4

## Deferred

filled in 10.4

## Reversible decision: local-pilot

filled in 10.4

## Task-group coverage

filled in 10.4
