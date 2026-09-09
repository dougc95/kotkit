# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **working P0 implementation of "Attention Lab"**, built from the design handoff bundle that still
lives alongside it under `docs/`, `wireframes/` and `README.md`. It is an npm-workspaces monorepo
(`packages/*`, `apps/*`; D1 — npm chosen over the PoC's pnpm suggestion because the scaffold's scripts
already used the `-w` workspace flag and pnpm would add churn without benefit at this scale): `packages/shared`
holds the TypeBox contracts and pure domain functions shared by both ends; `apps/api` is a Fastify +
Drizzle + PostgreSQL backend that runs from TypeScript source under `tsx` rather than a compiled
artifact; `apps/web` is a React + Vite + TanStack Query frontend. `e2e/` holds the Playwright
acceptance and invariant suites, and `openspec/changes/build-initial-mvp/` holds the proposal, design
decisions (D1–D40) and task list this implementation was built against.

Attention Lab is a desktop-first, mobile-responsive web app for running a 14-day personal attention
experiment: establish a baseline with fixed 20-minute reading benchmarks, protect two daily practice
blocks, manage AI-agent waiting periods, log cross-device recreational feed use, and compare Day 14
results against baseline. Product owner: Douglas Rojas. Every run in this repository so far has used
the `local-demo` identity mode (fixed principal, loopback-only, synthetic fixture data, permanent demo
banner); `real` identity refuses to boot until its prerequisites are met (D2). All demonstrated numbers
remain synthetic; **no real measurement has ever been collected.**

## Commands

Root scripts run from the repo root against the npm workspace:

| Script | What it does |
|---|---|
| `npm run db:up` | Start (or resume) the local Postgres 17 container on port 55432 |
| `npm run db:down` | Stop that container |
| `npm run db:push` | Push the Drizzle schema to the dev database (`-w @attention-lab/api`) |
| `npm run db:test` | Run the API's database-backed tests (`-w @attention-lab/api`) |
| `npm run typecheck` | Typecheck every workspace, then `typecheck:e2e` |
| `npm run typecheck:e2e` | `tsc -p e2e/tsconfig.json` only |
| `npm run test` | Vitest across every workspace |
| `npm run test:domain` | Vitest for `packages/shared` only |
| `npm run test:api` | Vitest for `apps/api` only |
| `npm run build` | Build `packages/shared`, then `apps/api`, then `apps/web`, in that order |
| `npm run dev:api` | Run the API from TypeScript source under `tsx` — no compiled API artifact |
| `npm run dev:web` | Run the Vite dev server for `apps/web` |
| `npm run e2e` | Playwright, config at `e2e/playwright.config.ts` |
| `npm run e2e:install` | Install the Playwright Chromium browser |
| `npm run verify:all` | `scripts/verify-all.mjs`: fresh DB container → db:up → db:push → typecheck → test → build → e2e, as a PASS/FAIL table, stopping at the first failure |

`apps/api` is always run from source under `tsx`, in both `dev:api` and the Playwright acceptance
project; `build` compiles `apps/web` for production and typechecks the rest, but there is no compiled
API artifact anywhere in this repository.

```bash
sha256sum -c MANIFEST.sha256      # integrity check inherited from the design handoff bundle
```

`sha256sum -c` now passes **4 of 9** entries: the three wireframe boards and `wireframes/README.md`.
`CODEX-HANDOFF.md` still fails to open — it is listed in the manifest but absent; the file actually
shipped is `HANDOFF.md`, which has no manifest entry, and that packaging defect was never fixed
because `HANDOFF.md` is the file this repository actually uses. `README.md` and all three design
documents now also fail their checksums, because this change rewrote the README for the implemented
repository and appended a dated implementation entry to each document's decision log; see
`README.md`'s `## Integrity` section for the current detail. The manifest is deliberately not
regenerated — it documents the handoff bundle as delivered, not the repository as it stands today.

Environment note for this machine: `node` and `sha256sum` are available; `jq` and `python` are **not**
on PATH. Use `node -e` for JSON work — `scripts/check-pins.mjs`, `scripts/check-limitations.mjs` and
`scripts/check-claude-md.mjs` all cross-check a document against the code without either.

## Authority order — read this before resolving any conflict

Documents disagree with each other by design, and later ones supersede earlier ones. When two
statements conflict:

1. **The user's direct current instruction** — always wins.
2. `docs/Attention-Lab-Prototype-PRD.md` (v0.2) — governs prototype scope, priorities and all
   interaction decisions.
3. `docs/Attention-Lab-Technical-PoC.md` (v0.1) — architecture, logical schema, API outline,
   reliability. Subordinate to the PRD wherever the PRD narrows or defers something.
4. `docs/Attention-Recovery-14-Day-Plan.md` (v1.1) — the behavioral protocol, measurement
   definitions and research citations.
5. `wireframes/*.png` — illustrative concepts only. **Never acceptance criteria.** They lose to the
   PRD, and their raster text imperfections and design annotations are not requirements.

`README.md` maps the bundle and lists reconciliations already settled. `HANDOFF.md` carries the
critical invariants and the two ready-to-paste briefs; note it is unreachable from README's reading
order, which still points at the old `CODEX-HANDOFF.md` filename.

## The no-code constraint (history)

Every design document states that no application code was to be created. That described the scope
authorized during the original design conversation and packaging of the handoff bundle; it is no
longer in force. Packaging the bundle did not itself authorize implementation, and neither did
approving a plan — the constraint lifted only on **2026-09-06**, by a new explicit instruction from
the user (`/opsx:propose build-initial-mvp`, following the second brief `HANDOFF.md` had written for
exactly that purpose). Application code has been in scope since that date, and the P0 implementation
described above is the result. This section is kept for provenance; do not read it as still
restricting this repository.

