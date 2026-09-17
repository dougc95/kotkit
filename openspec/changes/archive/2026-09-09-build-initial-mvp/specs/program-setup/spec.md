## Purpose

Lets the user build a feasible 14-day plan, assign matched reading materials to the four benchmark slots before any benchmark begins, and keeps every protocol change as an immutable dated revision.

## ADDED Requirements

### Requirement: Basic plan captures only what is required
The setup step SHALL require a baseline local date (Day 0), a confirmed timezone, and an initial practice block duration. A planned leisure allowance SHALL be an editable goal with a default of 20 minutes. A current daily feed-time estimate SHALL be optional and labeled as an estimate. Optional fields MUST be skippable without validation errors.

#### Scenario: Save with optional fields blank
- **WHEN** the user provides date, timezone and duration and leaves feed estimate blank
- **THEN** the plan saves as a draft and the feed estimate is stored as not reported

#### Scenario: Timezone is confirmed, not assumed
- **WHEN** the setup form opens
- **THEN** the detected timezone is prefilled but the user must confirm it before saving, and the confirmed value is stored on the program

#### Scenario: Initial duration below ten minutes
- **WHEN** the user selects 5 minutes as the initial block
- **THEN** the plan saves and the first progression band ceiling remains 10 minutes

### Requirement: Readiness step assigns materials and benchmark times
After the basic plan, a readiness step SHALL collect four material references (unread sections of similar length and difficulty, one language) and assign them to baseline A, baseline B, final A and final B, plus a planned local time for baseline A and baseline B at least one hour apart. Final A and B SHALL default to the baseline times. Instructions SHALL state that reading elsewhere is allowed and paper tallying is acceptable.

#### Scenario: Readiness incomplete
- **WHEN** the user saves readiness with fewer than four material references
- **THEN** the program stays a draft and the screen lists exactly which slots are missing

#### Scenario: Baseline times too close
- **WHEN** baseline A and B are planned less than one hour apart
- **THEN** the save is rejected with a message stating the one-hour minimum

#### Scenario: Readiness complete
- **WHEN** all four references and both baseline times are saved
- **THEN** the program becomes baseline-ready and Today shows "Start with your baseline"; no timer starts

### Requirement: Saving never starts a timer
Saving the plan or readiness step MUST route to Today or the readiness checklist, never directly into a running assessment.

#### Scenario: Save readiness
- **WHEN** the readiness step is saved
- **THEN** the user lands on Today with the next benchmark slot shown as the next action

### Requirement: Program calendar uses stored timezone and local dates
Day 0 SHALL be the baseline local date; Days 1–14 SHALL be the following local calendar dates in the program's stored timezone; the final date is Day 14. Changing the profile timezone later MUST NOT rewrite program days. Current day SHALL be derived server-side from the program timezone (or the demo clock in demo mode).

#### Scenario: Daylight-saving transition
- **WHEN** a daylight-saving change occurs between Day 0 and Day 14
- **THEN** each program day still corresponds to one local calendar date and no day is skipped or duplicated

#### Scenario: Profile timezone changed mid-program
- **WHEN** the user changes the profile timezone on Day 8
- **THEN** the program's day boundaries continue to use the timezone stored at creation

### Requirement: One program per user at a time
A user SHALL have at most one program that is draft, baseline-ready or active. Completing or archiving a program MUST be explicit.

#### Scenario: Second program while one is active
- **WHEN** the user attempts to create a new program while one is active
- **THEN** the request is rejected with the existing program identified

### Requirement: Protocol settings are immutable revisions
Practice duration, band ceilings, leisure allowance and the progression rule SHALL be stored as an immutable revision with an effective day and a reason. Every session SHALL reference the revision that governed it. Changing a setting MUST create a new revision and MUST NOT alter past sessions. Overrides SHALL require a short reason.

#### Scenario: Target changed on Day 8
- **WHEN** the user changes the practice duration on Day 8 with a reason
- **THEN** a new revision effective from Day 8 is created, sessions from Days 1–7 still reference the earlier revision, and the report shows both revisions

#### Scenario: Revision without reason
- **WHEN** a revision is submitted with an empty reason
- **THEN** it is rejected

### Requirement: Benchmark slots freeze once attempted
Each program SHALL have exactly four required slots (baseline A/B, final A/B) and MAY have an optional midpoint slot. A slot's material reference and planned time MUST NOT change after the slot has an attempt.

#### Scenario: Edit an attempted slot
- **WHEN** the user tries to change the material reference of a slot with an existing attempt
- **THEN** the change is rejected and the screen explains that the slot is frozen

#### Scenario: Edit an unattempted final slot
- **WHEN** the user changes final B's planned time before Day 14 and before any final attempt
- **THEN** the change is saved
