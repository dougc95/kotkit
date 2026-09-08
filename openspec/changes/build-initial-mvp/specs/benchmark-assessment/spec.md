## Purpose

Runs the fixed 20-minute reading benchmark at baseline and Day 14, keeps recall sequential and locked before self-scoring, records self-reported counts without inventing values, and derives eligibility server-side with explicit reasons.

## ADDED Requirements

### Requirement: Benchmark ready state
A benchmark SHALL be startable only from an assigned slot whose planned local date is today (or, for a permitted replacement, with a recorded reason). The ready screen SHALL show the material reference, the protocol checklist, the planned time, and an explicit Start control. No benchmark SHALL start automatically.

#### Scenario: Slot on its assigned date
- **WHEN** today is the program's baseline date and slot A has no attempt
- **THEN** the ready screen offers Start for slot A

#### Scenario: Slot before its date
- **WHEN** today is before the slot's assigned date
- **THEN** Start is unavailable and the screen shows the scheduled local date and time

#### Scenario: Practice can never become a baseline
- **WHEN** a practice session is completed on Day 0
- **THEN** it is recorded as practice and never fills a benchmark slot

### Requirement: Fixed interval with no valid pause
A benchmark SHALL run for exactly 20 minutes of elapsed time from the server-recorded start. There SHALL be no pause control. Stop early SHALL end the attempt as incomplete and route to the incomplete review; it MUST NOT silently start a new attempt. Leaving the page MUST NOT stop, pause or invalidate the benchmark.

#### Scenario: Interval reached
- **WHEN** 20 minutes have elapsed
- **THEN** the attempt moves to awaiting review, shows "Close your reading material", and nothing is finalized

#### Scenario: Stop early
- **WHEN** the user stops at 14 minutes
- **THEN** the attempt is marked interval incomplete with actual elapsed time recorded, and the review is offered in incomplete form

#### Scenario: Tab hidden during benchmark
- **WHEN** the page is hidden for 15 minutes while the user reads elsewhere
- **THEN** the benchmark continues, no off-task episode is created, and the remaining time is correct when the page is shown again

### Requirement: Interruption recording during the benchmark
During the interval the user SHALL be able to record an off-task episode (after returning) and an external interruption. Each recorded event SHALL carry the elapsed time at which it was recorded. The user SHALL be able to undo the most recent unfinalized event. An urge without acting is not an episode; the app MUST NOT infer episodes from anything other than the user's action or later tally.

#### Scenario: Record after returning
- **WHEN** the user returns from checking a feed and presses Record off-task episode at 07:42
- **THEN** one episode with elapsed time 07:42 is stored and the on-screen tally increments by one

#### Scenario: Undo accidental duplicate
- **WHEN** the user presses Record twice within a few seconds and then Undo once
- **THEN** exactly one episode remains

### Requirement: Recall is a separate, timed, then locked step
After the interval ends, recall SHALL start only when the user confirms the material is closed. The delay between interval end and recall start SHALL be recorded; a delay above ten minutes SHALL be flagged as a recall-delayed deviation (visible, not by itself excluding). Recall SHALL present five free-text points and a three-minute countdown. Saving recall SHALL lock all five texts permanently and record the actual recall duration; a duration more than 30 seconds beyond three minutes SHALL be flagged as a recall-overrun deviation. Blank points are permitted.

#### Scenario: Recall started promptly
- **WHEN** the user confirms readiness 40 seconds after the interval ended
- **THEN** the three-minute countdown starts and the 40-second delay is recorded without a deviation flag

#### Scenario: Recall started after a long break
- **WHEN** the user confirms readiness 25 minutes after the interval ended
- **THEN** recall proceeds and the attempt carries a recall-delayed deviation visible in review and export

#### Scenario: Recall text is immutable after save
- **WHEN** recall has been saved
- **THEN** no request can change any of the five texts, and the scoring screen shows them read-only

### Requirement: Self-scoring is unavailable until recall is locked
Scoring controls SHALL be inaccessible (not rendered as operable) until recall is saved. Scoring SHALL present the five locked points and require Accurate/Not accurate for each non-blank point; blank points SHALL score 0 automatically. Recall score SHALL be the count of Accurate points (0–5) and SHALL be labeled self-reported everywhere it appears. An attempt whose interval is incomplete MAY be finalized without saving recall; it is then ineligible with reason recall missing (and scoring incomplete), and no recall score is invented for it.

#### Scenario: Incomplete attempt finalized without recall
- **WHEN** the user stopped a benchmark early and finalizes the incomplete review without saving recall
- **THEN** the attempt is finalized as incomplete with reasons interval incomplete, recall missing and scoring incomplete, and its recall score is not reported

#### Scenario: Attempt to score before recall
- **WHEN** a scoring submission arrives for an attempt whose recall is not locked
- **THEN** it is rejected and the recall step is required first

#### Scenario: Score with two blank points
- **WHEN** points 1–3 are marked Accurate and points 4–5 were blank
- **THEN** the recall score is 3 and the two blanks are shown as scored 0 because blank

### Requirement: Counts are confirmed at review and blank means unknown
The benchmark review SHALL present numeric inputs for off-task episodes (S) and external interruptions (E) that start blank unless events were recorded, in which case the event-derived count is prefilled with method `event`. The user MAY replace the count with a retrospective tally, changing the method to `retrospective`; the two methods are alternatives and MUST NOT be summed. An explicit 0 is a measurement; a blank is stored as not reported and MUST NOT be stored, displayed, averaged or exported as 0. An optional noticed-mind-wandering count (M) MAY be recorded and is descriptive only.

