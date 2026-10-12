# Design

## Context

See `proposal.md` for the review findings and the user-confirmed decision to keep Jev inside cli-five and make it runtime opt-in. This change is a hardening pass across the Jev add-on, shared utilities, CLI parsing, and project documentation. The relevant current state:

- `src/addons/jev.mjs` ignores the `args` parameter and always writes files; its `mergeBlock` calls are unguarded.
- `src/util/auth.mjs:51` builds a relative `opencode/auth.json` when `XDG_DATA_HOME` is unset, and `.filter(Boolean)` keeps it.
- `templates/opencode/plugin/jev-tier-router/index.js` handles the unset-`XDG_DATA_HOME` fallback to `~/.local/share/opencode/auth.json`, but it does not validate that a non-empty `XDG_DATA_HOME` is absolute, so the two readers have drifted and the absolute-path gap must be closed in a shared helper.
- `src/addons/codegraph-command.mjs` and `src/addons/jev.mjs` surface raw `mergeBlock` errors; `src/steps/scaffold.mjs:96-99,162-166` catches and warns the same condition.
- `src/cli.mjs:110-114` reads `argv[++i]` for value-taking flags without validation.
- `src/util/merge.mjs:117` replaces an existing START/END pair, but a lone START fence falls through to append.
- The session-hook path in `index.js` currently registers unless `CLI_FIVE_JEVR_HOOKS=0`; the user wants the inverse default.

## Goals / Non-Goals

**Goals:**

- Make `add jev` safe to preview and re-run without clobbering user edits.
- Eliminate the repo-local credential-file risk and keep the plugin and CLI readers aligned.
- Make add-on errors consistent with `init`'s fail-open handling.
- Make the CLI parser reject missing/invalid flag values clearly.
- Harden `mergeBlock` against a common malformed-fence case.
- Flip the session-hook default to off while preserving the tool and spawn gate.
- Bring docs in line with the shipped code.

**Non-Goals:**

- **No extraction of Jev into a separate package.** The fix for the "does too much" concern is the runtime opt-in default; extraction is recorded as a future option only.
- No change to the `tier_classifier` result contract, the real-Jev criteria/models/timeout, or the fail-open behavior.
- No change to the spawn gate's default state (`off`) or its logic beyond documentation.
- No new npm dependency.
- No full rewrite of the CLI parser; keep the existing hand-rolled parser, just add validation.

## Decisions

### D1 — Keep Jev inside cli-five; default the hooks off
The user confirmed the integration stays in this package. The concrete default change is that `registerSessionHooks` treats hooks as disabled unless explicitly enabled. The `tier_classifier` tool and the opt-in spawn gate remain unchanged.

*Why not extract:* the user stated Jev has shown promising results and the install path `cli-five add jev` should remain. Extraction is deferred to a future decision.

### D2 — `add jev --dry-run` threads `args.dryRun` through every write
`runJev({ cwd, args = {} })` will pass `dryRun: Boolean(args.dryRun)` to all file-system operations: directory creation, `cpSync`, and both `mergeBlock` calls. In dry-run mode the function will compute the plan, print each intended action using the README's documented symbol mapping (`+ created`, `~ updated`, `= unchanged`, `. skipped`), and return without writing.

`add codegraph` currently maps `created`/`updated` to `+` and `unchanged` to `~`, which contradicts the README. This change aligns `add codegraph`'s output to the same `+ created, ~ updated, = unchanged, . skipped` mapping.

*Why not write a separate preview path:* reusing the real write path with `dryRun: true` guarantees the preview and the real run are identical.

### D3 — Share one absolute credential-store reader
Create a new shared source module `src/util/opencode-auth.mjs` that exports two small, pure helpers:

- `resolveOpencodeAuthCandidates(opts)` — returns an ordered array of **absolute** candidate file paths to probe. It honors `OPENCODE_AUTH_FILE` when absolute, uses `XDG_DATA_HOME` only when it resolves to an absolute path, and falls back to `~/.local/share/opencode/auth.json`. Relative candidates are filtered out.
- `extractOpencodeStoreKey(parsed)` — safely reads the `opencode-go` key from either the top-level or `providers` shape of a parsed `auth.json`, returning the key string or `null`.

`src/util/auth.mjs` will import both helpers. `authFromFile` will use `resolveOpencodeAuthCandidates` to enumerate paths, read/parse each file, map any discovered providers through the existing `AUTH_ID_TO_PROVIDER` table (preserving the `opencode`→Zen and `opencode-go`→Go mappings), and continue to return an array of cli-five provider ids. This preserves the existing return contract, `OPENCODE_AUTH_FILE` support, and provider mapping, and keeps `tests/auth.test.mjs` green.

The plugin template will receive a vendored copy of the same helpers in `templates/opencode/plugin/jev-tier-router/auth.mjs`; `index.js` will import `./auth.mjs` and use `resolveOpencodeAuthCandidates` plus `extractOpencodeStoreKey` to resolve its bearer key. `src/addons/jev.mjs` will copy `auth.mjs` into the target plugin directory alongside `package.json` and `index.js`.

