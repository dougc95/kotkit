# Attention Lab — Prototype PRD and interaction specification

Version 0.2 · 6 September 2026 · Product owner: Douglas Rojas
Status: design ready for review. No working or clickable prototype has been implemented.

## 1. Transition from PoC to prototype

The earlier PoC document proposed feasibility, architecture and a broad feature inventory. This iteration defines a narrower product experience that can be prototyped and evaluated end to end. It preserves the user's instruction not to create application code. Existing wireframes are visual references; this specification adds interaction contracts, priorities, decision states and evaluation tasks. It is not itself an interactive application.

Product objective: help a knowledge worker complete a two-week experiment with protected practice, manageable logging, and an honest baseline/final comparison. Success does not require abstinence, flow, perfect days, or spending more time in the app.

Priority of documents: this PRD governs prototype scope and updated interaction decisions. Attention-Lab-Technical-PoC.md remains the architecture/data/API reference except where explicitly deferred here. Attention-Recovery-14-Day-Plan.md remains the behavioral protocol reference. Existing image boards are illustrative, not implementation acceptance criteria when they conflict with this document.

| Area | Earlier PoC | Prototype decision |
|---|---|---|
| Main question | Can the proposed components support this experiment? | Can someone complete the whole journey without confusion or excessive administration? |
| Main journey | Separate screen concepts | Setup → baseline → daily practice → review → final assessment → comparison |
| Research | Scheduled discovery and curation | Three curated demonstration cards; discovery deferred |
| Agent waiting | Separate visual state | Optional panel in practice; no extra required screen |
| Measurement | Broad event/data specification | Manual counts, fixed benchmarks, visible provenance; no automatic attention inference |
| Authentication | Real provider and account lifecycle | Simulated identity in a future UX demo; real auth mandatory before a hosted private-data pilot |
| Data | Full domain model | Small explicit set of demonstration scenarios; real pilot data must remain separate |
| Progress | Pending and example complete screens | Pending, comparable improvement, mixed result, and insufficient-data variants |

## 2. Target user and jobs

Primary user: Douglas, a software engineer whose AI-agent waiting periods can become cues for social-feed checking. Design the language so other knowledge workers can also use it; agent fields are optional.

Core jobs:

1. When I start work, help me choose one achievable output and a protected interval.
2. When an agent is running, help me continue useful work or take a deliberate break.
3. When I get distracted, let me record it and return without punishment.
4. After two weeks, show whether my reported interruptions and comprehension changed under reasonably comparable conditions.

The product is a self-experiment tool, not a clinical assessment, agent orchestrator, social-media blocker, or general productivity suite.

## 3. First prototype boundary

### P0 — required to evaluate the core journey

- Setup with date, timezone, starting practice duration and flexible leisure goal.
- Baseline checklist, passage-reference assignment and two assessment slots.
- Fixed 20-minute assessment and separate three-minute recall, followed by self-scoring.
- Today page with next action and two practice blocks.
- Practice timer with optional agent plan and interruption recording.
- Short session review and daily phone/desktop feed-use log.
- Day 14 reassessment using reserved matched materials.
- Progress with baseline/final counts, recall, eligibility and uncertainty.
- Demonstrable recovery states and export preview.

### P1 — supporting prototype views

Research digest with curated, clearly labeled demonstration content; basic preferences; sample report download in a future functional implementation. Existing research wireframe stays in the design but does not block core usability evaluation.

### Deferred

Research fetching, editorial backend, agent APIs, browser extension, OS telemetry, push/email reminders, LLM coaching, payments, multi-user administration and clinical scoring. No new scheduled task is required; the existing ChatGPT digest continues separately.

## 4. Experience map

Screen numbers map to the three image boards already created, not to the older document's W numbering.

| Screen | Entry condition | Main action | Result |
|---|---|---|---|
| 05 Setup | No plan | Save plan | Baseline readiness checklist |
| 06 Baseline | Ready slot A or B | Start assessment | Running assessment, then recall |
| 07 Recall | Assessment ended | Save recall | Unlock self-scoring |
| 07 Self-scoring | Recall saved | Finalize assessment | Next baseline slot or Today |
| 01 Today | Plan exists | Start next block | 02 Focus |
| 02 Focus | Concrete output entered | Complete interval / finish early | 03 Session review |
| A Agent waiting | Optional during practice | Return to task / planned break | Same practice session |
| 03 Session review | Practice ended | Save session | Today with recorded completion |
| 04 Progress | Any recorded data | Inspect comparison / export preview | Pending, complete, mixed or insufficient state |
| 06 + 07 Final | Day 14, assigned final slots | Complete final assessment | Updated 04 Progress |
| 08 Research | User opens navigation item | Read source | External source; preserve return location |
| C Recovery | Connection/timing problem | Retry / review / save incomplete | Recovered session or recorded incomplete attempt |

