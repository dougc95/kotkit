## Purpose

Keeps a session's record consistent through refresh, temporary disconnection, duplicate submissions, multiple tabs and device sleep, and never lets a lost write, a retry or an expired deadline become a false completed result.

## ADDED Requirements

### Requirement: Starting a session requires the server
A session SHALL exist only after the server records its id, start time, target and version. The client MUST NOT run a timer for a session the server has not acknowledged. A start request SHALL carry an idempotency key; repeating the same key with the same content SHALL return the same session, and reusing the key with different content SHALL be a conflict.

#### Scenario: Start retried after timeout
- **WHEN** the client times out on a start and retries with the same key and content
- **THEN** exactly one session exists and the retry returns it

#### Scenario: Start while offline
- **WHEN** the server is unreachable
- **THEN** no timer starts and the screen says the session could not be started

### Requirement: Events are buffered, deduplicated and acknowledged
Every event SHALL be assigned a client event id before it is sent. Events SHALL be written to a local buffer before being sent in bounded batches. The server SHALL ignore an event whose client event id it has already stored and MUST reject an event with an impossible elapsed offset. Local tally feedback SHALL appear within 100 ms regardless of network state.

#### Scenario: Batch retried
- **WHEN** the same batch is sent twice
- **THEN** each event is stored once

#### Scenario: Impossible offset
- **WHEN** an event claims an elapsed time beyond the session's current elapsed time plus tolerance
- **THEN** the batch is rejected with the offending event identified

### Requirement: Pending, saved and could-not-save are distinct
The session SHALL show Pending only after a local write succeeded and before the server acknowledged; Saved after acknowledgement; and "Entries could not be saved" when the local write itself failed. The app MUST NOT show Saved because a request was dispatched.

#### Scenario: Connection lost mid-session
- **WHEN** the network drops after two events were buffered locally
- **THEN** the session shows Pending with a Retry control and the timer continues

#### Scenario: Local storage unavailable
- **WHEN** the browser refuses the local write
- **THEN** the session shows that entries could not be saved on this device and offers to keep trying the server directly

#### Scenario: Acknowledged after retry
- **WHEN** Retry succeeds
- **THEN** the state changes to Saved and the buffer entries are cleared

### Requirement: Reload recovers the active session
On page load the client SHALL fetch the active session, derive remaining time from the server start, target and paused seconds, and replay any buffered unsent events. It MUST NOT accumulate elapsed time from timer callbacks.

#### Scenario: Refresh during practice
- **WHEN** the user refreshes at 06:00 of a 15-minute block
- **THEN** the timer shows approximately 09:00 remaining and any buffered events are sent

#### Scenario: Refresh after target passed
- **WHEN** the page is reloaded after the target time has passed
- **THEN** the session is shown as awaiting review, not completed

### Requirement: Clock gaps are detected and resolved by the user
The client SHALL detect a discrepancy between wall-clock time and its monotonic clock greater than 60 seconds (device sleep, suspended tab, clock change) and SHALL ask whether the interval continued uninterrupted. The answer SHALL be stored. "Yes" keeps timer quality ok with the gap recorded; "No" or "Not sure" sets timer quality uncertain; the user MAY instead save the attempt as incomplete. Unresolved uncertainty SHALL persist as a flag. A benchmark with uncertain timer quality SHALL be ineligible; a practice session merely carries the flag.

#### Scenario: Laptop slept during a benchmark
- **WHEN** the device sleeps for 5 minutes during a benchmark
- **THEN** on wake the user is asked what happened, and the attempt is ineligible with reason timer uncertain unless they attest that reading continued uninterrupted

#### Scenario: Deadline passed during sleep
- **WHEN** the device wakes after the 20-minute deadline
- **THEN** the attempt is awaiting review with the gap recorded and is not treated as completed

### Requirement: Finalization is atomic and idempotent
Finalize SHALL carry an idempotency key, the expected total event count and any last batch. The server SHALL verify that its stored event count matches, commit the review and eligibility in one transaction, and return the result. A count mismatch SHALL be a conflict that tells the client to sync and retry. Repeating a finalize with the same key SHALL return the recorded result. Late events after finalization SHALL produce a reconciliation warning and MUST NOT change the finalized counts.

#### Scenario: Finalize retried
- **WHEN** finalize is retried with the same key after a timeout
- **THEN** one review exists and the retry returns it

#### Scenario: Event count mismatch
- **WHEN** the client claims 5 events and the server holds 4
- **THEN** finalize is rejected with the counts, the client sends the missing batch, and the retry succeeds

#### Scenario: Late event
- **WHEN** an event arrives for a finalized session
- **THEN** it is stored with a reconciliation warning and the review is unchanged

### Requirement: Stale writes conflict instead of overwriting
Session transitions, agent plans and check-ins SHALL carry an expected version. A stale version SHALL be rejected with the current state returned.

#### Scenario: Two tabs end a session
- **WHEN** two tabs send an end transition with the same version
- **THEN** the first succeeds, the second receives a conflict with the current state, and no duplicate transition is recorded

### Requirement: Abandon and save-incomplete are always available
The user SHALL be able to abandon a running or awaiting-review session explicitly, or save it as incomplete. Abandon SHALL discard unsent local text but retain minimal attempt status. Neither MUST ever be presented as completion.

#### Scenario: Save incomplete after uncertainty
- **WHEN** the user chooses Save as incomplete from the timing-uncertain prompt
- **THEN** the attempt ends as incomplete with the uncertainty flag, the incomplete review is offered, and once finalized it appears in the attempt list as incomplete and timer-uncertain

### Requirement: Recovery buffer is bounded and purged
The local buffer SHALL hold only the active session's unsent events and minimal non-secret state, SHALL be purged after confirmed sync or explicit abandon, and SHALL expire after seven days.

#### Scenario: Buffer after sync
- **WHEN** all events are acknowledged
- **THEN** the buffer is empty
