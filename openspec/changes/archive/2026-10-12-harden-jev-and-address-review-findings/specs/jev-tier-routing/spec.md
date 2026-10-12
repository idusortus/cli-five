# Spec Delta

## ADDED Requirements

### Requirement: `add jev` supports `--dry-run`
`runJev` SHALL accept the parsed CLI arguments. When `args.dryRun` is true, the command SHALL print the actions it would take and SHALL NOT create directories, copy files, or modify `opencode.json` / `AGENTS.md`.

#### Scenario: Dry-run prints the plan and writes nothing
- **WHEN** `add jev --dry-run` is executed in an OpenCode-scaffolded directory
- **THEN** the command lists the plugin files it would copy and the config entries it would merge, exits 0, and no files are created or changed

### Requirement: Credential-store reader uses only absolute paths
The OpenCode credential-store reader used by the Jev plugin and by cli-five's auth detection SHALL consider a candidate path only when it is absolute. A relative candidate produced by an unset `XDG_DATA_HOME` SHALL be treated as "no credential" rather than resolved against the current working directory.

#### Scenario: Relative store candidate is ignored
- **WHEN** `XDG_DATA_HOME` is unset or empty and the fallback path construction yields a relative path
- **THEN** the candidate is skipped and the next absolute candidate is tried

#### Scenario: Absolute store candidate is read
- **WHEN** `XDG_DATA_HOME` is set to an absolute path that contains a valid `opencode/auth.json` with provider `opencode-go`
- **THEN** that credential is used

### Requirement: Re-running `add jev` preserves user-tuned plugin files
When the plugin files (`package.json`, `index.js`) already exist in the target directory, `add jev` SHALL skip copying them unless `--force` is passed. The `mergeBlock` steps for `opencode.json` and `AGENTS.md` remain idempotent as before.

#### Scenario: Re-run without `--force` leaves tuned files alone
- **WHEN** `add jev` runs and the plugin directory already contains user-edited `index.js` and `package.json`
- **THEN** those files are not overwritten, and the command reports them as skipped

#### Scenario: `--force` refreshes the plugin files
- **WHEN** `add jev --force` runs and the plugin files already exist
- **THEN** the files are replaced with the shipped templates