Setup and assessment paths must remain distinct from practice. Research, preferences and progress are not surfaced as prompts during a protected block.

## 5. Interaction contracts

### Setup and readiness

Required: baseline local date, confirmed timezone, initial practice duration. Leisure allowance is an editable planning goal; it is not a medically safe dose. Current feed time is optional and explicitly labeled estimated when appropriate.

Use progressive disclosure: collect basic setup first, then material references and assessment times on a readiness step. Do not force all four material descriptions into the first form. Before the first benchmark starts, assign two baseline and two final references without requiring the user to read them. Each section should last the interval and be of similar difficulty; selecting material is not automatically an assessment.

Save draft if readiness is incomplete. Show exactly what is missing. Do not route directly into a running timer on save. Benchmark instructions explain that reading elsewhere is allowed and paper tallying is acceptable.

### Baseline and final assessment

Ready state: passage reference, protocol checklist, explicit Start. Running state: remaining time (optional hidden display), record interruption, stop early. No valid benchmark pause/resume path. Early stop goes to incomplete review, never silently starts a new assessment.

At the end, show “Close your reading material.” Start the three-minute recall interval only when the user confirms readiness; record any substantial delay as a deviation. Recall and scoring are sequential screens, even though the wireframe board displays them side by side to explain the sequence. Scoring choices are inaccessible until recall is saved. After saving recall, lock its text and display the five points for scoring against the source. Changing a factual point after consulting the source would invalidate the recall measure.

The review also confirms off-task episode count, external interruption count, capture method and condition notes. Start numeric inputs blank. A user explicitly enters zero; a blank is unknown. Counts are not automatically created from tab visibility. First-switch timing is optional; if an episode occurred but its time is unknown, show Unknown instead of 20+.

A/B sessions have at least one hour separation. Display availability and the scheduled local time; a prototype walkthrough may simulate time, but a real pilot must enforce/record the interval. Final sessions are scheduled for Day 14. Late completion remains visible and labeled outside the standard protocol; no forced reset of completed work.

### Practice and agent waiting

Before starting, require a short intended output, not a long task specification. Show the current manageable duration; allow holding the target. Agent waiting fields are optional and collapsed until needed.

Practice timer: elapsed time is not claimed to be focused time. Record an off-task episode after returning, or enter the tally at review. Offer undo for an accidental event before finalization. Multiple unrelated app visits before returning form one episode. Agent-check subtype may overlap with an episode and must not be counted twice.

Remove the sidebar in session mode, including the agent-wait panel. The previous alternate-state image showed a sidebar; that is superseded by this interaction decision. A planned break explicitly pauses practice and resumes afterward; it never runs invisibly as claimed work time. Handle urgent agent approvals intentionally without automatically classifying them as failure.

On completion or early finish, save review: one-line output, Yes/Partly/No, counts and optional note. Partly is an honest outcome, not equivalent to successful output for progression. No confetti, streak loss, warning about damaged attention, or instruction to restart the program.

### Daily check-in

Present sleep and phone/desktop recreational-feed minutes; stress and mindfulness are optional. Expand platform-level detail only when requested. Display “Estimate” or “From device report.” Broad Instagram/YouTube app totals cannot become exact feed minutes. Short-video minutes are a subset, not another total to add.

Daily check-in can be saved incomplete with a clear status. Avoid forcing guessed answers. A target overrun does not prevent saving or completing the day. The next day remains available after a missed day.

### Progress and outcomes

Always show eligible sample counts and self-report labels. Until both baseline and both final slots are eligible, do not display a complete percentage comparison. Practice durations and counts appear in a separate section because the intervals vary.

The example “Mixed or missing results? Show uncertainty; do not declare success” card in the image is a design annotation and must not appear as product copy. Replace it with the actual applicable state:

| State | Product copy direction | Action |
|---|---|---|
| Baseline pending | “Complete two baseline sessions to establish your starting point.” | Go to next slot |
| Final pending | “Your final comparison is available after the Day 14 assessments.” | View baseline / continue practice |
| Improvement with stable recall | “You reported fewer switches; recall was maintained.” | Inspect conditions / export |
| Fewer switches, lower recall | “Switches decreased, but recall was lower. These results are mixed.” | Review material and conditions |
| Incomplete samples | “There is not enough comparable data for the full comparison.” | View attempts and missing slots |
| Zero baseline | “No switches were reported at baseline; a percentage reduction does not apply.” | Compare recall and absolute counts |
| More switches | “More switches were reported in the final sessions.” | Inspect context; no shame or causal claim |

