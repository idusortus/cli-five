# addon-error-handling Specification

## Purpose
Makes `add codegraph` and `add jev` as resilient as `init` when the target file is malformed, so a bad `opencode.json` or `AGENTS.md` never crashes the add-on.

## Requirements

### Requirement: `add codegraph` catches merge errors and reports them
`runCodegraph` SHALL wrap `mergeBlock` calls (and any other file modifications) in a try/catch. If a target file is malformed, it SHALL log a warning explaining which file is broken and how to fix it, set a non-zero exit code, and avoid writing any other files.

#### Scenario: Malformed `opencode.json` during `add codegraph` is handled
- **WHEN** `add codegraph` runs in a directory whose `opencode.json` is not valid JSON
- **THEN** the command prints a clear warning, exits non-zero, and does not crash with a stack trace

### Requirement: `add jev` catches merge errors and reports them
`runJev` SHALL wrap `mergeBlock` calls for `opencode.json` and `AGENTS.md` in a try/catch. A malformed target file SHALL produce a clear warning, a non-zero exit code, and no unhandled exception.

#### Scenario: Malformed `opencode.json` during `add jev` is handled
- **WHEN** `add jev` runs in a directory whose `opencode.json` is not valid JSON
- **THEN** the command prints a clear warning, exits non-zero, and does not crash

#### Scenario: Malformed `AGENTS.md` during `add jev` is handled
- **WHEN** `add jev` runs in a directory whose `AGENTS.md` cannot be merged
- **THEN** the command prints a clear warning, exits non-zero, and does not crash
