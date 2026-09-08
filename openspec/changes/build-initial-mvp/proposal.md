## Why

Attention Lab exists only as a design bundle (PRD v0.2, Technical PoC v0.1, 14-day protocol v1.1, three wireframe boards) plus a partial scaffold (`package.json`, `packages/shared/src/domain/types.ts`, `.env.example`). Douglas wants to run the 14-day attention experiment on a working tool rather than on paper, and on 6 September 2026 explicitly lifted the design-stage no-code constraint. Nothing can be evaluated — not the journey's usability, not the measurement contracts, not the recovery behavior — until the P0 journey runs end to end.

## What Changes

- Add a runnable monorepo: `apps/web` (React + TypeScript + Vite), `apps/api` (Node + Fastify + TypeScript), and complete `packages/shared` (domain rules + TypeBox API contracts shared by both). The scaffold's broken references (`@attention-lab/api`, `@attention-lab/web`, `packages/shared/src/index.ts`, `LIMITATIONS.md`) become real.
- Implement the P0 journey from the Prototype PRD §3: setup and readiness → two baseline benchmarks with sequential recall/self-scoring → Today with two practice blocks → focus timer with optional agent plan and interruption recording → session review → daily check-in with cross-device feed log → Day 14 final benchmarks → Progress comparison with all result states and an export preview.
- Implement the measurement contracts as enforced behavior, not documentation: unknown ≠ zero, no visibility-derived episodes, fixed benchmark separate from variable practice, one departure = one episode, no double count of agent checks, first-switch `20+ / known / Unknown` as distinct states, timer expiry never proves completion, no invented attention score.
- Implement session recovery and duplicate-write protection for real: idempotent start/finalize, deduplicated event batches, one active session per user, reload recovery, a small unsynced buffer with distinguishable pending/saved/failed states, and a timer-uncertainty prompt after device sleep or clock change.
- Add **identity modes**: `local-demo` (fully working; single fixed principal; every record stamped `realm='demo'`; permanent banner; binds to 127.0.0.1 only) and `real` (refuses to boot with a clear message until Better Auth + invite-only Google OAuth is wired in a follow-up change). Real authentication, ownership, export and deletion remain the documented prerequisite before any private record is stored.
- Add demo-scenario fixtures matching the PRD §6 table (new user, working day, comparable change, mixed, missing final, zero baseline, recovery, timing deviation) and demo-only time controls that do not exist in real assessment mode.
- Add curated research cards (P1) as three finite, clearly labeled demonstration cards; no discovery, no editorial backend.
- Settle the six open specification defects listed in `CLAUDE.md` by explicit decision (recorded in `design.md`), because each is a measurement-corrupting ambiguity with no defensible default.
- Update repository documents that the implementation invalidates: the stale "no source code" wording in `CLAUDE.md`, README's pointer to `CODEX-HANDOFF.md`, `.env.example`, and a new `LIMITATIONS.md`. Documents keep their register: dated decision-log entries, no history rewriting.

**Deferred** (unchanged from the PRD): research discovery and editorial backend, agent APIs and integrations, browser extension, OS telemetry, push/email reminders, LLM coaching, payments, multi-user administration, clinical scoring, public deployment, Better Auth wiring (follow-up change).

## Capabilities

### New Capabilities
- `identity-realm`: identity modes, realm stamping of every record, demo banner and demo-only controls, localhost binding, ownership scoping of every resource, and the refusal path for unconfigured real authentication.
- `program-setup`: plan creation with progressive disclosure, readiness checklist, four matched material references assigned to baseline/final A/B slots, draft/ready states, immutable protocol revisions, and the Day 0–14 program calendar in the program's stored timezone.
- `benchmark-assessment`: the fixed 20-minute benchmark lifecycle (no valid pause; early stop = incomplete), material-closed recall with lock, self-scoring unlocked only after lock, confirmation of counts with blank ≠ zero, first-switch states, observed conditions recorded on the attempt, server-derived eligibility with explicit exclusion reasons, one replacement per slot, timing deviations, and Day 14 finals.
- `practice-sessions`: Today's next action and two protected blocks, practice start requiring a short intended output, pause/resume, interruption events with undo and agent-check subtype, optional agent waiting plan, session review with honest Yes/Partly/No, the progression suggestion rule, and one unfinished session per user.
- `daily-checkin`: sleep and cross-device recreational feed minutes with device/platform/scope/source labels, short-video as a subset, optional stress/mindfulness, incomplete saves with status, and neutral continuation after overruns or missed days.
- `progress-report`: baseline/final comparison math, the seven result states with precedence, low/zero-baseline handling, practice trends kept separate, comparability warnings, and a CSV/Markdown export preview carrying counts, methods, exclusions and protocol version.
- `session-recovery`: idempotent mutations, event deduplication, active-session conflict, reload recovery, unsynced buffer states, timer-uncertainty detection and resolution, and save-incomplete paths that never fabricate completion.
- `research-cards`: three finite curated demonstration cards with finding/limitation/relevance, provenance labels, deliberate external navigation, and no promotion inside session mode.
- `app-shell`: navigation outside session mode, session mode that hides navigation and prompts, the persistent demo banner placement, responsive single-column mobile layout, the accessibility baseline (keyboard, focus, contrast, reduced motion, bounded timer announcements), and the copy rules that forbid punitive or gamified messaging.

### Modified Capabilities
_None — `openspec/specs/` is empty; every capability above is new._

## Impact

- **New code**: `apps/web`, `apps/api`, and `packages/shared/src/{index,domain/*,contracts/*}.ts`. Root `package.json` scripts become real; `npm` workspaces are kept (the scaffold already uses them; the PoC's `pnpm` mention is superseded — see design.md).
- **Existing code**: `packages/shared/src/domain/types.ts` is retained and extended, not rewritten; its deliberate omission of any `countOrZero` helper stands.
- **Infrastructure**: local PostgreSQL 17 via the existing `db:up` Docker script on port 55432; Drizzle migrations; no hosting, no external services, no secrets created. `.env` is user-supplied from `.env.example`.
- **Dependencies**: React, Vite, React Router, TanStack Query, Tailwind, Radix primitives, Recharts (Progress only), Fastify + TypeBox type provider, Drizzle ORM/Kit, `postgres` driver, Pino, Vitest, Playwright. Versions are verified against the registry at kickoff and pinned in a lockfile; nothing from the documents is trusted as tested.
- **Documents**: `CLAUDE.md`, `README.md`, `.env.example` edited; `LIMITATIONS.md` created; the three design documents receive dated decision-log entries only.
- **Data**: In `local-demo` mode no private record can exist; the database holds synthetic `realm='demo'` rows only. Nothing is exposed on a network interface.
- **Considered and deferred**: a third `local-pilot` identity mode (real data on 127.0.0.1 without OAuth) was raised during exploration. The brief keeps real authentication as the gate for private data, so it is not in this change; it is recorded in design.md as a reversible decision that would unblock a real Day 0 before Better Auth exists.
