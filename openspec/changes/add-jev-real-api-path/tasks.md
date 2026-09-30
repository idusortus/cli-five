# Tasks

## 1. Credential resolution

- [x] 1.1 In `templates/opencode/plugin/jev-tier-router/index.js`, add `resolveJevCredential(opts)` returning `{ provider, key, model } | null`, resolving in order: `OPENCODE_API_KEY` → OpenCode credential store (`$XDG_DATA_HOME/opencode/auth.json`, else `~/.local/share/opencode/auth.json`, provider `opencode-go`) → `TYPESAFE_API_KEY`. Accept injectable `{ env, readFile }`. Verify: unit tests show the env var wins, the store is used when the env is silent, a missing/malformed/absent-provider store yields `null` rather than throwing, and a TypeSafe key is picked up only when no OpenCode credential exists.
- [x] 1.2 Select the model per provider (`jev-1.13-free` for OpenCode, `jev-1.13.0` for TypeSafe) with a documented `CLI_FIVE_JEVR_MODEL` override. Verify: unit tests assert each default and that the override replaces it.

## 2. Real-Jev classification

- [x] 2.1 Add an async remote classifier that POSTs `{ state, model, questions }` to the provider's `systemone` endpoint with `Authorization: Bearer <key>`, one bounded attempt (3000 ms via `AbortController`), and injectable `{ fetchImpl, timeoutMs }`. Verify: a unit test with a mocked `fetchImpl` returning the live-observed shape yields `tier` from the response with `source: 'jev_api'` and the API's `confidence`, and asserts the request body carries the task as `state`.
- [x] 2.2 Validate the response strictly: require `answers`, a `choice`-typed answer, a `choice` value within `{trivial,minor,major}`, and a numeric `confidence`; anything else counts as malformed. Verify: a unit test feeding a malformed, empty, or unexpected-shape body falls back rather than returning a bogus tier.
- [x] 2.3 Update `execute()` to select the path: no credential → `classifyTask()` exactly as today with **zero** `fetch` calls; credential → one remote attempt, and on 401 / 422 / 429 / 529 / network error / timeout / malformed response fall back to `classifyTask()` with `source: 'local_heuristic'` (never a bare `major`). Verify: unit tests for each failure mode assert the fallback result equals the local heuristic's output.
- [x] 2.4 Journal every skipped or failed remote path through the existing best-effort sink (`process.env.CLI_FIVE_LOGFILE || .opencode/journals/jev-tier-router.log`, `appendFileSync`, never throws), recording the failure kind and provider (never the key), and attach the "Jev is available…" hint as the optional diagnostic `note` on the fallback result. Verify: tests assert the note is present on the no-credential and failed-call paths, absent on success, and that `tier`/`confidence`/`available`/`source` are unaffected by it.
- [x] 2.5 Keep `classifyTask` and its exports (`__testables`) unchanged so the public contract and existing tests hold. Verify: the existing classifier tests in `tests/jev.test.mjs` pass unmodified.

## 3. Tool identity and comments

- [x] 3.1 Make the tool name `tier_classifier` (in `tools.add({ name })`) and rewrite the tool description so it no longer claims to be local-only and mentions the real-Jev path. Verify: a registration test asserts the added tool's name is `tier_classifier`.
- [x] 3.2 Rewrite the plugin's top-of-file TRUTHFUL NAMING header (the `local_tier_heuristic` / "does NOT call Jev" / "jev-harness's `route`" block) and the hard-coded `local_tier_heuristic fail-open:` journal prefix, so both reflect `tier_classifier` and the credential-gated real-Jev path. Verify: a grep for `local_tier_heuristic` and `jev-harness` across the plugin returns no matches (the migration window lives in an un-re-run target's `AGENTS.md`, not the plugin), and the failure-path test still writes a log line.
- [x] 3.3 Rewrite the `JEVR_SWAP_POINT` comment to describe the System One wiring that exists (both endpoints, the credential sources, the default models, the doc sources and date). Verify: the comment names the OpenCode Zen and TypeSafe endpoints and the credential sources, and contains no `jev-harness` plan text.

## 4. Scaffold wiring and status

