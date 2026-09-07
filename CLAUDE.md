# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **design handoff bundle for "Attention Lab"**, not an application. There is no source code, no
package manifest, no dependencies, no database and no git repository — only four Markdown documents,
three raster wireframe boards and a checksum manifest.

Attention Lab is a desktop-first, mobile-responsive web app for running a 14-day personal attention
experiment: establish a baseline with fixed 20-minute reading benchmarks, protect two daily practice
blocks, manage AI-agent waiting periods, log cross-device recreational feed use, and compare Day 14
results against baseline. Product owner: Douglas Rojas. All demonstrated numbers in the bundle are
synthetic; **no real measurements have ever been collected.**

## Commands

There is no build, lint, test or run command — there is nothing to build yet. Do not invent one.

```bash
sha256sum -c MANIFEST.sha256      # the only meaningful check in the repo
```

Expect **8 of 9 entries to pass**. `CODEX-HANDOFF.md` is listed but absent; the file actually shipped
is `HANDOFF.md`, which has no manifest entry. This is a known packaging defect, not tampering.

Environment note for this machine: `node` and `sha256sum` are available; `jq` and `python` are **not**
on PATH. Use `node -e` for JSON work.

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

## The no-code constraint and how it lifts

Every document states that no application code was to be created. That describes the scope authorized
during the original design conversation — it is **historical, not permanent**. Packaging the bundle
did not authorize implementation, and neither does approving a plan. Only a new explicit instruction
from the user does; `HANDOFF.md` contains a second brief written for exactly that purpose. Until then,
specification work, planning and document edits are in scope and application code is not.

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

## Known open defects in the specification

Audited across all four documents in September 2026; these are unresolved and any implementation work
must settle them first, because each one has no defensible default an implementer can guess:

1. `session_reviews` count columns lack the `nullable` marker its own section preamble requires, so a
   blank count would be stored as `0` and can render "No switches were reported at baseline" for a
   user who reported nothing.
2. Eligibility depends on "no disqualifying interruption," which has no definition, no threshold and
   no structured input — only a free-text disruption note.
3. Recall must be saved and locked before self-scoring (P-03), but the API has exactly one review
   write (`finalize`) and no recall timestamps or lock flag.
4. The "Mixed result" acceptance fixture matches no row of the PRD's own result-state table; two
   declared states have no fixture; and the table states no precedence when two rows co-apply.
5. Comparability metadata lives on the frozen benchmark slot rather than the attempt, and
   "accommodations" and "material level" have no column at all.
6. The trigger for real authentication is stated four different ways, one of which fires earlier than
   the rest, and no gate owns it.

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
