# cli-flag-validation Specification

## Purpose
Ensures that CLI flags that require a value are parsed safely, failing with a clear message instead of swallowing the next flag or throwing an internal error.

## Requirements

### Requirement: Missing flag value is rejected with a clear error
The CLI parser SHALL require a value after `--doc`, `--cost-mode`, `--target`, `--provider`, and `--cwd`. If the next token is missing or is another flag, the parser SHALL report the missing value and exit with a non-zero status (or print help).

#### Scenario: `--doc` without a value is rejected
- **WHEN** the user runs `cli-five init --doc --yes`
- **THEN** the program prints an error naming `--doc` as missing its value and does not run `init`

#### Scenario: `--cost-mode` without a value is rejected
- **WHEN** the user runs `cli-five init --cost-mode --yes`
- **THEN** the program prints an error naming `--cost-mode` as missing its value and does not run `init`

#### Scenario: `--target` without a value is rejected
- **WHEN** the user runs `cli-five init --target --yes`
- **THEN** the program prints an error naming `--target` as missing its value and does not run `init`

#### Scenario: `--provider` without a value is rejected
- **WHEN** the user runs `cli-five init --provider --yes`
- **THEN** the program prints an error naming `--provider` as missing its value and does not run `init`

#### Scenario: `--cwd` without a value is rejected
- **WHEN** the user runs `cli-five init --cwd --yes`
- **THEN** the program prints an error naming `--cwd` as missing its value and does not run `init`

#### Scenario: Value-taking flag as the final token is rejected
- **WHEN** the user runs `cli-five init --doc`
- **THEN** the program prints an error naming `--doc` as missing its value and does not run `init`

### Requirement: Known invalid flag values are rejected
For flags with a closed set of valid values (`--cost-mode`, `--target`, `--provider`), the parser SHALL reject values outside the supported set with a clear error listing the accepted values.

#### Scenario: Unknown cost mode is rejected
- **WHEN** the user runs `cli-five init --cost-mode fastest --yes`
- **THEN** the program prints an error naming `fastest` as unsupported and lists `premium`, `cheap`, and `mixed`