No “attention +40%” score. The example reduction describes reported episode counts only. Confidence intervals or statistical significance are not invented for four self-reported samples.

### Recovery

Lost connection during existing practice: show local-save/pending status only when a local write succeeded. If it failed, say entries could not be saved. Retry is idempotent; completion stays pending until acknowledged.

Timing uncertain after sleep/reload: ask whether the interval continued uninterrupted and retain an uncertainty flag when unresolved. Never infer successful work from an expired deadline. Save incomplete is always available. In the UX demo, these are simulated scenarios with visible Demo status; the demo does not claim to have tested real browser recovery.

## 6. Prototype demonstration scenarios

All values below are synthetic. They must be visually labeled and isolated from real program records. Demo navigation may skip to Day 14 or shorten animations; those controls must not exist in assessment mode for a real pilot.

| Scenario | Data / setup | Expected result |
|---|---|---|
| New user | No plan or samples | Setup and readiness; no fabricated scores |
| Working day | Day 4, one 15-minute block remaining | Start, agent waiting, record episode, review |
| Comparable change | Baseline 6 and 4; final 3 and 3; recall 4 in all sessions | Mean 5 → 3; 2 fewer; 40% reduction; recall stable |
| Mixed result | Same switches; baseline recall 4/4, final 2/2 | Mixed outcome, not success banner |
| Missing final | Only one eligible final slot | No complete before/after percentage |
| Zero baseline | Baseline 0/0, final 0/0 | Percentage not applicable; absolute values visible |
| Recovery | Existing practice, unsynced event batch | Pending state, retry, saved acknowledgement |
| Timing deviation | Benchmark interrupted by device sleep | Review uncertainty or save incomplete; excluded when unresolved |

These scenarios form the acceptance fixtures for a future clickable or functional prototype, not evidence of product effectiveness.

## 7. Architecture and data changes for prototype scope

Keep the proposed TypeScript stack: React/Vite frontend, Fastify backend, PostgreSQL, Drizzle, shared runtime API schemas. This iteration makes no new dependency/version claim and does not install anything.

For a future clickable UX demo, simulated identity, time and saved records are acceptable only when explicitly labeled. For a future functional private pilot, implement real identity, ownership, persistence, timing recovery, export and deletion before collecting private behavioral data. A UI prototype and a data-backed pilot have different validation gates.

| Domain | Prototype treatment |
|---|---|
| Programs and revisions | Retain dates, timezone, current target and immutable protocol snapshots |
| Sessions, events, reviews | Retain, including sources, finalized state and eligibility |
| Benchmark slots | Retain explicit A/B material/time assignments |
| Agent plans | Optional session child record; no agent API |
| Daily check-ins/feed usage | Retain; simplified initial UI with expandable detail |
| Research tables/jobs | Curated demo fixtures first; discovery runs and curation administration deferred |
| Mutation receipts/recovery | Required for functional pilot; represented by scenario states in UX demo |
| Auth/privacy | Simulated for design demo; real protections required for hosted personal records |

Do not remove the scientific/behavioral limitations while simplifying the UI. Do remove implementation labels such as idempotency keys from user-facing screens.

## 8. Requirements and acceptance criteria

| ID | Requirement | Acceptance |
|---|---|---|
| P-01 | Configure a feasible plan | Required fields explain themselves; optional estimates can be skipped |
| P-02 | Establish baseline correctly | Two explicit slots; no training session counted as baseline |
| P-03 | Separate recall from scoring | Material-closed recall saved before self-scoring is enabled |
| P-04 | Start useful practice quickly | Returning user can start within three actions from Today after entering a goal |
| P-05 | Support agent waiting | User can choose useful work or a paused break without launching unrelated navigation |
| P-06 | Record distraction honestly | Manual/retrospective sources visible; hidden tab alone creates no episode |
| P-07 | Preserve improvement-over-perfection | Overruns and missed days never block continuation or reset history |
| P-08 | Report defensibly | Synthetic scenarios produce the specified comparison and missing-data states |
| P-09 | Recover transparently | Pending, saved and uncertain are distinguishable; no false completion |
| P-10 | Keep burden low | Daily check-in under two minutes in usability testing, excluding practice and assessments |
| P-11 | Make records portable | Export preview includes counts, methods, exclusions and protocol version |
| P-12 | Keep evidence bounded | Three finite curated cards; external source opens deliberately |

