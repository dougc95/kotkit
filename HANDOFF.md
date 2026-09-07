# Briefs for the local agent

## Default: review and plan

Paste the following when you want the local agent to understand the project before building:

> Read README.md, docs/Attention-Lab-Prototype-PRD.md, docs/Attention-Lab-Technical-PoC.md and docs/Attention-Recovery-14-Day-Plan.md, then inspect all three PNG boards listed in wireframes/README.md. This is Attention Lab, a desktop-first, mobile-responsive attention-practice web app with a proposed TypeScript frontend and backend. Treat the Prototype PRD as the current scope and the PoC as the technical reference. Preserve improvement over perfection and the flexible cross-device feed policy. Identify material inconsistencies, map the P0 requirements to a staged implementation plan, and explain what is simulated versus real in each stage. Do not write application code until I explicitly ask you to implement. Do not assume you have the original conversation, ChatGPT automations, accounts or credentials. Ask only about decisions that genuinely block progress.

## Optional: explicitly authorize implementation

Use this separate brief only when you decide to start coding. Sending it explicitly changes the earlier design-only scope:

> Implement the Attention Lab prototype described in this folder. I now authorize application code creation; the earlier no-code wording in the design documents is historical. Read README.md and all three documents, inspect the three wireframe boards, and follow the Prototype PRD's P0 scope. Use React/TypeScript/Vite for the frontend and Node.js/TypeScript/Fastify with PostgreSQL/Drizzle for the backend, with shared validated API contracts. Inspect my existing workspace instructions and files before changing anything. Build the setup → baseline → practice → review → final comparison journey first. Keep simulated data/time visibly separate from real assessment mode. Add curated research cards as secondary content; defer automated discovery and agent integrations. Implement honest self-reported metrics, sequential recall/self-scoring, missing-data states, duplicate-write protection, and session recovery. Verify supported dependency compatibility rather than assuming document versions. Use the specified acceptance scenarios for meaningful tests. Provide local setup instructions and placeholders for required environment settings, never invented secrets. If external authentication setup is unavailable, a clearly labeled local demo using synthetic data may be used while real auth remains a documented prerequisite for private-data use. Do not expose an unauthenticated personal-data app or deploy publicly. Finish with what works, what was tested, and concrete remaining limitations.

## Critical invariants for either path

- App visibility is not a measure of attention. Reading outside the app or working in an IDE is expected.
- Fixed 20-minute benchmark outcomes are separate from changing practice durations.
- A decrease in switches is not a percentage increase in attention, a diagnosis, or proof of cause.
- Unknown does not equal zero. First-switch time unknown does not equal no switch.
- Agent checks may overlap with off-task episodes; avoid double counts.
- Final outcomes preserve source/protocol metadata and exclusions.
- Timing uncertainty, sync failure and incomplete tests cannot become false completed results.
- Real-pilot identity, ownership, persistence, export and deletion are required before hosted use with private records.
- No original conversation, account tokens or hidden context is needed beyond this bundle and the user's local instructions.