*Why a copied source module rather than a runtime dependency:* the plugin runs inside the target repo and cannot import from cli-five. Keeping the canonical source in `src/util/opencode-auth.mjs` and copying it into the plugin preserves a single source of truth while keeping the plugin dependency-free.

*Alternatives considered:* importing the plugin's reader into cli-five (rejected — the plugin is a copied template, not a package); duplicating logic (rejected — the two readers already drifted); importing from a published package (rejected — no new dependency).

### D4 — Re-run preserves existing plugin files unless `--force`
`runJev` will skip copying `package.json`, `index.js`, and `auth.mjs` when the destination already exists and `args.force` is false. It will report those files as `skipped`. With `--force`, the templates are copied over.

*Why not a version marker:* a simple existence guard matches the README's framing of the plugin files as user-owned after install. A marker would add complexity without a strong benefit; `--force` provides an escape hatch.

### D5 — Add-ons catch `mergeBlock` errors like `init` does
Both `runCodegraph` and `runJev` will wrap each `mergeBlock` call in a try/catch. On error they will:
- Print a `log.warn` naming the file and the error.
- Print `log.dim('Fix the file, then re-run ...')`.
- Set `process.exitCode = 1`.
- Continue (where possible) so other add-on work is not lost.

*Why not a shared wrapper:* the call sites differ slightly (JSON vs Markdown, dry-run options); a local try/catch per call is clearer.

### D6 — CLI parser validates value-taking flags
`parse(argv)` will be updated so that flags requiring a value look ahead and validate:
- If the next token is missing or starts with `-`, record a parse error with a clear message (`--doc requires a value`).
- For `--cost-mode`, `--target`, and `--provider`, also validate the value against the supported set and record an error with the accepted values.

`run(args)` will check for a parse error, print it (and the help text), and exit with code 2 before dispatching the command.

*Why not use a parser library:* the project intentionally has no CLI framework dependencies and the parser is small. Adding validation inside the existing loop is the minimal change.

### D7 — `mergeBlock` handles a lone START fence
`mergeText` will first check for a lone `START` fence (the marker exists but the `END` marker does not). When found, it will replace from `START` through the end of the file with the new fenced block, repairing the file. Only when neither fence exists will it append.

*Why repair instead of error:* add-ons are meant to converge user files; a manually damaged fence is best fixed idempotently.

### D8 — Session hooks opt-in via env and file switch
The default changes from "register unless `CLI_FIVE_JEVR_HOOKS=0`" to "register only when `CLI_FIVE_JEVR_HOOKS=1` or `.opencode/jev.json` has `"hooks": true`. The precedence is:
1. `CLI_FIVE_JEVR_HOOKS=0` → disabled (env override).
2. `CLI_FIVE_JEVR_HOOKS=1` → enabled.
3. `.opencode/jev.json` `"hooks": true` → enabled (for environments where env does not reach the server).
4. Otherwise → disabled.

The `registerSessionHooks` boundary remains fail-open: if the host lacks the hook surface, the plugin loads normally and the tool path is unaffected.

*Why add a file switch:* under OpenChamber routing the long-lived server does not inherit the client's env, so a project file is the only reliable toggle.

## Risks / Trade-offs

- **Plugin file-count increase:** adding `auth.mjs` to the plugin means `add jev` copies three files instead of two. Mitigation: the file is small, dependency-free, and hidden from the user.
- **`--force` can still overwrite tuned files.** Mitigation: this is intentional; `--force` is documented as the destructive reset path.
- **Shared auth module copied from cli-five to plugin can drift if edited in only one place.** Mitigation: keep the canonical source in `src/util/opencode-auth.mjs` and add a header comment in both copies stating they must stay in sync; tests assert both produce the same result for the same inputs.
- **New file switch adds a public convention.** Mitigation: document it in README and keep it backward-compatible — the old opt-out env value still works.
- **Dry-run output may differ if `mergeBlock` action depends on file contents that would have been written earlier in the same run.** Mitigation: dry-run still reads existing files; it only skips writes, so computed actions are accurate.
- **Lone-fence repair could accidentally consume content the user intended to keep after a stray `<!-- FOO_START -->`.** Mitigation: this is strictly better than duplicating the block; the behavior is documented and the repair is idempotent.

## Migration Plan

No data migration. After release:
- Existing Jev installs keep the old default (hooks on) until the user re-runs `npx cli-five add jev`, which refreshes the plugin files and the `AGENTS.md` fence. Re-running without `--force` preserves tuned `index.js`/`auth.mjs`.
- Users who want the old default can set `CLI_FIVE_JEVR_HOOKS=1` or add `"hooks": true` to `.opencode/jev.json`.
- Rollback is a revert; re-running `add jev` from the previous version restores the prior plugin and instruction.

## Open Questions

- Should the shared `auth.mjs` plugin file be copied with `--force` even when the user has tuned it? The decision above says yes; confirm this is acceptable versus preserving it as a "system" file.
