# Changelog

Notable changes to `cli-five`. The publish workflow bumps the patch version on every merge
to `main`, so entries here are grouped by feature rather than by every patch number.

## [Unreleased]

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
- Shared `readJsonFile` utility replaces two duplicated JSON readers (plus the inline
  copies in `merge.mjs`).

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
