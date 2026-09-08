## Purpose

Provides the navigation frame, session mode, responsive layout, accessibility baseline and copy rules that every screen of Attention Lab shares, so that the app stays out of the way during protected work and never punishes the user.

## ADDED Requirements

### Requirement: Navigation exists outside session mode only
Outside session mode the app SHALL offer exactly four top-level destinations: Today, Progress, Research, Settings. In session mode (a running or awaiting-review benchmark or practice session, recall, or scoring) the app SHALL hide top-level navigation and MUST NOT surface research, preferences, progress or any other prompt.

#### Scenario: Navigation on Today
- **WHEN** the user is on Today with no active session
- **THEN** the four destinations are visible and keyboard-reachable

#### Scenario: Navigation hidden during practice
- **WHEN** a practice session is running
- **THEN** no top-level navigation is rendered and the only way out is a session action (pause, finish early, abandon) or the browser itself

#### Scenario: Leaving a session by URL
- **WHEN** the user navigates to another route while a session is running or awaiting review
- **THEN** the app warns that a session is in progress and offers to return to it; the session itself is unaffected by the navigation

### Requirement: One dominant action per screen
Each screen SHALL present one primary action. Secondary actions SHALL be visually subordinate.

#### Scenario: Focus screen actions
- **WHEN** the Focus screen is displayed
- **THEN** "Record off-task episode" is the single primary control and pause, external interruption and finish early are secondary

### Requirement: Responsive layout
On viewports narrower than a tablet breakpoint the app SHALL use a single-column layout with a compact bottom navigation outside session mode. The daily check-in SHALL be usable in a single column with comfortable input targets. Desktop remains the primary format for benchmarks.

#### Scenario: Check-in on a phone-sized viewport
- **WHEN** the daily check-in is opened at a phone-sized width
- **THEN** all fields are stacked in one column, no horizontal scrolling occurs, and every control is at least a comfortable touch target

### Requirement: Accessibility baseline
All interactive controls SHALL be keyboard operable with a visible focus indicator, SHALL have a descriptive accessible name, and text SHALL meet AA contrast. Motion SHALL be reduced when the user's system prefers reduced motion. Timer displays MUST NOT announce every second to assistive technology; only user-enabled milestone announcements are permitted.

#### Scenario: Keyboard-only session review
- **WHEN** a keyboard-only user completes a session review
- **THEN** every field and the save action are reachable in a sensible order with focus visible at each step

#### Scenario: Screen reader during a timer
- **WHEN** a timer is running and milestone announcements are disabled
- **THEN** no live-region updates are emitted by the countdown

#### Scenario: Reduced motion
- **WHEN** the system prefers reduced motion
- **THEN** transitions and progress animations are disabled or replaced with instant state changes

### Requirement: Copy never punishes or gamifies
The app MUST NOT display streaks, streak loss, confetti, celebratory success banners, warnings about damaged attention, instructions to restart the program, or any percentage framed as an attention score. Neutral continuation copy SHALL be used after overruns, lapses and missed days.

#### Scenario: Missed day
- **WHEN** the user opens Today after a day with no recorded practice
- **THEN** Today shows the next achievable step with neutral copy and no reference to a broken streak or lost progress

#### Scenario: Feed allowance exceeded
- **WHEN** the daily check-in records feed minutes above the planned allowance
- **THEN** the check-in saves normally and the confirmation copy is neutral

### Requirement: Implementation details are not user-facing
Identifiers such as idempotency keys, event ids, revision ids and realm values SHALL NOT be displayed as user-facing labels. Sync state SHALL be shown as plain words (pending, saved, could not be saved).

#### Scenario: Sync state display
- **WHEN** an event batch has not yet been acknowledged by the server
- **THEN** the session shows "Pending" and no technical identifier
