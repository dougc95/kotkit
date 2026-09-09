# Attention Lab — local Codex handoff

Design snapshot: 6 September 2026.

## Start here

Open this repository in your local Codex workspace and use the brief in HANDOFF.md; it also carries
the critical invariants. All included file/image references are relative to the repo root.

This repository is now a working **P0 prototype**, not only a design handoff: an npm-workspaces
monorepo with `apps/web` (React + TypeScript, served by Vite), `apps/api` (Fastify, run under `tsx`)
and `packages/shared` (pure domain logic and TypeBox contracts shared by both). Identity is
`local-demo` only — a single fixed local principal, every record stamped `realm='demo'`, a permanent
on-screen banner, loopback-only binding — and every number the app displays, charts or exports is
synthetic demo/fixture data; no real personal measurement has ever been collected. See
"## Local setup" below to run it, and LIMITATIONS.md for what is and is not verified.

It also still carries the product requirements, technical design, behavioral protocol and all three
original wireframe boards the implementation was built from. External research/documentation links
need internet; no real credentials or real personal data are included or should ever be entered.

## Reading order and authority

1. [Prototype PRD](docs/Attention-Lab-Prototype-PRD.md): current prototype scope, interactions, scenario fixtures and acceptance criteria.
2. [Technical PoC](docs/Attention-Lab-Technical-PoC.md): architecture, logical schema, API outline and reliability requirements, subordinate to prototype scope.
3. [Attention protocol](docs/Attention-Recovery-14-Day-Plan.md): behavioral rationale, measurements and references.
4. [Wireframe index](wireframes/README.md): screen mapping and known corrections.
5. [Handoff briefs](HANDOFF.md): a ready-to-paste review brief and an optional implementation brief.

The user's direct current instruction governs the work. The documents' no-code statements describe the design-only scope authorized in the original conversation. Packaging this archive does not itself authorize implementation. A new explicit instruction to implement on the PC can change that scope; do not treat old design-stage wording as a permanent ban after such an instruction.

## Local setup

Prerequisites: Node >= 22.9, npm 11, and Docker (for the local Postgres container). `jq` and
`python` are not required by anything here and are not assumed to be on `PATH`.

```bash
cp .env.example .env   # repo root only — no per-package copies exist or are read
npm install
npm run db:up           # starts/creates the attention-lab-pg container on localhost:55432
npm run db:push         # applies the Drizzle schema to it
npm run dev:api         # Fastify under tsx, http://127.0.0.1:8787
npm run dev:web         # Vite dev server, http://localhost:5173 (separate terminal)
```

Then, as needed:

```bash
npm run test        # shared + api + web unit tests, every workspace
npm run e2e          # Playwright, against a real built API + web bundle
npm run verify:all   # fresh container: db:up -> db:push -> typecheck -> test -> build -> e2e,
                      # stopping at the first failure
```

The API only binds to a loopback interface (`127.0.0.1`, `localhost` or `::1`); with
`IDENTITY_MODE=local-demo` (the only implemented mode) it additionally refuses to boot on any other
host. `local-demo` uses a single fixed local principal, stamps every record `realm='demo'`, and the
web app shows a permanent on-screen demo banner throughout. `IDENTITY_MODE=real` is not yet
implemented: it refuses to boot and lists whichever of its four prerequisites are still missing,
rather than silently falling back to `local-demo`. Never enter real personal data into this
prototype.

See LIMITATIONS.md for what is and is not verified — version pins, accessibility scope, which
recovery paths were simulated on a paired demo clock rather than field-tested, and the specification
defects settled during implementation.

## Essential reconciliations

- Prototype PRD narrows the older PoC: automated research discovery and agent integrations are deferred. Curated research demonstration cards suffice initially.
- The September 6 flexible-feed revision supersedes the original zero-feed rule still retained in the protocol for history. Planned leisure is allowed; improvement over perfection is the governing rule.
- Image screen numbering (01–08 and A–C) differs from the older technical document's W numbering; use wireframes/README.md.
- Recall and self-scoring are sequential. They appear side by side only to explain the flow.
- Numeric input zeroes in mockups are examples. Unknown/unreported inputs start blank.
- The alternate Agent Waiting board contains a sidebar; the PRD supersedes it with a distraction-minimized in-session panel.
- “Mixed or missing results? Show uncertainty; do not declare success” is a design annotation, not final user-facing copy. The PRD provides actual result-state wording.
- Grayscale boards are raster concepts, not editable Figma files or clickable prototypes. Small image text imperfections are not requirements.
- All demonstrated results are synthetic. No actual baseline or progress measurements have been collected in this handoff.

## Existing external automation

A weekly ChatGPT attention-research digest was created in the original conversation, scheduled for Saturday mornings around 08:00 America/La_Paz starting September 12, 2026. It does not travel with this ZIP, populate a local database or give the local agent access to ChatGPT tasks. Do not assume such access or create a duplicate automatically.

## Integrity

MANIFEST.sha256 contains SHA-256 hashes for every other bundled file, taken at ZIP-packaging time.
ZIP contents were checked for CRC errors and byte equality with source files at that time. This
checks packaging, not the correctness of the implementation now in this repository.

Running `sha256sum -c MANIFEST.sha256` today reports 4 of 9 entries OK, not the 8 of 9 the original
bundle produced. The four that still pass are the three wireframe boards and `wireframes/README.md`.
Five now fail, for two different reasons. README.md and the three design documents fail because this
change edited them: this file was rewritten for the P0 prototype (this section included), and each
document gained one dated implementation entry at the end of its own decision log. CODEX-HANDOFF.md
fails as a known packaging defect — it is listed in the manifest, but the file that actually shipped
is HANDOFF.md, which has no manifest entry (see "Reading order and authority" above). The manifest is
deliberately **not** regenerated: it is a fixed record of the originally packaged design-handoff
bundle, and updating it would erase the evidence of what has changed since.
