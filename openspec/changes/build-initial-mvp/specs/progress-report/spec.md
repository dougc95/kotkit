## Purpose

Presents the baseline/final comparison and daily trends honestly — with sample counts, provenance, exclusions and uncertainty always visible — and lets the user take the record out as a portable export.

## ADDED Requirements

### Requirement: Sample counts and provenance are always visible
Progress SHALL always show the number of eligible baseline and final samples, label every count as self-reported, and list every attempt with its eligibility and exclusion reasons.

#### Scenario: One eligible baseline
- **WHEN** baseline A is eligible and baseline B is ineligible
- **THEN** Progress shows "1 of 2 baseline samples eligible" and lists B with its reason

### Requirement: No complete comparison until two plus two
A before/after percentage MUST NOT be displayed until both baseline slots and both final slots have an eligible attempt. Partial records SHALL remain viewable.

#### Scenario: Missing final
- **WHEN** only one final slot is eligible
- **THEN** no percentage is shown, the state is insufficient samples, and the eligible attempts are listed

### Requirement: Comparison mathematics
When two plus two are eligible: baseline S0 = mean of the two baseline S values; final S14 = mean of the two final S values; absolute change = S0 − S14; percentage reduction = 100 × (S0 − S14) / S0 only when S0 > 0. When S0 < 3 the report SHALL lead with absolute counts and show a low-baseline note. Recall means SHALL be shown alongside. First-switch times SHALL be listed per attempt with their state; a mean SHALL be shown only when all four are known.

#### Scenario: Comparable change fixture
- **WHEN** baseline S is 6 and 4, final S is 3 and 3, recall 4 in all
- **THEN** the report shows 5 → 3, 2 fewer switches, 40% reduction, recall 4 → 4

#### Scenario: Zero baseline fixture
- **WHEN** baseline S is 0 and 0 and final S is 0 and 0
- **THEN** percentage shows "not applicable", absolute counts are shown, and no division error, infinity or 100% appears

#### Scenario: Low baseline
- **WHEN** S0 is 2 and S14 is 1
- **THEN** the report leads with "1 fewer switch" and shows a low-baseline note beside the percentage

#### Scenario: Capped first-switch values
- **WHEN** two attempts have T of 20+ and two have known times
- **THEN** T is listed per attempt and no mean T is computed

### Requirement: Result state with precedence
The report SHALL show exactly one result state chosen by evaluating these in order and taking the first that applies: (1) baseline pending — fewer than two eligible baseline attempts and Day 14 not yet finished; (2) final pending — two eligible baseline attempts, no final attempts, before or on Day 14; (3) insufficient samples — any slot lacks an eligible attempt after final attempts exist or Day 14 has passed; (4) zero baseline — S0 = 0; (5) more switches — S14 > S0; (6) unchanged — S14 = S0; (7) fewer switches, lower recall — S14 < S0 and final recall mean < baseline recall mean; (8) improvement with maintained recall — S14 < S0 and final recall mean ≥ baseline recall mean. Copy SHALL follow the PRD §5 table; the unchanged state SHALL read "The reported switch count did not change."

#### Scenario: Mixed result fixture
- **WHEN** baseline S is 6 and 4, final S is 3 and 3, baseline recall 4 and 4, final recall 2 and 2
- **THEN** the state is fewer switches, lower recall with copy "Switches decreased, but recall was lower. These results are mixed." and no success banner

#### Scenario: More switches
- **WHEN** S0 is 3 and S14 is 5
- **THEN** the state is more switches with copy "More switches were reported in the final sessions." and no causal or shaming statement

#### Scenario: Zero baseline beats direction
- **WHEN** S0 is 0 and S14 is 1
- **THEN** the state is zero baseline, not more switches

#### Scenario: Unchanged
- **WHEN** S0 equals S14
- **THEN** the state is unchanged

### Requirement: No invented scores
The report MUST NOT display an attention score, an "attention improved by N%" statement, a confidence interval, a significance test, or a causal claim. The change SHALL be described as "reported switches". A note SHALL state that observed change does not establish cause.

#### Scenario: Improvement copy
- **WHEN** the state is improvement with maintained recall
- **THEN** the headline says "fewer reported switches" and the cause note is present

### Requirement: Comparability warnings
When any observed condition (device format, language, material level, accommodations) differs between a baseline attempt and a final attempt, the report SHALL show a warning naming the difference. Warnings MUST NOT change eligibility.

#### Scenario: Language differs
- **WHEN** final B was read in a different language from baseline B
- **THEN** a comparability warning names the language difference and the comparison is still shown

### Requirement: Practice and daily trends are separate sections
Practice blocks SHALL appear in their own section showing per-day planned and completed durations, output quality and per-block counts, with the note that durations vary. Daily check-ins SHALL appear with sleep and feed minutes by device; days with no record SHALL appear as gaps.

#### Scenario: Practice growth
- **WHEN** practice grew from 10 to 25 minutes over the program
- **THEN** the practice trend shows the durations and the benchmark comparison is unaffected

#### Scenario: Missing check-in day
- **WHEN** Day 9 has no check-in
- **THEN** the daily trend shows Day 9 as not reported, not zero

### Requirement: Charts carry exact values
Any chart SHALL be accompanied by the exact values and their source labels, and cap labels (20+) SHALL remain visible.

#### Scenario: Chart with capped value
- **WHEN** an attempt's T is 20+
- **THEN** the chart or table shows "20+, capped" for that attempt

### Requirement: Export preview and download
The user SHALL be able to preview and download the program record as CSV and as Markdown. The export SHALL include, per attempt: phase, label, local date, realm, time source, S with method, T with state, recall score, E, M, disruption answer, conditions, eligibility and exclusion reasons, protocol revision; per day: sleep, feed rows with device, platform, scope, source; and program metadata including timezone and revisions. Not-reported values SHALL be exported as empty, never 0. The response SHALL be non-cacheable.

#### Scenario: Export with a blank count
- **WHEN** an attempt has S not reported
- **THEN** the CSV cell for S is empty and the exclusion column lists count unknown

#### Scenario: Demo export
- **WHEN** the export is produced in demo mode
- **THEN** its first line labels it demonstration data