Keyboard navigation, visible focus, sufficient contrast, reduced motion and nonintrusive timer announcements apply across the flow. Mobile daily check-in should be a single column with comfortable input targets; desktop assessment remains the initial evaluation format.

## 9. Usability evaluation script

First run: Douglas. Then, if useful, three to five volunteers resembling the intended user. This is a suggested sample, not recruited participants. Use synthetic data; no expectation that a short usability session measures attention improvement.

Give tasks without explaining which buttons to use:

1. Set up a manageable plan while leaving uncertain feed time unknown.
2. Find what is required before the first baseline session.
3. Walk through assessment, recall and self-scoring using demo time.
4. Start a practice block and decide what to do while an agent runs.
5. Record a distraction, undo an accidental duplicate, and save an honest partial output.
6. Log desktop and phone use after exceeding the planned allowance.
7. Explain the mixed-results screen in your own words.
8. Recover an unsynced session and identify whether it was actually saved.

Observe completion without assistance, wrong turns, misunderstanding of measures and entry time. Do not require thinking aloud during a real attention benchmark; that would change the task. The facilitated walkthrough uses demo mode only.

Suggested pass gate: all critical measurement/saving tasks are understandable; at least four of five users (or a comparable small-pilot threshold agreed before testing) complete the main path without help; median daily-log time below two minutes; no participant mistakes the app for a diagnostic test. Treat small-sample observations as design signals, not population estimates.

## 10. Next artifact and release gates

Current deliverables: existing eight screen concepts, three alternate-state concepts, this prototype PRD and interaction specification, plus the technical PoC reference. No clickable links between screen images or functioning application are claimed.

The next concrete artifact is an interactive prototype using this flow. Under the existing no-code instruction, a design-tool prototype would be appropriate. A TypeScript implementation would require the user to lift that constraint. Either should begin with the P0 journey and demonstration scenarios, not research automation.

Gate A — interaction design: navigate setup, assessment, practice and results with synthetic data; demonstrate errors and recovery.
Gate B — functional prototype: persist real records, pass timing/duplicate-write/ownership tests, support export and deletion.
Gate C — 14-day pilot: observe low-burden use and interpretable results; iterate before expanding features.

No gate is marked passed merely because its requirements are documented.

## 11. Decision log

2026-09-06: User requested iteration from PoC to prototype. Preserved earlier no-application-code constraint. Narrowed first prototype scope; deferred research discovery; connected the existing wireframes through interaction contracts; separated recall from scoring; converted design annotations into actual result states; specified demo versus real-pilot boundaries and usability tasks. Created this PRD as the prototype product source of truth while preserving the prior technical reference.

2026-09-08: Implementation was authorized via HANDOFF.md's second brief and built as the OpenSpec change build-initial-mvp. Identity runs in three modes (D2): local-demo is fully working, with a fixed principal, a demo realm on every record and a loopback-only boot; real refuses to boot until its four prerequisites exist, with Better Auth deferred to a follow-up change; local-pilot stays deferred but reversible by one decision needing no schema change. Domain rules — eligibility, first-switch derivation, recall scoring, result state and the progression suggestion — live as pure functions in packages/shared, with the API the only writer of derived fields and the web app calling the same functions solely for previews labeled as such (D4). Timer truth is server timestamps plus a client-side monotonic display with heartbeat-based clock-gap detection, never interval accumulation (D5). Recovery is a small IndexedDB outbox scoped to the active session plus server-side idempotency keyed by user and request hash, not an offline-first design (D6). All six specification defects named in CLAUDE.md are settled: the review count columns and recall score are nullable end to end so a blank input is never coalesced to zero; the disqualifying-interruption question became a required materially_disrupted self-attestation rather than a threshold on the interruption count; recall is locked by a separate write before self-scoring is reachable, carrying recall_delayed and recall_overrun flags at 600 s and 210 s; result-state precedence is fixed in code with an added unchanged state, and this document's own Mixed result fixture is read as switches falling from 6/4 to 3/3 alongside recall falling from 4/4 to 2/2; comparability metadata is recorded on the attempt itself as observed_conditions rather than only on the frozen slot; and identity mode is the single gate that stands in for a real-authentication trigger. Every declared result state now has a fixture. No real measurement has been collected; every figure produced by this build remains synthetic demonstration data.
