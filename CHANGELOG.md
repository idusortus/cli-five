# Changelog

Notable changes to `cli-five`. The publish workflow bumps the patch version on every merge
to `main`, so entries here are grouped by feature rather than by every patch number.

## [Unreleased]

### Added

- **Jev session hooks are now opt-in.** The V2 session-hook path (classify at admission,
  inject the tier as a system instruction) is **off by default**; enable it with
  `CLI_FIVE_JEVR_HOOKS=1` or `"hooks": true` in `.opencode/jev.json`. `CLI_FIVE_JEVR_HOOKS=0`
  stays a valid opt-out. The `tier_classifier` tool and the opt-in Reviewer-spawn gate are
  unchanged.
- **`add jev --dry-run`** prints the planned plugin files and merges and writes nothing.
- **`add jev --force`** overwrites the shipped plugin files; without it, a re-run preserves
  existing `package.json` / `index.js` / `auth.mjs` so local tuning survives.

### Changed

- **CLI flag validation:** value-taking flags (`--doc`, `--cost-mode`, `--target`, `--provider`,
  `--cwd`) now error and exit 2 when their value is missing or is another flag; `--cost-mode`,
  `--target`, and `--provider` also reject unknown values and list the accepted set.
- **Add-on errors** in `add codegraph` and `add jev` now warn and continue with a non-zero exit
  on a malformed `opencode.json` / `AGENTS.md`, matching `init`'s fail-open handling.

### Fixed

- **Credential-store reader** now considers only **absolute** candidate paths (an absolute
  `OPENCODE_AUTH_FILE` / `XDG_DATA_HOME`, else `~/.local/share/opencode/auth.json`), so an
  unset `XDG_DATA_HOME` can no longer resolve to a repo-local `opencode/auth.json`. The reader
  is shared with the Jev plugin via a vendored `auth.mjs`.
- **`mergeBlock`** repairs a file that has a lone `<!-- NAME_START -->` fence with no matching
  END by replacing from the fence to end-of-file instead of appending a duplicate block.

## 0.2.32

### Added

- **CI test gate** (`.github/workflows/ci.yml`): lint + tests on Node 20/22/24 for every PR
  and push to `main`. The publish workflow runs the same gate before releasing.
- **ESLint 10** flat config with node globals, `no-undef`, and a focused correctness
  ruleset, plus an `npm run lint` script.
- `CHANGELOG.md`.

### Changed

- `init --yes` now keeps existing files (only missing files are written) and never prompts;
  `--force` remains the explicit overwrite path.
- OpenCode next-steps only mention CodeGraph when it is actually enabled.
- Stack → instruction matching uses stable detected stack ids instead of label strings.
- Skill detection also scans `.opencode/skills`.
- Fatal CLI errors print a concise message; the full stack is behind `CLI_FIVE_DEBUG=1`.
- `plugin.json` version is kept in sync with `package.json` by the publish workflow.
- Shared `readJsonFile` replaces two duplicated JSON readers; `merge.mjs`'s JSON parsing was
  factored into a shared `readJsonObject` (it must throw on malformed JSON, unlike
  `readJsonFile`, which returns `null`).

### Fixed

- `init` is now idempotent and non-destructive: user-owned files are create-once, managed
  files converge on a byte compare, and `opencode.json` is merged (add-only) rather than
  replaced. A malformed `opencode.json` is skipped with a warning during `init` (including
  the CodeGraph registration path) instead of crashing mid-scaffold; `add codegraph` on a
  malformed file exits with a clear error.
- `--dry-run` no longer runs `git init`.
- Fixed a latent `ReferenceError` in the interactive OpenCode provider picker (missing
  `PROVIDER_GO` import), surfaced by enabling `no-undef`.

## Earlier

- `openspec` add-on (`npx cli-five add openspec`) plus a `bootstrap-agentic-stack` skill and
  install prompt.
- `codegraph` and `jev` add-ons; OpenCode + Copilot dual-platform scaffolding.
- npm Trusted Publishing (OIDC) with version-conflict detection.