#### Scenario: Paper tally entered
- **WHEN** no events were recorded and the user enters 4 from a paper tally
- **THEN** S is 4 with method retrospective

#### Scenario: Blank count
- **WHEN** the user finalizes without entering S
- **THEN** S is stored as not reported, the attempt is ineligible with reason count unknown, and no screen renders "0" for it

#### Scenario: Explicit zero
- **WHEN** the user enters 0 for S
- **THEN** S is 0 and the attempt can be eligible

### Requirement: First-switch time has three distinct states
Time to first voluntary switch (T) SHALL be derived as: no episodes reported → `20+, capped`; first episode recorded as an event → the elapsed time of that event; episodes reported without a recorded time → `Unknown`, unless the user optionally supplies an estimated minute, which is stored as an estimate. `Unknown` MUST never be rendered as `20+`.

#### Scenario: Retrospective count without time
- **WHEN** S is 3 by retrospective tally and no estimate is given
- **THEN** T shows "Unknown"

#### Scenario: No switches
- **WHEN** S is 0
- **THEN** T shows "20+, capped"

#### Scenario: Event-timed first switch
- **WHEN** the first recorded off-task event was at 06:10
- **THEN** T is 6 minutes 10 seconds with method event

### Requirement: Disruption is a required self-attestation
The benchmark review SHALL require an explicit Yes/No answer to "Was this session materially disrupted?" with an optional note. Yes SHALL make the attempt ineligible with reason materially disrupted. External interruption counts alone MUST NOT disqualify an attempt.

#### Scenario: Attestation unanswered
- **WHEN** the user tries to finalize without answering the disruption question
- **THEN** finalize is rejected naming the missing answer

#### Scenario: External interruptions without disruption
- **WHEN** E is 2 and the user answers No to material disruption
- **THEN** the attempt remains eligible on that criterion

### Requirement: Observed conditions live on the attempt
Each attempt SHALL record the conditions as they actually were — device format, language, material level, and accommodations — defaulted from the slot and confirmed or corrected at review. Differences between a baseline and a final attempt SHALL produce a comparability warning, never a claim of equivalence and never an exclusion.

#### Scenario: Accommodation added at final
- **WHEN** final A records increased font size and baseline A did not
- **THEN** the report shows a comparability warning naming the difference

### Requirement: Eligibility is derived server-side with explicit reasons
An attempt SHALL be eligible only when all hold: full 20-minute interval completed without early stop; recall locked; scoring complete; S reported; disruption answered No; timer quality not uncertain; attempt local date equals the slot's assigned date; not excluded by amendment; and, for `pilot` realm, time source measured. Every failing condition SHALL be stored as an exclusion reason. The client MAY preview eligibility but the stored value is the server's.

#### Scenario: All conditions met
- **WHEN** an attempt completes the interval, recall, scoring, S reported, not disrupted, timer ok, on its date
- **THEN** it is eligible with no exclusion reasons

#### Scenario: Multiple failing conditions
- **WHEN** an attempt stopped early and S is blank
- **THEN** it is ineligible with both interval incomplete and count unknown recorded

#### Scenario: Attempt outside its date
- **WHEN** baseline B is completed on Day 1 instead of Day 0
- **THEN** it is ineligible with reason timing deviation and remains visible and inspectable

### Requirement: One replacement per slot with a reason
A slot SHALL hold at most two attempts. A second attempt SHALL require a reason and SHALL be permitted only when the first is ineligible or excluded by amendment. The system MUST NOT select the better of two eligible attempts.

#### Scenario: Replacement after disruption
- **WHEN** baseline A was materially disrupted and the user starts a replacement with a reason
- **THEN** the replacement is allowed, both attempts remain visible, and the replacement is the slot's candidate for comparison

#### Scenario: Third attempt
- **WHEN** a slot already has two attempts
- **THEN** a further start is rejected

#### Scenario: Replacement of an eligible attempt
- **WHEN** the first attempt is eligible and the user requests a replacement
- **THEN** the request is rejected and the screen explains that eligible attempts are not retaken

### Requirement: Finalized attempts are immutable; amendments are append-only
Once finalized, an attempt's counts, recall and score MUST NOT change. The user SHALL be able to add an append-only amendment with a reason that either explains or excludes the attempt from the report. Exclusions SHALL be honored by reports without deleting the original values.

#### Scenario: Exclude a finalized attempt
- **WHEN** the user adds an amendment excluding baseline B with a reason
- **THEN** the report treats baseline B as ineligible with reason excluded by amendment and still lists its original values

### Requirement: Final benchmarks on Day 14
Final A and B SHALL be assigned to the program's Day 14 local date. Completion on another date SHALL be recorded and labeled a timing deviation. Late completion MUST NOT reset or discard any earlier work.

#### Scenario: Final completed on Day 15
- **WHEN** final A is completed one day late
- **THEN** it is stored, labeled timing deviation, ineligible for the standard comparison, and all prior records are untouched

### Requirement: Benchmarks are visually distinct from practice
The benchmark screens SHALL be visually distinguishable from practice screens, SHALL state the fixed 20-minute interval, and SHALL state that leaving the page to read does not count as distraction.

#### Scenario: Benchmark ready screen
- **WHEN** the benchmark ready screen is shown
- **THEN** it is labeled as a fixed 20-minute assessment and carries the "leaving this page to read does not count as distraction" note
