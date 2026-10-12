# jev-session-routing Specification

## Purpose
TBD - created by archiving change harden-jev-and-address-review-findings. Update Purpose after archive.

## Requirements

### Requirement: Session hooks default to off
The deterministic session-hook path SHALL be disabled by default. It SHALL register only when the user explicitly opts in via `CLI_FIVE_JEVR_HOOKS=1` or a documented switch in `.opencode/jev.json`. The previously supported opt-out value `CLI_FIVE_JEVR_HOOKS=0` remains valid but becomes the default behavior.

#### Scenario: No opt-in means no hooks
- **WHEN** the plugin loads with neither `CLI_FIVE_JEVR_HOOKS` nor the file switch set to enable hooks
- **THEN** no `prompt` or `context` session hooks are registered, no classification runs at admission, and no network call is made

#### Scenario: Environment opt-in enables hooks
- **WHEN** `CLI_FIVE_JEVR_HOOKS=1` is set and the host exposes `ctx.session.hook`
- **THEN** both session hooks register and classify/inject as specified by the existing `jev-session-routing` capability

#### Scenario: File switch opt-in enables hooks
- **WHEN** `.opencode/jev.json` contains the documented hooks-enabled switch and no disabling env var is set
- **THEN** the plugin treats hooks as enabled on the next load/event

### Requirement: README describes the hooks as opt-in
The project documentation SHALL describe the session hooks as off by default and SHALL tell the user how to enable them (`CLI_FIVE_JEVR_HOOKS=1` and/or the `.opencode/jev.json` switch). It SHALL NOT state that hooks are on by default or that `CLI_FIVE_JEVR_HOOKS=0` is required to disable them.

#### Scenario: README no longer claims hooks are on by default
- **WHEN** a reader consults the README's jev section
- **THEN** the section says hooks are off by default and lists the explicit opt-in switches

### Requirement: Opt-in default leaves the tool and spawn gate intact
Turning the session hooks off by default SHALL NOT remove the `tier_classifier` tool or change the opt-in Reviewer-spawn gate. The tool path and the spawn gate SHALL continue to work exactly as before.

#### Scenario: Hooks off, tool still registered
- **WHEN** session hooks are disabled by default
- **THEN** the plugin still registers `tier_classifier` and the spawn gate still registers its `evaluate` hook with the mode defaulting to `off`
