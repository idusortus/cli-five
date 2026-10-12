# Spec Delta

## Purpose

Provides a single, defensive credential-store reader that cli-five and the Jev plugin both use, so provider detection never accidentally reads a repo-local file and the two readers cannot drift.

## ADDED Requirements

### Requirement: Only absolute credential-store paths are considered
The reader SHALL build and evaluate candidate paths for OpenCode's `auth.json` only when the resolved path is absolute. A relative candidate SHALL be treated as "no file".

#### Scenario: Unset `XDG_DATA_HOME` does not create a relative candidate
- **WHEN** `XDG_DATA_HOME` is unset or empty and the reader builds the fallback path
- **THEN** the fallback path is not considered unless it is absolute

#### Scenario: Explicit relative `XDG_DATA_HOME` is ignored
- **WHEN** `XDG_DATA_HOME` is set to a relative value
- **THEN** the reader skips that candidate and falls back to the absolute home-directory path

### Requirement: Reader is shared between cli-five and the Jev plugin
cli-five's provider detection (`src/util/auth.mjs`) and the Jev plugin's credential resolution SHALL use the same absolute-path logic and the same provider-key shape (`opencode-go`). They SHALL not independently parse the store, so a fix in one cannot drift from the other.

#### Scenario: Both paths resolve the same stored credential
- **WHEN** cli-five detects authenticated providers and the Jev plugin resolves a credential from the same `auth.json`
- **THEN** both read the same key from the same absolute file and interpret the same provider entry

### Requirement: Missing or unreadable store degrades safely
If the store file is missing, unreadable, unparseable, or lacks the `opencode-go` entry, the reader SHALL return "no credential" and SHALL NOT throw.

#### Scenario: Missing store file
- **WHEN** no candidate `auth.json` exists
- **THEN** the reader returns `null` / empty providers without throwing
