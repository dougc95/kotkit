## Purpose

Decides who the acting user is, stamps every stored record with the realm it belongs to, and guarantees that synthetic demonstration data can never be mistaken for, mixed with, or exposed as a real personal measurement.

## ADDED Requirements

### Requirement: Identity mode is an explicit startup setting
The server SHALL read an identity mode of `local-demo` or `real` from its environment at startup and MUST refuse to start when the value is missing or unrecognized. There SHALL be no silent fallback from one mode to another.

#### Scenario: Missing identity mode
- **WHEN** the server starts without an identity mode configured
- **THEN** it exits with a message naming the setting and the two accepted values, and no request is served

#### Scenario: Unrecognized identity mode
- **WHEN** the identity mode is set to a value other than `local-demo` or `real`
- **THEN** the server exits with a message naming the accepted values

### Requirement: Local-demo mode uses a single fixed principal and binds only to loopback
In `local-demo` mode the server SHALL treat every request as coming from one fixed local principal, SHALL listen only on a loopback address, and MUST refuse to start if configured to listen on any other interface.

#### Scenario: Loopback binding accepted
- **WHEN** identity mode is `local-demo` and the configured host is `127.0.0.1` or `localhost`
- **THEN** the server starts and all requests are attributed to the fixed local principal

#### Scenario: Non-loopback binding refused
- **WHEN** identity mode is `local-demo` and the configured host is any address other than loopback
- **THEN** the server exits with a message stating that demo mode must never be exposed on a network interface

### Requirement: Real mode refuses to start until real authentication is configured
In `real` mode the server SHALL verify that every real-authentication prerequisite is present and MUST refuse to start when any is missing, listing the missing prerequisites and pointing to the limitations document. This change does not implement real authentication; the refusal is the gate.

#### Scenario: Real mode without prerequisites
- **WHEN** identity mode is `real` and any of the authentication secret, OAuth client credentials, or invite allowlist is absent
- **THEN** the server exits listing exactly which prerequisites are missing and stating that real authentication is not yet implemented

#### Scenario: Real mode is never satisfied by demo defaults
- **WHEN** identity mode is `real`
- **THEN** the fixed local principal is never used and no request is served

### Requirement: Every user-owned record carries a realm
Every stored record that belongs to a user SHALL carry a realm of `demo` or `pilot`, either directly (programs, sessions, check-ins) or through the parent record it belongs to (revisions, slots, events, reviews, amendments, agent plans, feed rows), so that every record's realm is determinable and every query is scoped by it. In `local-demo` mode the server MUST stamp every created record `demo` and MUST reject any request that attempts to create or read a `pilot` record.

#### Scenario: Records created in demo mode
- **WHEN** any record is created while identity mode is `local-demo`
- **THEN** its realm is `demo` regardless of any value supplied by the client

#### Scenario: Client cannot choose the realm
- **WHEN** a create request includes a realm field
- **THEN** the request is rejected as malformed and no record is created

### Requirement: Realms are never mixed in a result
Any computation that combines records (comparison, report, export, progression suggestion) SHALL verify that all inputs share one realm and MUST fail with an explicit error rather than silently filtering when they do not.

#### Scenario: Mixed realms in a comparison
- **WHEN** a report would combine a `demo` attempt with a `pilot` attempt
- **THEN** the request fails with an explanation that simulated and real results are never combined, and no partial result is returned

### Requirement: Demo mode is permanently and unmistakably labeled
While identity mode is `local-demo`, every screen SHALL display a persistent banner stating that the data is synthetic demonstration data and not a real measurement. Every export and report produced in demo mode SHALL carry the same label in its content.

#### Scenario: Banner on every screen
- **WHEN** any screen is displayed in `local-demo` mode, including session mode screens
- **THEN** the demo banner is visible without scrolling

#### Scenario: Export carries the demo label
- **WHEN** an export is generated in `local-demo` mode
- **THEN** the exported content begins with a line identifying it as demonstration data

### Requirement: Demo-only controls exist only in demo mode
In `local-demo` mode the user SHALL be able to set a demo clock offset (advance the current local date and time), load a named demonstration scenario, and reset all demo data. These controls MUST NOT exist in `real` mode, and records created under a non-zero demo clock offset SHALL record a time source of `demo_clock`.

#### Scenario: Skip to Day 14 in demo mode
- **WHEN** the user sets the demo clock to the program's final date
- **THEN** Today shows the Day 14 next action and any attempt started afterwards records time source `demo_clock`

#### Scenario: Load a demonstration scenario
- **WHEN** the user loads a named scenario from the set defined in the Prototype PRD §6 (new user, working day, comparable change, mixed result, missing final, zero baseline, recovery, timing deviation)
- **THEN** existing demo data for the principal is replaced after confirmation, and the resulting Progress screen shows the result state that scenario specifies

#### Scenario: Reset demo data
- **WHEN** the user confirms a reset
- **THEN** all `demo` records for the principal are removed and Today shows the new-user empty state

### Requirement: Every resource is scoped to its owner
Every read, write, export and nested-resource request SHALL be filtered by the acting principal. A resource owned by another principal MUST be reported as not found, never as forbidden, so that existence is not disclosed.

#### Scenario: Another principal's session
- **WHEN** a request references a session that belongs to a different principal
- **THEN** the response is "not found" and no detail of the session is returned

#### Scenario: Cross-program references are rejected
- **WHEN** a session start references a program, revision or slot not owned by the acting principal
- **THEN** the request is rejected and no session is created

### Requirement: Private data is never written to logs or stored insecurely
Free-text notes (intended outputs, recall points, review notes, disruption notes) MUST NOT appear in server logs or error responses. Private responses SHALL be marked non-cacheable. No authentication token SHALL be stored in browser storage.

#### Scenario: Error during finalize
- **WHEN** a finalize request fails validation
- **THEN** the error response identifies the failing fields by name without echoing note text, and the server log entry contains the request id and error code but no note text