## Invariants that govern all work here

These come from `HANDOFF.md` plus the PRD's measurement contracts. Violating one silently corrupts a
measurement, which is the failure mode this whole bundle is organized against.

- **Unknown ≠ zero.** A blank input means not reported; an explicit `0` is a measurement. Never
  coalesce null to 0 in any average, state selection, trend or export.
- **App visibility is not attention.** Reading in another tab or working in an IDE is expected
  behavior. A hidden tab never creates an off-task episode.
- Fixed 20-minute benchmark outcomes stay separate from the varying practice-block durations.
- One departure-and-return is **one** episode, however many unrelated apps it touched. An agent-status
  check may overlap an off-task episode and must not be counted twice.
- No invented attention score. Report "fewer reported switches," never "attention +40%." No
  confidence intervals or significance for four self-reported samples.
- First-switch time: no switch → `20+, capped`; episode present but time unknown → `Unknown`.
  These are different states.
- Timer expiry never proves completion; sync failure and incomplete attempts never become completed
  results. Pending, saved and uncertain must stay distinguishable.
- **Improvement over perfection.** Overruns, lapses and missed days never block continuation, reset
  history or trigger punitive messaging.
- **Flexible cross-device feed policy** (the September 6 revision) supersedes the original zero-feed
  rule retained in the protocol for traceability. Planned leisure scrolling is compatible with the
  program; abstinence is not a success condition. Never re-tighten this.
- Real identity, ownership, persistence, export and deletion are prerequisites before any real
  personal record is stored.

## Proposed architecture (for when implementation is authorized)

React + TypeScript + Vite frontend, React Router, TanStack Query, Tailwind + Radix, Recharts on the
Progress screen only. Node LTS + Fastify + TypeScript backend with TypeBox contracts shared with the
frontend, Better Auth with invite-only Google OAuth, PostgreSQL via Drizzle, pnpm workspaces, Vitest
and Playwright. One origin serves both the compiled frontend and the API. No versions are pinned
anywhere in the bundle and no compatibility has been tested — verify at kickoff rather than trusting
a version implied by the documents.

The domain centers on `programs` → immutable `protocol_revisions` → `benchmark_slots` (baseline A/B
and final A/B, optionally a Day 7 midpoint) → `focus_sessions` (kind `practice` or `benchmark`) →
`session_events` / `session_reviews` / `agent_plans`, plus `daily_checkins` → `feed_usage`. Eligibility
and the baseline/final comparison are derived **server-side** from stored fields; the UI may preview a
suggestion but never computes a score of its own.

P0 is the journey setup → baseline → daily practice → review → Day 14 → comparison. Curated research
cards are P1; research discovery, agent APIs, browser extensions, OS telemetry, notifications and LLM
coaching are deferred.

## Specification defects — settled (D7)

Audited across all four documents in September 2026, then settled by decision D7 in
`openspec/changes/build-initial-mvp/design.md` before implementation began. Each resolution below is
one line; see D7 for the full column and threshold detail.

1. **Nullable counts** — `episode_count`, `external_count`, `unplanned_agent_checks`,
   `mind_wandering_count` and `recall_score` are nullable columns end to end (`ReportedCount`), a blank
   input is never written as `0`, and a Drizzle-level test asserts no `COALESCE(...,0)` in report
   queries.
2. **Disqualifying interruption** — resolved as a required `materially_disrupted` Yes/No
   self-attestation on benchmark review, with no numeric threshold and one replacement per slot
   requiring a reason.
3. **Recall lock** — a separate `POST /sessions/{id}/recall` write sets `recall_started_at` and
   `recall_locked_at` before self-scoring; benchmark finalize requires that lock, with delay/duration
   past 600 s / 210 s recorded as flags, not exclusions.
4. **Result states** — precedence is fixed in `comparison.ts` (baseline pending → final pending →
   insufficient → zero baseline → more → unchanged → mixed → improvement), "unchanged" was added, and
   the PRD's "Mixed result" fixture is read as fewer switches (6/4 → 3/3) with lower recall (4/4 → 2/2);
   every state now has a fixture.
5. **Comparability metadata** — moved onto the attempt as `session_reviews.observed_conditions`
   (`deviceFormat`, `language`, `materialLevel`, `accommodations[]`), defaulted from the slot at start
   and confirmed at review.
6. **Auth trigger** — resolved as a single gate: identity mode. A `pilot`-realm row can only be created
   when mode is `real`, and `real` refuses to boot until its prerequisites are met, so no pilot row
   exists in this change.

Do not re-report the items README's "Essential reconciliations" and `wireframes/README.md` already
settle (W-numbering vs board numbering, mockup zeroes, the superseded Agent Waiting sidebar, the
"Mixed or missing results?" annotation, the deferred research discovery).

## Style of the documents

Long-form Markdown with dense tables, Mermaid diagrams used as design figures only, explicit decision
logs at the end of each document, and citations carried alongside every empirical claim with its
limitations stated. Every claim is hedged where the evidence is weak, and no result is asserted that
the bundle cannot substantiate. Edits should match that register: append dated decision-log entries
rather than rewriting history, and never introduce a stronger claim than the source supports.

---

A user-level OpenAI Codex config exists at `~/.codex/config.toml`. To bring anything from it into
Claude Code, reply `/import` to scan and list what is importable (MCP servers, slash commands,
subagents, skills, instructions), then `/import --yes=<digest>` using the digest the scan prints. If
`/import` is unavailable on this surface, run `claude import` from a terminal instead.
