# Design

## Context

See `proposal.md` for motivation. Relevant current state:

- `templates/opencode/plugin/jev-tier-router/index.js` ships a **pure, synchronous** `classifyTask(description)` (regex/keyword `SIGNALS`, `CONFIDENCE_CUTOFF = 0.6`, `FALLBACK_TIER = 'major'`) and a default export whose `setup(ctx)` registers one tool via `ctx.tool.transform((tools) => tools.add({...}))`. The tool's `execute()` calls `classifyTask` and returns `JSON.stringify(result)`. `classifyTask` is consumed by `tests/jev.test.mjs` and is the documented public contract.
- `src/addons/jev.mjs` copies that template into `<cwd>/.opencode/plugin/jev-tier-router/`, registers the path in `opencode.json`, and merges a Planner instruction into `AGENTS.md` under the `JEV_TIER_ROUTING` fence. `runJev` refuses on non-OpenCode targets.
- `src/addons/registry.mjs` reports the add-on's `status` from `JEVR_STATUS` in `jev.mjs`.
- The plugin is a **user-owned file copied into the target repo**, not an npm package the user depends on, so it must stay dependency-free.

**Investigation findings (docs + live probes, no guessing):**

1. **Jev is available through the user's OpenCode credential.** `https://docs.opencode.ai`-hosted V2 console docs list it in the model table: `Jev 1.13` → `jev-1.13`, endpoint `https://opencode.ai/zen/v1/systemone` (source: `https://opencode.ai/v2/docs/console/models/`). The same page's Jev section says: use your OpenCode Console API key with the `systemone` endpoint, and "Use `jev-1.13-free` instead of `jev-1.13` to use the limited-time free model."
2. **Documented auth env var:** `OPENCODE_API_KEY`, sent as `Authorization: Bearer $OPENCODE_API_KEY` (same page's curl example).
3. **The env var is not always present.** In this environment neither OpenCode server process has `OPENCODE_API_KEY` in its environment; the key lives in the credential store at `~/.local/share/opencode/auth.json` under provider `opencode-go` (verified by reading the file and `opencode auth list`, which reports "OpenCode Go … stored"). OpenCode is **v2.0.17**.
4. **TypeSafe direct still stands as a secondary provider:** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <TYPESAFE_API_KEY>` (`https://docs.typesafe.ai/sdk/javascript.md`), versioned IDs such as `jev-1.13.0` accepted in `model` (`https://docs.typesafe.ai/models.md`). Request/response shapes are identical to Zen's.
5. **Live-exercised at the API level.** One direct `systemone` call against the stored OpenCode Go credential returned HTTP 200 (route-level end-to-end execution of the shipped plugin through the Planner is still **pending** tasks 7.1/7.2, not claimed here):
   ```json
   {"model":"jev-1.13-free",
    "answers":{"tier":{"type":"choice","choice":"trivial","confidence":1,
                       "probabilities":{"trivial":1,"minor":0,"major":0}}},
    "usage":{"input_tokens":386,"output_tokens":40}}
   ```
   So the OpenCode path is not merely contract-verified — it works today, with the exact `choice` question shape and criteria this design proposes.

## Goals / Non-Goals

**Goals:**

- An optional real-Jev path that works with the credential a `/connect` OpenCode user already has, without asking them for a second account.
- Byte-identical behavior to today when no credential resolves.
- A consumer-facing result contract that survives untouched, so the injected Planner instruction's threshold logic needs no change.
- Truthful artifacts: comments, status strings, naming, README, and the verification claim all match what was actually built and checked.

**Non-Goals:**

- No retry/backoff, caching, batching/speculative fan-out, streaming, or per-agent model overrides.
- No npm SDK dependency (`@typesafe-ai/sdk`) — the plugin must remain dependency-free as a copied file.
- No OpenCode plugin-API credential path (`ctx.integration` / `ctx.provider`) in this round — see D9.
- No change to the test-gate, `codegraph.mjs`, `openspec.mjs`, or their registry entries.
- No Copilot path (still refused).

## Decisions

### D1 — Two HTTP providers, OpenCode Zen first, built-in `fetch`, no SDK
Call `POST https://opencode.ai/zen/v1/systemone` with `Authorization: Bearer <credential>`; fall back to `POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY` when no OpenCode credential resolves.
*Why:* the OpenCode path needs no new account and is free on the `jev-1.13-free` model, which is exactly the "Jev is included for free in OpenCode" case; TypeSafe remains available for users who have that key instead. The plugin is copied into user repos with no install step, so `fetch` (available in the runtime OpenCode ships) beats adding `@typesafe-ai/sdk`, which would also impose its own retry policy.
*Alternatives:* SDK (rejected: dependency + implicit retries); TypeSafe-only (rejected: fails the user's actual setup); shelling out to a CLI (rejected: the whole point of the correction — no such interface exists).

### D2 — A single `choice` question, three options
Pose one question with `criteria: { trivial, minor, major }` and read `choice` + `confidence`.
*Why:* Choice maps 1:1 onto the tier vocabulary and returns an explicit label plus a calibrated confidence directly comparable to the existing `0.6` cutoff. The live probe confirmed this exact shape works on the OpenCode endpoint. Score would need an invented float mapping; three Noul questions would need post-hoc combination.
*Criteria wording:* derived from the existing `SIGNALS` section comments and keyword intent — `trivial` = mechanical / no-reasoning; `minor` = bounded / local / incremental; `major` = architectural / cross-cutting / ambiguous. No unrelated concerns.

### D3 — Provider-specific default models, with an override
OpenCode path defaults to `jev-1.13-free`; TypeSafe path defaults to `jev-1.13.0`. A documented environment override (e.g. `CLI_FIVE_JEVR_MODEL`) replaces the default for whichever provider is selected.
*Why:* versioned IDs keep behavior reproducible versus a floating alias, and the OpenCode free tier is explicitly **limited-time**, so a no-code-change override is warranted here in a way it was not for the fixed timeout. `jev-1.13-free` also reports itself in the response `model` field, which the tool can log.
*Alternatives:* default to paid `jev-1.13` (rejected: silently spends the user's credits); hardcode with no override (rejected: the free tier can disappear).

### D4 — Exactly one attempt, 3000 ms timeout, no retry
*Why 3000 ms:* the request sends a small `state` (the task description) and one question, so a healthy call returns well under a second (the live probe completed comfortably inside the budget); 3 s absorbs TLS handshake, queueing, and inference jitter while capping added Planner-turn latency. 1500 ms risks false fallbacks on a first-call handshake; a 10 s ceiling would let a stalled turn look broken.
*Why no retry:* the docs recommend exponential backoff for 429/529, but this runs inside a Planner's tool call. A retry converts a fast, well-understood fallback into a new failure mode — a stalled turn — for no reliability gain, since a better answer already exists locally.

### D5 — Fall back to `classifyTask()`, not to a bare `major`
API failures return the **local heuristic's** result (`source: local_heuristic`). `classifyTask` already works and is strictly more informative than a synthetic tier. The existing `execute()` catch-all remains the outermost net for truly unexpected errors (returning `available: false`), giving two layers: any API failure → local heuristic; unexpected local failure → fail-open `available: false`.

### D6 — Rename the tool `local_tier_heuristic` → `tier_classifier`
*Why:* the shipped name asserts a local-only implementation, which becomes false once a credential resolves. `source` (`jev_api` vs `local_heuristic`) carries the runtime truth.
*Alternatives:* keep the old name (rejected — inaccurate by design, and the instruction text around it must change anyway); name it after Jev (rejected — overclaims Jev when the local path answers).
*Migration:* `add jev` is idempotent — the plugin file is overwritten and the `AGENTS.md` fence regenerated by `mergeBlock` — so re-running `npx cli-five add jev` converges a scaffold. A scaffold that is never re-run keeps an `AGENTS.md` naming the old tool; the Planner's call then fails and the instruction's fail-open clause (use own judgment, default `major`) applies.

### D7 — Structure: keep `classifyTask` pure and sync; add async credential + remote seams
`classifyTask` and its exports stay exactly as they are (tests and the public contract depend on them). Add:
- `resolveJevCredential(opts)` → `{ provider, key, model } | null`, with the env var winning over the store, and fully defensive reads;
- an async `classifyTaskWithJev(description, opts)` returning a normalized result or `null`;
- an async wrapper used by `execute()` that tries the remote path when a credential resolves and otherwise calls `classifyTask`.
All three accept injectable options (`{ fetchImpl, env, readFile, timeoutMs, model }` defaulting to real globals) so tests can drive mocked HTTP and a mocked credential store without touching the network or the real `auth.json`.

### D8 — Response validation is strict, and failures are journaled with a hint
Require `answers`, a `choice`-typed answer, a `choice` value within `{trivial,minor,major}`, and a numeric `confidence`; anything else is malformed → local fallback. Failures are appended to the existing best-effort journal (`process.env.CLI_FIVE_LOGFILE || .opencode/journals/jev-tier-router.log`) and never throw.
*Why:* the endpoint is documented to return exactly this shape, but a version bump could shift it; treating "unrecognized" as malformed keeps the failure mode safe.

### D9 — Credential source: env var, then the OpenCode auth store (not the plugin API)
Resolve in order: `OPENCODE_API_KEY` → `$XDG_DATA_HOME/opencode/auth.json` → `~/.local/share/opencode/auth.json`, reading `providers['opencode-go'].key` (also tolerating a top-level `['opencode-go'].key` shape), then a TypeSafe key from `TYPESAFE_API_KEY`.
*Why:* verified that a `/connect` user has **no** `OPENCODE_API_KEY` in the server environment, so env-only would not work for the exact setup the user wants to try; the store is where the key actually is.
*Trade-off:* the store file is OpenCode's private, undocumented format, so this is a deliberate coupling — mitigated by reading it defensively (any missing/malformed/absent-provider case degrades to "no credential", never an error) and by preferring the documented env var when present.
*Alternative considered:* the V2 plugin-native `ctx.integration.connection.active('opencode-go')` + `resolve()` path. It is architecturally cleaner, but whether it exposes *provider* keys in v2.0.17 is unverified, and probing it needs a test plugin loaded into the running server. Deferred, not rejected — recorded as an open question.

### D10 — Keep the plugin dependency-free
Only `node:fs` and `node:path` plus global `fetch`. No new npm dependency; `package.json` for the plugin is unchanged.

## Risks / Trade-offs

- **OpenCode auth store is private and may move** → Prefer the documented env var; parse defensively; treat every failure as "no credential"; document the coupling in the swap-point comment so a future reader re-checks.
- **The free model is explicitly limited-time** → `jev-1.13-free` is the default but is overridable via a documented env var; the README says the tier is temporary.
- **Added Planner-turn latency** → single attempt capped at 3 s, then local fallback.
- **Answer drift** → versioned model IDs rather than floating aliases.
- **Cost** → OpenCode default is the free model; TypeSafe is only used when the user supplies that key, and the README states the paid caveat.
- **Rename window on stale scaffolds** → mitigation in D6.
- **TypeSafe path is contract-verified only** (no `TYPESAFE_API_KEY` here) → it shares the exact request/response code path that IS live-exercised at the API level against Zen, and the report must say so rather than implying both were exercised live.
- **Credential leakage** → the key is never logged; journal lines record the failure kind and provider, not the secret.

## Migration Plan

No data migration. Release ships the new cli-five; a user refreshes a scaffold by re-running `npx cli-five add jev` (idempotent: overwrites the plugin files and regenerates the `AGENTS.md` fence). Rollback is a revert; re-running `add jev` from the previous version restores the prior plugin and instruction. Nothing changes for a user with no credential — the local heuristic runs exactly as before.

## Open Questions

- Whether to migrate credential acquisition to the plugin-native `ctx.integration` API once it is confirmed to expose provider credentials in a stable OpenCode release — deferrable; it does not change the specs or this task breakdown, since the resolver is a single private seam.
