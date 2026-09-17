## Purpose

Offers a finite, clearly labeled set of curated evidence cards so the user can read the rationale behind the protocol without the app becoming a feed.

## ADDED Requirements

### Requirement: Three finite curated cards
The Research screen SHALL show exactly three curated cards drawn from the protocol's evidence table. Each card SHALL show title, authors and year, study design, provenance (peer-reviewed, preprint, or unknown; full text or abstract reviewed), one finding, one limitation, one relevance note, and the original source link. There SHALL be no pagination, feed, or automatic refresh.

#### Scenario: Research screen opened
- **WHEN** the user opens Research
- **THEN** three cards are shown with all required fields and a note reading "Up to three reviewed updates. Plan changes are your choice."

### Requirement: Content is labeled as demonstration content
The screen SHALL state that the cards are curated demonstration content with the date they were curated, and that automated discovery is not enabled.

#### Scenario: Last-checked label
- **WHEN** the Research screen is shown
- **THEN** it displays the curation date and "Automated discovery not enabled"

### Requirement: External sources open deliberately
Source links SHALL open in a new tab only on explicit user action, SHALL accept only HTTP(S) URLs, and the app SHALL preserve the user's location so returning lands on Research.

#### Scenario: Read source
- **WHEN** the user activates Read source
- **THEN** the original link opens in a new tab and the app remains on Research

### Requirement: Never surfaced in session mode
Research MUST NOT be promoted, linked or notified inside a practice or benchmark session.

#### Scenario: During practice
- **WHEN** a practice session is running
- **THEN** no research content or link is rendered
