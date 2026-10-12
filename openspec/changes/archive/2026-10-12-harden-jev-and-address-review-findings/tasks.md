# Tasks

## 1. Shared credential reader

- [x] 1.1 Create `src/util/opencode-auth.mjs` exporting `resolveOpencodeAuthCandidates(opts)` (returns only absolute candidate paths, honoring `OPENCODE_AUTH_FILE`, absolute `XDG_DATA_HOME`, and the home-dir fallback) and `extractOpencodeStoreKey(parsed)` (returns the `opencode-go` key or `null`). Verify with unit tests: relative `XDG_DATA_HOME` / relative `OPENCODE_AUTH_FILE` are ignored, absolute env paths are used, and missing/malformed files return empty candidates / `null`.
- [x] 1.2 Refactor `src/util/auth.mjs` `authFromFile` to use `resolveOpencodeAuthCandidates` and `extractOpencodeStoreKey` while preserving its existing behavior: it must still return an array of cli-five provider ids, still map `opencode`→Zen and `opencode-go`→Go through `AUTH_ID_TO_PROVIDER`, and still honor `OPENCODE_AUTH_FILE`. Verify `tests/auth.test.mjs` passes unchanged and a new test proves the relative-path case returns no providers.
- [x] 1.3 Add `templates/opencode/plugin/jev-tier-router/auth.mjs` as a vendored copy of `src/util/opencode-auth.mjs` (with a sync comment), and update `index.js` to import `./auth.mjs` and use `resolveOpencodeAuthCandidates` + `extractOpencodeStoreKey`. Verify the plugin's credential-resolution tests still pass.
- [x] 1.4 Update `src/addons/jev.mjs` to copy `auth.mjs` into the target plugin directory alongside `package.json` and `index.js`. Verify `runJev` writes three plugin files on first install and `tests/addons.test.mjs` / `tests/jev.test.mjs` are updated.

## 2. `add jev` hardening

- [x] 2.1 Change `runJev` signature to accept `args`, thread `dryRun` through directory creation, `cpSync`, and `mergeBlock`, and print planned actions using the README mapping `+ created`, `~ updated`, `= unchanged`, `. skipped`. Verify a new `tests/jev.test.mjs` case asserts `--dry-run` creates no files and prints the plugin files + merge actions.
- [x] 2.2 Add a clobber guard in `runJev`: skip copying `package.json`, `index.js`, and `auth.mjs` when the destination exists unless `args.force` is true; report skipped files. Verify tests show existing files are preserved on re-run and overwritten with `--force`.
- [x] 2.3 Wrap `mergeBlock` calls in `runJev` for `opencode.json` and `AGENTS.md` in try/catch; on error print a warning, set `process.exitCode = 1`, and continue. Verify a malformed `opencode.json` no longer throws and exits with a clear message.
- [x] 2.4 Remove the unused `written` array from `runJev` and any dead imports. Verify `npm run lint` is clean.

## 3. `add codegraph` and shared utilities

- [x] 3.1 Wrap `mergeBlock` calls in `runCodegraph` in try/catch matching `init`'s pattern, with a clear warning and non-zero exit on malformed targets. Verify a malformed `opencode.json` / `AGENTS.md` is handled without crashing.
- [x] 3.2 Remove dead exports `isCodegraphPresent` and `ensureFile` from `src/addons/codegraph.mjs` and update any callers/tests. Verify `npm run lint` passes and tests are green.
- [x] 3.3 Remove unused `isValidPlatform` from `src/util/platforms.mjs` and update any callers/tests. Verify no references remain.
- [x] 3.4 Harden `mergeBlock` in `src/util/merge.mjs` to detect a lone `START` fence and repair it by replacing from `START` to end-of-file with the new fenced block, instead of appending a second block. Verify unit tests cover lone-START repair, intact-pair replacement, and no duplication.
- [x] 3.5 Align `add codegraph`'s dry-run/status symbols with the README mapping (`+ created`, `~ updated`, `= unchanged`, `. skipped`). Verify `tests/addons.test.mjs` updated expectations and the README symbol table stay consistent.

## 4. CLI parser hardening

