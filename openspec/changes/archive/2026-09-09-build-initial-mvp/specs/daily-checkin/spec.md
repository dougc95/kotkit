## Purpose

Captures the once-a-day log — sleep and cross-device recreational feed use with honest provenance — in under two minutes, without forcing guesses and without turning an unknown into a zero.

## ADDED Requirements

### Requirement: One check-in per program day
Each program local date SHALL have at most one check-in. It SHALL be editable until the program is completed, with optimistic concurrency. The check-in for today SHALL be reachable from Today in one action.

#### Scenario: Edit today's check-in twice
- **WHEN** the user saves sleep, then later adds feed minutes for the same date
- **THEN** one check-in exists for that date containing both

#### Scenario: Stale save
- **WHEN** two tabs save the same date with the same version
- **THEN** the second save is rejected as stale and the user is shown the current values

### Requirement: Required and optional fields
The check-in SHALL present sleep and recreational feed minutes by device as the primary inputs. Stress (0–10), mindfulness minutes and a note SHALL be optional. Platform-level detail SHALL be collapsed until requested. All numeric inputs SHALL start blank.

#### Scenario: Minimal check-in
- **WHEN** the user enters sleep and one feed row and saves
- **THEN** the check-in saves and optional fields are stored as not reported

### Requirement: Blank is unknown; zero is explicit
A blank field SHALL be stored as not reported. The user SHALL be able to record an explicit zero for feed minutes on a device. The absence of a feed row for a device SHALL mean unknown for that device and MUST be displayed as such, never as 0.

#### Scenario: No phone entry
- **WHEN** the user records desktop feed minutes and nothing for phone
- **THEN** the day shows phone feed use as not reported and the daily total is labeled partial

#### Scenario: Explicit zero
- **WHEN** the user records 0 feed minutes for phone
- **THEN** phone feed use is 0 and is included in the daily total

### Requirement: Feed rows carry device, platform, scope and source
Each feed row SHALL record device (phone, desktop, tablet, unspecified), platform, minutes, an optional short-video subset that MUST NOT exceed minutes, a measurement scope of `feed` or `app_total`, a source of `estimate` or `device_report`, and an optional planned-window flag. One row per device, platform and scope per day.

#### Scenario: Short-video exceeds total
- **WHEN** a row has 30 feed minutes and 45 short-video minutes
- **THEN** the save is rejected naming the subset rule

#### Scenario: Device report transcription
- **WHEN** the user marks a row as From device report
- **THEN** the row is stored with source device report and displayed with that label

### Requirement: Aggregates respect scope and subset rules
The daily feed total SHALL sum only rows with scope `feed`, labeled device-minutes. Rows with scope `app_total` SHALL be shown separately and MUST NOT enter the feed total. Short-video minutes SHALL be reported as a subset of feed minutes and MUST NOT be added as another category.

#### Scenario: App total alongside feed estimate
- **WHEN** the day has a phone Instagram app_total of 60 and a phone Instagram feed estimate of 25
- **THEN** the feed total is 25 device-minutes and the 60 is displayed as a broad app total

#### Scenario: Two devices at once
- **WHEN** phone feed is 20 and desktop feed is 20
- **THEN** the total reads 40 device-minutes, not 40 elapsed minutes

### Requirement: Incomplete saves and completeness status
A check-in SHALL be savable at any level of completeness. A check-in SHALL be complete when sleep is reported and at least one feed-scope row (including an explicit zero) exists; an app-total row alone does not complete it. Completeness SHALL be displayed as a status, never inferred from the mere existence of the record.

#### Scenario: Sleep only
- **WHEN** only sleep is saved
- **THEN** the check-in is stored with status incomplete and Today shows what is missing

### Requirement: Overruns and missed days never block
Feed minutes above the planned allowance SHALL save normally. A day with no check-in SHALL remain a gap in the record, not a zero, and the next day SHALL be available.

#### Scenario: Allowance exceeded
- **WHEN** the user records 55 feed minutes against a 20-minute allowance
- **THEN** the check-in saves with neutral copy and the day can be marked complete

#### Scenario: Skipped day
- **WHEN** Day 9 has no check-in
- **THEN** Progress shows Day 9 as not reported and Day 10's check-in is available

### Requirement: Low burden
The complete daily check-in SHALL be achievable in one screen with no more than the required fields visible by default.

#### Scenario: Default visible fields
- **WHEN** the check-in opens
- **THEN** only sleep, phone feed minutes, desktop feed minutes and Save are visible; everything else is behind an expand control
