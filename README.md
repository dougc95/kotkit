# Attention Lab

A desktop-first, mobile-responsive web app for running a **14-day personal attention experiment**:
establish a baseline with two fixed 20-minute reading benchmarks, protect two practice blocks a day,
manage the waiting periods while an AI agent works, log recreational feed use across devices, and
compare Day 14 against the baseline without inventing a score.

This repository holds a **working P0 prototype** and the design bundle it was built from. Every
number the app displays, charts or exports is synthetic demonstration data. **No real personal
measurement has ever been collected**, and the prototype refuses to run in any mode that could
store one (see [Identity and data](#identity-and-data)). Product owner: Douglas Rojas.

## The experiment in one pass

| Days | What happens | Where in the app |
|---|---|---|
| Setup | Choose a baseline date, timezone, practice-block length and leisure allowance; enter the reading material for four benchmark slots. | `/setup`, `/setup/readiness` |
| Day 0 | Two fixed 20-minute reading benchmarks (A and B) with a recall test and self-scoring afterwards. | `/benchmark/…`, recall, scoring |
| Days 1–13 | Two protected practice blocks a day, each followed by a short review; a daily check-in for sleep, stress, mindfulness and feed minutes. | `/today`, `/focus/…`, `/review/…`, `/checkin/…` |
| Day 14 | The final A and B benchmarks. | `/benchmark/…` |
| After | Baseline versus final, derived on the server and reported as "fewer reported switches", never "attention +40%". | `/progress` |

Four rules run through everything and are worth knowing before you read any screen:

- **Unknown ≠ zero.** A blank input means *not reported*; an explicit `0` is a measurement. Absent
  values render as a ruled slot ("Not reported"), never as `0` or an empty cell.
- **App visibility is not attention.** Reading in another tab is expected; a hidden tab never
  creates an off-task episode.
- **Timer expiry proves nothing.** Pending, saved and uncertain results stay distinguishable, and an
  attempt that never finished is never reported as complete.
- **Improvement over perfection.** Overruns, lapses and missed days never block continuation, reset
  history or produce punitive copy. Planned leisure scrolling is compatible with the programme.

The full list, with the reasoning, is in [`CLAUDE.md`](CLAUDE.md) ("Invariants that govern all work
here") and [`HANDOFF.md`](HANDOFF.md).

## Quick start

Prerequisites: Node ≥ 22.9, npm 11, Docker (for the local Postgres 17 container). Nothing here needs
`jq` or `python`.

```bash
cp .env.example .env    # repo root only; the defaults are the local-demo configuration
npm install
npm run db:up           # starts or creates the attention-lab-pg container on localhost:55432
npm run db:push         # applies the Drizzle schema
npm run dev:api         # Fastify under tsx at http://127.0.0.1:8787 (API under /api/v1)
npm run dev:web         # Vite at http://localhost:5173, in a second terminal
```

Open `http://localhost:5173`. A new database starts empty; the fastest way to see every screen with
data is **Settings → Demonstration controls**, which loads one of eight synthetic scenarios (New
User, Working Day, Comparable Change, Mixed Result, Missing Final, Zero Baseline, Recovery, Timing
Deviation) and drives a demo clock ("Advance", "Skip to Day 14", "Reset clock") so a two-week
programme can be walked in minutes. The permanent banner at the top of every screen says what the
data is.

## Repository layout

| Path | What it is |
|---|---|
| `apps/web/` | React 19 + TypeScript + Vite front end: React Router, TanStack Query, Tailwind CSS 4 with shadcn/ui primitives, Recharts on the Progress screen only. Screens live under `src/features/`, shared primitives under `src/ui/`, the shell under `src/app/`. |
| `apps/api/` | Fastify + Drizzle + PostgreSQL back end, always run from TypeScript source under `tsx`; there is no compiled API artifact. Eligibility and the baseline/final comparison are derived here, never in the browser. |
| `packages/shared/` | TypeBox contracts and pure domain functions used by both ends. |
| `e2e/` | Playwright: acceptance journeys, measurement invariants, accessibility (axe, keyboard, reduced motion, live regions) and per-screen specs, plus a pitch-demo recording harness (`e2e/pitch/`, not part of the suite). |
| `openspec/` | The OpenSpec specifications the prototype is built against (`specs/`) and the archived `build-initial-mvp` change with its proposal, design decisions D1–D40 and task list. |
| `docs/` | The design bundle: prototype PRD, technical PoC, the 14-day protocol, and under `docs/superpowers/` the design spec and plan of the 2026-09-17 UI rework. |
| `wireframes/` | Three raster concept boards and their index. Illustrative only; never acceptance criteria. |
| `scripts/` | `verify-all.mjs` (the full pipeline) and three document guards, `check-claude-md.mjs`, `check-limitations.mjs`, `check-pins.mjs`. |
| `HANDOFF.md`, `LIMITATIONS.md`, `CLAUDE.md` | The critical invariants and briefs; what is and is not verified; the working agreement for anyone (human or agent) changing this repository. |

## Commands

All scripts run from the repository root against the npm workspaces.

| Script | What it does |
|---|---|
| `npm run dev:api` / `npm run dev:web` | The two dev servers (see Quick start). |
| `npm run db:up` / `db:down` / `db:push` | Start or stop the Postgres container; push the Drizzle schema. |
| `npm run typecheck` | Every workspace, then the e2e project. |
| `npm run test` | Vitest across every workspace. `test:domain` and `test:api` scope it. `db:test` runs the API's database-backed tests. |
| `npm run build` | `packages/shared`, then `apps/api` (typecheck only), then `apps/web`. |
| `npm run e2e` | Playwright, four projects: `toolchain`, `shell`, `acceptance-dev` (against the dev-server pair) and `acceptance` (against a real built API and web bundle on port 8788). `npm run e2e:install` fetches Chromium. |
| `npm run verify:all` | Fresh database container → `db:up` → `db:push` → typecheck → test → build → e2e, as a PASS/FAIL table that stops at the first failure. |
| `node scripts/check-pins.mjs` etc. | Cross-check `LIMITATIONS.md` and `CLAUDE.md` against the code without `jq` or `python`. |

A known wrinkle, recorded in the UI rework spec (§12): `apps/api/test/sessions/finalize-eligibility.test.ts`
fails 13 cases during the evening hours on a machine whose local date and the UTC date differ. It is
a test-fixture date defect, not a product one, and it makes `npm run test` and `verify:all` red at
those hours regardless of branch.

## Identity and data

The only implemented identity mode is `local-demo`: a single fixed local principal, every record
stamped `realm='demo'`, a permanent on-screen banner, and an API that binds to a loopback interface
only (`127.0.0.1`, `localhost` or `::1`) and refuses to boot on any other host. `IDENTITY_MODE=real`
is not implemented: it refuses to boot and lists whichever of its four configuration prerequisites
(`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_INVITE_ALLOWLIST`) are still
missing, rather than silently falling back — and even with all four present it still refuses, because
Better Auth with invite-only Google OAuth is the one part of the stack still unbuilt, deferred to the
follow-up change `add-real-identity`. Real identity, ownership, persistence, export and deletion are
prerequisites before any real personal record is stored. **Never enter real personal data into this
prototype.**

## Design

The 2026-09-17 UI rework moved `apps/web` onto shadcn/ui primitives and a design direction called
the *instrument log*: IBM Plex Sans and Mono, self-hosted; a single petrol `signal` colour for the
one primary action on a surface and for anything live; amber `attention` for messages that need you
and for uncertain values; red only on destructive actions; a paper page ground with white reserved
for raised surfaces; mono restricted to timer digits, dense tables and comparison figures; one global
focus outline; and a three-tier value taxonomy (`recorded` / `absent` / `uncertain`) that every value
in the app renders through. The design is in
[`docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md`](docs/superpowers/specs/2026-09-09-shadcn-ui-rework-design.md)
(its decision log U1–U26 and §12 record what changed along the way and what is left open); the plan
it was built from is beside it under `plans/`.

## Documents: reading order and authority

Documents disagree with each other by design, and later ones supersede earlier ones. The user's
direct current instruction always wins; below it, when two statements conflict, the earlier item in
this list governs:

1. [Prototype PRD](docs/Attention-Lab-Prototype-PRD.md) (v0.2): prototype scope, priorities, interactions, scenario fixtures and acceptance criteria.
2. [Technical PoC](docs/Attention-Lab-Technical-PoC.md) (v0.1): architecture, logical schema, API outline and reliability, subordinate to the PRD wherever it narrows or defers something.
3. [Attention protocol](docs/Attention-Recovery-14-Day-Plan.md) (v1.1): the behavioural protocol, measurement definitions and research citations.
4. [Wireframe index](wireframes/README.md): screen mapping and known corrections. The boards themselves lose to the PRD.
5. [Handoff briefs](HANDOFF.md): the critical invariants and the two briefs this implementation was commissioned from. Read it before changing anything that affects a measurement.

The OpenSpec specifications under `openspec/specs/` are the implementation's own contract, derived
from these documents; the archived change under `openspec/changes/archive/2026-09-09-build-initial-mvp/`
records the decisions (D1–D40) that reconciled them, including the six specification defects settled
before implementation began (`CLAUDE.md`, "Specification defects — settled").

The documents' statements that no application code was to be written describe the design-only scope
of the original conversation. That constraint was lifted by explicit instruction on 6 September 2026
and the prototype is the result; read those statements as history, not as a live restriction.
Version pins, accessibility scope, which recovery paths were simulated on a paired demo clock rather
than field-tested, and everything else that is or is not verified are in [`LIMITATIONS.md`](LIMITATIONS.md).

## Essential reconciliations

Settled once; do not re-report them.

- The prototype PRD narrows the older PoC: automated research discovery and agent integrations are deferred. Curated research demonstration cards suffice initially.
- The September 6 flexible-feed revision supersedes the original zero-feed rule still retained in the protocol for history. Planned leisure is allowed; improvement over perfection is the governing rule.
- Image screen numbering (01–08 and A–C) differs from the older technical document's W numbering; use `wireframes/README.md`.
- Recall and self-scoring are sequential. They appear side by side only to explain the flow.
- Numeric input zeroes in mockups are examples. Unknown or unreported inputs start blank.
- The alternate Agent Waiting board contains a sidebar; the PRD supersedes it with a distraction-minimised in-session panel.
- "Mixed or missing results? Show uncertainty; do not declare success" is a design annotation, not final user-facing copy. The PRD provides the actual result-state wording.
- Grayscale boards are raster concepts, not editable Figma files or clickable prototypes. Small image text imperfections are not requirements.
- All demonstrated results are synthetic. No actual baseline or progress measurement has been collected.

## Existing external automation

A weekly ChatGPT attention-research digest was created in the original conversation, scheduled for
Saturday mornings around 08:00 America/La_Paz starting 12 September 2026. It does not travel with
this repository, populate a local database or give a local agent access to ChatGPT tasks. Do not
assume such access or create a duplicate automatically.

## Integrity of the design bundle

`MANIFEST.sha256` holds SHA-256 hashes for the files of the original design-handoff bundle, taken at
ZIP-packaging time (6 September 2026). It checks packaging, not the correctness of the implementation
now in this repository.

`sha256sum -c MANIFEST.sha256` today reports **4 of 9** entries OK: the three wireframe boards and
`wireframes/README.md`. The other five fail for two reasons. This README and the three design
documents have been edited since packaging — this file was rewritten for the prototype and again
after the UI rework, and each document gained one dated implementation entry at the end of its
decision log. `CODEX-HANDOFF.md` fails as a known packaging defect: it is listed in the manifest,
but the file that shipped is `HANDOFF.md`, which has no manifest entry. The manifest is deliberately
**not** regenerated; it is a fixed record of what was delivered, and updating it would erase the
evidence of what has changed since. Nothing the UI rework touched is manifest-listed except this
file, so the count is unchanged.