- [x] 4.1 In `src/addons/jev.mjs`, rename `JEVR_TOOL` to `tier_classifier` and update `plannerInstruction()` so it describes the classifier as optional (real Jev when a credential is available, local heuristic otherwise), notes that Jev is available/free on OpenCode, and preserves the `confidence >= 0.6 → trust tier, else default major` semantics and the never-block clause. Verify: `tests/jev.test.mjs`'s `runJev` test asserts the new tool name appears in the generated `AGENTS.md` fence, that the fence no longer claims local-only, and that it regenerates idempotently.
- [x] 4.2 Update `JEVR_STATUS` and the `registry.mjs` jev entry so `status`/`description` describe both operational states (real Jev when a credential resolves; local heuristic otherwise) while still naming the parked test-gate and `TEST_GATE_ISSUE`. Verify: `tests/addons.test.mjs` status assertions are updated accordingly and pass.

## 5. Test coverage

- [x] 5.1 Add a real-path success test with a mocked HTTP layer asserting `source: 'jev_api'`, the API's `choice` as `tier`, and its `confidence` surfaced unchanged, using the exact response shape captured from the live OpenCode endpoint. Verify: the test fails against a stub that omits `source` and passes against the implementation.
- [x] 5.2 Add fail-open tests for each failure mode — 401, 422, 429, 529, timeout, network error, and malformed response — each asserting the local heuristic's `tier`/`confidence` with `source: 'local_heuristic'` and a diagnostic note. Verify: each mode has its own case and all pass.
- [x] 5.3 Add a no-credential test asserting the result is identical to the pre-change local output (modulo the additive note) and that no `fetch` call occurs. Verify: the `fetch` spy records zero invocations.
- [x] 5.4 Add a request-sanity test asserting exactly the keys `trivial`, `minor`, `major` with non-empty intent-matching descriptions, the task description sent as `state`, and the provider's default `model`. Verify: the test asserts the three keys and the default model string.
- [x] 5.5 Update existing tests touched by the rename (tool name, status regexes) and run the whole suite. Verify: `npm test` is green and `npm run lint` is clean.

## 6. Documentation

- [x] 6.1 Rewrite the README jev section to describe the optional real-Jev path: the OpenCode Zen endpoint and that it works with the credential the user already has (`OPENCODE_API_KEY` or the stored `opencode-go` credential) and is free; the TypeSafe provider and `TYPESAFE_API_KEY`; the `CLI_FIVE_JEVR_MODEL` override; and the fail-open local fallback. It MUST explicitly replace the now-false statements: the `local_tier_heuristic` tool name, the "**It does not call Jev.** … jev-harness 0.2.0's `route` …" framing, the sample status line `local heuristic — …`, and the "returns `available: false` with tier `major`" description of an ordinary failure. Verify: the section names how to enable the real path and what happens without a credential, and no stale claims remain.

## 7. Verification and honest reporting

- [x] 7.1 Sandbox-verify the **no-credential** path end to end on a freshly scaffolded artifact: run `cli-five add jev` into a temp dir, then call the shipped `.opencode/plugin/jev-tier-router/index.js` with no credential and a throwing `fetchImpl`. Verify: the result is `source: 'local_heuristic'` with the availability note, and `fetch` is never called. (Route-level agent-turn execution was not used for this half: a credential-less server run cannot serve its own model call. The live path was route-verified in 7.2 instead.)
- [x] 7.2 Live-verify the OpenCode path end to end using the environment's stored `opencode-go` credential, both directly through the shipped plugin and route-level via `opencode run --standalone`, where the agent called `tier_classifier` and it returned `source: 'jev_api'`. Verify: the completion report states explicitly which path was live-exercised and which was not — TypeSafe remains contract-verified only (no `TYPESAFE_API_KEY` present), never live.
- [x] 7.3 Confirm no forbidden file changed. Verify: `git diff --name-only` / `git status` list only `src/addons/jev.mjs`, `templates/opencode/plugin/jev-tier-router/index.js`, `src/addons/registry.mjs`, `README.md`, `tests/jev.test.mjs`, `tests/addons.test.mjs`, the change's own files, and the project-memory `decisions.md` — with `codegraph.mjs`, `openspec.mjs`, and the test-gate untouched.
- [x] 7.4 Leave all changes staged for review. Verify: nothing is committed or pushed (`git log` unchanged at `83230d1`, `git status` shows staged work only).