- [x] 4.1 Refactor `src/cli.mjs` `parse(argv)` to look ahead for value-taking flags (`--doc`, `--cost-mode`, `--target`, `--provider`, `--cwd`) and record a parse error when the value is missing or is another flag. Verify tests for each flag assert a clear error and no command execution.
- [x] 4.2 Add enum validation for `--cost-mode`, `--target`, and `--provider`; record a parse error listing accepted values for unknown inputs. Verify tests for invalid values assert the error lists the valid set.
- [x] 4.3 Update `run(args)` to check for parse errors, print the error plus help, and exit 2 before dispatching. Verify the missing-value cases for `init` and `add` produce exit code 2.

## 5. Jev session hooks opt-in default

- [x] 5.1 In `templates/opencode/plugin/jev-tier-router/index.js`, change `registerSessionHooks` to treat hooks as enabled only when `CLI_FIVE_JEVR_HOOKS=1` or `.opencode/jev.json` has `"hooks": true`; default off, with `CLI_FIVE_JEVR_HOOKS=0` still forcing off. Verify unit tests: default loads no hooks, env `1` registers hooks, file switch `true` registers hooks, opt-out `0` disables.
- [x] 5.2 Ensure the `tier_classifier` tool and `registerSpawnGate` still load when hooks are disabled by default. Verify tests assert tool registration and spawn-gate registration occur regardless of hook default.
- [x] 5.3 Update `src/addons/jev.mjs` `plannerInstruction()` and `JEVR_STATUS` to mention the opt-in hooks default. Verify the generated `AGENTS.md` fence and status string describe hooks as off by default.

## 6. Documentation fixes

- [x] 6.1 Fix the README Copilot cost-mode table (`README.md:317-323`) to match `COPILOT_COST_MODE_MAP` in `src/steps/scaffold.mjs`. Verify the Designer and Reviewer premium/mixed cells match the source.
- [x] 6.2 Correct `docs/BOOTSTRAP_AGENTIC_STACK_PROMPT.md:94-96` to state that session hooks fire under OpenChamber routing (per `README.md:238` / `decisions.md:31-35`). Verify no contradiction remains.
- [x] 6.3 Refresh `STATE.md`: remove the stale `chore/hardening-ci-and-docs` in-flight item and update recent decisions/next steps to reflect this hardening work.
- [x] 6.4 Update `CHANGELOG.md` `[Unreleased]` with the Jev opt-in default, dry-run fix, credential-reader fix, add-on error handling, CLI flag validation, and merge-block hardening.
- [x] 6.5 Update `docs/INSTALL_PROMPT.md`: bump the verified version from `0.2.25` to `0.2.32`, add the opt-in spawn-gate description, and adjust any stale wording.
- [x] 6.6 Rewrite the README session-hook default wording at `README.md:238` and `README.md:265` to describe the opt-in default (`CLI_FIVE_JEVR_HOOKS=1` or `.opencode/jev.json` to enable; default is off). Verify both passages no longer say hooks are on by default.
- [x] 6.7 Update `README.md:132` `--yes` flag description to state that it keeps existing files / uses the `create` policy (matching `src/steps/scaffold.mjs:42-43`), and document the `--yes` skill-discovery short-circuit (`README.md:359`).
- [x] 6.8 Condense README duplication: trim the jev section where it duplicates `decisions.md`/plugin constants, merge the two CodeGraph sections, and deduplicate the add-on list vs command list.
- [x] 6.9 Fix `decisions.md` stale line refs, resolve `AGENTS.md:15,18` "None declared" contradiction with `PROJECT.md:16-17`, populate or remove `PROJECT.md:33-37` placeholders, and correct `docs/general-revision-notes.md:5` + `docs/gsd-review.md:23` Copilot-only scope assertions.

## 7. Verification

- [x] 7.1 Run the full test suite: `npm test`. Verify all tests pass.
- [x] 7.2 Run lint: `npm run lint`. Verify no errors or warnings.
- [x] 7.3 Run a manual dry-run smoke test: `node bin/cli-five.mjs add jev --dry-run` in a temp OpenCode scaffold directory. Verify no files are written and the plan is printed.
- [x] 7.4 Confirm only expected files are changed: `git status` should list code, tests, and docs touched by this change plus the new change artifacts; no unrelated modifications.
- [x] 7.5 Run `openspec validate "harden-jev-and-address-review-findings" --type change` and `openspec status --change harden-jev-and-address-review-findings`. Verify the change is planning-complete.
