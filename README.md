# Attention Lab — local Codex handoff

Design snapshot: 6 September 2026.

## Start here

Extract the entire ZIP into a folder on your PC. Open that folder in your local Codex workspace and use the brief in CODEX-HANDOFF.md. All included file/image references are relative and work after extraction. There is no application to install or run yet.

This bundle contains the product requirements, technical design, behavioral protocol, and all three original wireframe boards. It is self-contained for design handoff; external research/documentation links need internet. No credentials, dependencies, database, source repository or application implementation are included.

## Reading order and authority

1. [Prototype PRD](docs/Attention-Lab-Prototype-PRD.md): current prototype scope, interactions, scenario fixtures and acceptance criteria.
2. [Technical PoC](docs/Attention-Lab-Technical-PoC.md): architecture, logical schema, API outline and reliability requirements, subordinate to prototype scope.
3. [Attention protocol](docs/Attention-Recovery-14-Day-Plan.md): behavioral rationale, measurements and references.
4. [Wireframe index](wireframes/README.md): screen mapping and known corrections.
5. [Codex handoff](CODEX-HANDOFF.md): a ready-to-paste review brief and an optional implementation brief.

The user's direct current instruction governs the work. The documents' no-code statements describe the design-only scope authorized in the original conversation. Packaging this archive does not itself authorize implementation. A new explicit instruction to implement on the PC can change that scope; do not treat old design-stage wording as a permanent ban after such an instruction.

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

MANIFEST.sha256 contains SHA-256 hashes for every other bundled file. ZIP contents were checked for CRC errors and byte equality with source files. This checks packaging, not the correctness of a future implementation.
