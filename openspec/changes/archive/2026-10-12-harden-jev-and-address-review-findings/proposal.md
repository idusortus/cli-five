# Proposal

## Why

A review of `cli-five` at `820d852` surfaced a cluster of P0/P1 code defects and documentation drift concentrated around the Jev integration, credential handling, CLI parsing, and add-on error handling — plus a product decision that Jev should be **runtime opt-in** rather than on by default. Rather than splitting these into separate changes, this proposal captures one coordinated hardening pass that fixes the bugs, aligns the docs, and flips the session-hook default while keeping the current single-package install path.

## What Changes

### Code

- **Fix `add jev --dry-run`.** `src/addons/jev.mjs` currently drops the `args` parameter and writes files unconditionally. It will accept `args.dryRun`, print the intended actions, and write nothing under `--dry-run`.
- **Fix the credential-store reader in `src/util/auth.mjs`.** When `XDG_DATA_HOME` is unset it currently builds a relative `opencode/auth.json` path that can resolve to a repo-local file. Only **absolute** candidates will be considered, and the logic will be shared with (or aligned to) the plugin's reader in `templates/opencode/plugin/jev-tier-router/index.js`.
- **Stop `add jev` re-runs from clobbering user-tuned plugin files.** `src/addons/jev.mjs:39-44` currently `cpSync`s over `package.json`/`index.js` with no guard. Re-runs will skip copying when the destination already exists unless `--force` is passed (or a version-marker check determines the file is safe to refresh).
- **Make `mergeBlock` error handling consistent across add-ons.** `add codegraph` and `add jev` surface raw `mergeBlock` throws on malformed `opencode.json` / `AGENTS.md`, while `init` catches and warns the same condition. Both add-ons will catch merge errors, print a clear message, and continue without crashing.
- **Validate CLI flag values.** `src/cli.mjs` reads `argv[++i]` for `--doc`, `--cost-mode`, `--target`, `--provider`, and `--cwd` without checking whether a value follows. The parser will detect a missing value and fail with a clear message (or help).
- **Remove dead code:** `isCodegraphPresent`, `ensureFile` in `src/addons/codegraph.mjs`, `isValidPlatform` in `src/util/platforms.mjs`, and the unused `written` array in `src/addons/jev.mjs`.
- **Harden `mergeBlock` against duplication.** When an existing file contains only a `<!-- NAME_START -->` fence and no matching `END`, `mergeBlock` can append a second block. It will handle a lone START fence safely.
- **Flip Jev session hooks to runtime opt-in.** The V2 session hooks currently fire by default (`CLI_FIVE_JEVR_HOOKS` implicitly on). They will default to **OFF** so no Jev classification/injection/network call happens until the user enables it via `CLI_FIVE_JEVR_HOOKS=1` and/or the existing `.opencode/jev.json` switch. The `tier_classifier` tool and the opt-in spawn gate are preserved unchanged.
- **Update and add tests**, including a `runJev` `--dry-run` test and coverage for the opt-in default.

### Docs

- Fix the README Copilot cost-mode table (`README.md:317-323`) to match `COPILOT_COST_MODE_MAP`.
- Correct `docs/BOOTSTRAP_AGENTIC_STACK_PROMPT.md:94-96` to reflect that session hooks *do* fire under OpenChamber routing (per `README.md:238` / `decisions.md:31-35`).
- Refresh stale `STATE.md` and `[Unreleased]` `CHANGELOG.md` entries, adding Jev work.
- Update `docs/INSTALL_PROMPT.md` version pin and add the shipped opt-in spawn gate.
- Clarify README idempotency wording around `--yes`, document the `--yes` skill-discovery short-circuit, and condense duplicated Jev/CodeGraph/add-on sections.
- Fix `decisions.md` stale line refs, `AGENTS.md`/`PROJECT.md` contradictions/placeholders, and `docs/general-revision-notes.md` + `docs/gsd-review.md` Copilot-only scope assertions.

### Out of Scope (explicitly unchanged)

- **No extraction of Jev into a separate package.** The user-confirmed fix for the "does too much" concern is the runtime opt-in default; extraction remains a future option and is recorded as a non-goal in `design.md`.
- No change to the `tier_classifier` result contract, criteria, models, timeout, or fail-open behavior.
- No change to the opt-in spawn gate logic; only its default state and documentation are touched.
- No new npm dependency.

## Capabilities

### Modified Capabilities

- `jev-tier-routing`: add `--dry-run` support for `add jev`; require the credential-store reader to consider only absolute paths and to stay aligned with the plugin's reader; preserve user edits to shipped plugin files on re-run unless `--force`. (Because `openspec/specs/` is still empty, the delta is written as ADDED requirements under this capability path.)
- `jev-session-routing`: change the session-hook default from **on** to **off**; require runtime opt-in via `CLI_FIVE_JEVR_HOOKS=1` and/or the existing `.opencode/jev.json` switch while keeping the `tier_classifier` tool and spawn gate as-is. (Because `openspec/specs/` is still empty, the delta is written as ADDED requirements under this capability path.)

### New Capabilities

- `cli-flag-validation`: the CLI parser validates values for flags that require an argument and fails with a clear error when one is missing.
- `addon-error-handling`: `add codegraph` and `add jev` catch `mergeBlock` failures and report them the same way `init` does, instead of crashing.
- `merge-block-dedup`: `mergeBlock` does not duplicate a fenced block when an existing file contains only a START fence.
- `auth-credential-reader`: cli-five's provider-auth detection uses only absolute credential-store paths and shares one reader implementation with the Jev plugin to prevent drift.

## Impact

**Code:** `src/addons/jev.mjs`, `src/addons/codegraph-command.mjs`, `src/addons/codegraph.mjs`, `src/util/auth.mjs`, `src/util/opencode-auth.mjs`, `src/util/platforms.mjs`, `src/util/merge.mjs`, `src/cli.mjs`, `templates/opencode/plugin/jev-tier-router/index.js`, `templates/opencode/plugin/jev-tier-router/auth.mjs`, `tests/jev.test.mjs`, `tests/addons.test.mjs`, `tests/auth.test.mjs`, and possibly new test files.

**Docs:** `README.md`, `STATE.md`, `CHANGELOG.md`, `AGENTS.md`, `PROJECT.md`, `decisions.md`, `docs/BOOTSTRAP_AGENTIC_STACK_PROMPT.md`, `docs/INSTALL_PROMPT.md`, `docs/general-revision-notes.md`, `docs/gsd-review.md`.

**Behavior:** `add jev --dry-run` becomes safe; re-running `add jev` no longer overwrites tuned plugin files; malformed target files no longer crash add-ons; missing flag values produce actionable errors; Jev session hooks are off by default.

**Verification:** the existing test suite must remain green, with new tests for `--dry-run`, the opt-in default, the clobber guard, missing flag values, and lone-fence deduplication.
