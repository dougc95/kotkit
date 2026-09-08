## Purpose

Runs the two daily protected practice blocks — quick to start, honest to record, never punitive — including optional agent-waiting plans, interruption events with undo, session review, and the progression suggestion.

## ADDED Requirements

### Requirement: Today shows one next action and two blocks
Today SHALL derive a single next action from program state: no program → setup; draft → readiness; a baseline slot without a finalized attempt on or after Day 0 → that benchmark slot; Days 1–13 otherwise → next practice block; Day 14 → final slots; after Day 14 → a final slot that still lacks a finalized attempt, otherwise Progress. Today SHALL show two blocks for the current day with status not started, in progress, completed or partial, and the current target duration from the governing revision. The empty state SHALL read "Start with your baseline", never zero-valued improvement cards.

#### Scenario: Day 4 with one block done
- **WHEN** it is Day 4 and block 1 was completed
- **THEN** Today shows block 1 completed, block 2 as the next action, and the target duration from the current revision

#### Scenario: Missed day
- **WHEN** it is Day 6 and Day 5 has no sessions
- **THEN** Today shows Day 6's block 1 as the next action with neutral copy

#### Scenario: Returning user can start in three actions
- **WHEN** a returning user is on Today and types an intended output
- **THEN** a practice session is running within three user actions

### Requirement: Practice requires a short intended output
Starting a practice block SHALL require an intended output of 1–200 characters. The duration SHALL default to the current target; when a progression suggestion is pending, the user SHALL be able to hold the current target instead. Agent-waiting fields SHALL be optional and collapsed by default.

#### Scenario: Start without output
- **WHEN** the user presses Start with an empty intended output
- **THEN** the session does not start and the field is marked required

#### Scenario: Hold the target
- **WHEN** a +5 minute suggestion is pending and the user chooses to hold
- **THEN** the session starts at the current target and the suggestion remains available next time

### Requirement: Practice timer and elapsed time
The timer SHALL display remaining time derived from the server-recorded start, target and paused seconds, with an option to hide the display and an optional end chime. Elapsed time MUST NOT be presented as focused time. At the target the session SHALL move to awaiting review; it MUST NOT finalize automatically.

#### Scenario: Timer hidden
- **WHEN** the user hides the timer
- **THEN** the remaining time is not shown until the user reveals it, and the end-of-block signal still fires if enabled

#### Scenario: Target reached
- **WHEN** the target duration elapses
- **THEN** the session is awaiting review and no completion is recorded until the review is saved

### Requirement: Pause and resume are explicit
Practice SHALL support explicit pause and resume. Paused intervals SHALL be stored and excluded from elapsed time. A planned screen-free break SHALL be a pause with reason planned break; it MUST NOT run as claimed work time. Ending during a pause SHALL go to review.

#### Scenario: Planned break
- **WHEN** the user chooses "Take a screen-free break" during agent waiting
- **THEN** the session is paused with reason planned break and the timer stops until Resume

#### Scenario: Paused seconds excluded
- **WHEN** a 15-minute block includes a 4-minute pause
- **THEN** the block completes after 15 minutes of unpaused elapsed time and 240 paused seconds are stored

### Requirement: Interruption events with undo and subtypes
During practice the user SHALL be able to record an off-task episode, an external interruption, and an unplanned agent check. An agent check MAY be marked as also being an off-task episode; when so marked it SHALL be stored as a subtype of one episode and MUST NOT be counted twice across categories. Multiple unrelated app visits before returning SHALL be one episode. The most recent unfinalized event SHALL be undoable.

#### Scenario: Agent check that was also off-task
- **WHEN** the user records an agent check and marks it as an off-task episode
- **THEN** the off-task tally increments by one, the agent-check tally increments by one, and the review shows both without adding them together

#### Scenario: One departure, five apps
- **WHEN** the user leaves, visits five unrelated apps, returns and presses Record once
- **THEN** exactly one episode is stored

#### Scenario: Hidden page creates nothing
- **WHEN** the page is hidden and shown again without any user action
- **THEN** no event of any kind is created

### Requirement: Optional agent waiting plan
A practice session MAY have one agent plan with a workstream, the useful task to do while waiting, a next review checkpoint (default: end of this block), and a ready-to-resume note. The plan SHALL be editable during the session with optimistic concurrency and SHALL contain no agent credentials, outputs or logs. "Return to my task" SHALL close the panel without leaving the session.

#### Scenario: Save a plan mid-session
- **WHEN** the user opens the agent panel, fills the useful task and saves
- **THEN** the plan is stored against the session and the session continues uninterrupted

#### Scenario: Stale plan write
- **WHEN** two tabs save the plan with the same version
- **THEN** the second save is rejected as stale and the first is preserved

### Requirement: Session review saves honest outcomes
The review SHALL collect a one-line output description, Useful output? Yes/Partly/No (required), off-task episodes, external interruptions and unplanned agent checks (prefilled from events with method event, otherwise blank), and an optional note. Blank counts are stored as not reported. Partly is a valid outcome and does not count as Yes for progression. Saving the review SHALL finalize the session.

#### Scenario: Partial output
- **WHEN** the user saves with Partly
- **THEN** the session is finalized, the day shows the block as completed with partial output, and the confirmation copy is neutral

#### Scenario: Early finish
- **WHEN** the user finishes early at 8 of 15 minutes and saves the review
- **THEN** the session is finalized as an incomplete block with 8 minutes recorded, and the next block remains available

### Requirement: Progression suggestion follows the protocol rule
The server SHALL suggest adding five minutes, up to the current band ceiling (Days 1–3: 10; 4–7: 15; 8–10: 20; 11–14: 25), only after two consecutive local days in which both blocks were completed at the current target with output Yes and at most one off-task episode per block. Missed days SHALL hold the suggestion state without resetting anything. The user SHALL accept (creating a revision) or hold. Benchmark duration MUST never follow progression.

#### Scenario: Two qualifying days
- **WHEN** Days 4 and 5 each have two complete 15-minute blocks, output Yes, and at most one episode each
- **THEN** Today on Day 6 offers +5 minutes only if the band ceiling permits; on Day 6 the ceiling is 15 so no suggestion appears until Day 8

#### Scenario: Partly output breaks the streak of qualifying days
- **WHEN** one of the two days has a block marked Partly
- **THEN** no suggestion is made

#### Scenario: Suggestion accepted
- **WHEN** the user accepts a suggestion
- **THEN** a new revision is created with the increased duration and reason "progression accepted"

### Requirement: One unfinished session per user
The server SHALL allow at most one session in running, paused or awaiting-review state per user. A second start SHALL be rejected with the active session identified. A second browser tab SHALL load the existing session.

#### Scenario: Second tab
- **WHEN** a second tab opens Today while a session is running
- **THEN** it shows the existing session rather than a new start control

#### Scenario: Start while awaiting review
- **WHEN** a session is awaiting review and the user tries to start another
- **THEN** the start is rejected and the pending review is offered

### Requirement: Practice metrics stay separate from benchmarks
Practice sessions SHALL never populate a benchmark slot, and practice counts SHALL be reported per block with their varying durations, never merged into the fixed 20-minute comparison.

#### Scenario: Practice on Day 14
- **WHEN** a practice block is completed on Day 14
- **THEN** it appears in the practice trend and has no effect on the final comparison
