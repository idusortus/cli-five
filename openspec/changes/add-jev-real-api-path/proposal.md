# Proposal

## Why

`add jev` today ships only a local keyword/regex heuristic (`classifyTask`) and never calls a real model, so the Planner's tier routing rests on coarse lexical signals. The old `JEVR_SWAP_POINT` premise — that only a `jev-harness route` shell-out could provide real routing, and it exposed no custom-criteria interface — is obsolete. Jev is now reachable as a **System One** model that accepts arbitrary custom `criteria` on a `choice` question, and on the OpenCode path it is available **through the user's existing OpenCode credential** (`https://opencode.ai/zen/v1/systemone`, model `jev-1.13-free`), with no separate account. This change adds that path optionally and fail-open, so the packaged agent team uses real Jev when it can and the local heuristic when it cannot.

## What Changes

- Add an **optional real-Jev path** to the shipped tier tool, preferring the **OpenCode Zen** endpoint. The tool sends one request to `POST https://opencode.ai/zen/v1/systemone` with a single `choice` question whose three options (`trivial` / `minor` / `major`) carry criteria written from the existing `SIGNALS` groups' intent — no unrelated criteria are invented.
- **Credential resolution for the OpenCode path:** use `OPENCODE_API_KEY` when set; otherwise read the OpenCode credential store (`$XDG_DATA_HOME/opencode/auth.json`, falling back to `~/.local/share/opencode/auth.json`) for provider `opencode-go`. This matters because a `/connect`-based setup keeps the key in that store and does **not** export the env var.
- **Optional secondary provider:** when no OpenCode credential resolves but `TYPESAFE_API_KEY` is set, use TypeSafe directly (`POST https://api.typesafe.ai/v1/systemone`, model `jev-1.13.0`).
- Keep `classifyTask`'s external result **contract unchanged**: the fields the Planner consumes — `{ tier, confidence, rationale, available, source }` — and their types stay as they are, with `source` reporting which path answered (`'jev_api'` vs `'local_heuristic'`). An optional additive `note` field MAY accompany a result for diagnostics and MUST be ignored by consumers. The Planner's `confidence >= 0.6 -> trust, else fall back` instruction needs no change.
- Make fail-open **stricter than today**: with no resolvable credential, behavior is byte-identical to today (zero network calls, zero added latency). With a credential, any failure — 401 / 422 / 429 / 529, network error, timeout, missing/malformed/unrecognized response — falls back to the **existing local heuristic** (`classifyTask`), never to a bare `major`. Exactly **one attempt, bounded timeout; no retry/backoff** in the tool's `execute()` hot path.
- **Remind users that Jev is available** whenever the real path is skipped or fails: the tool attaches the hint as the optional `note`, the failure is journaled, and `add jev` + the README state that the team uses Jev automatically when a credential is present.
- **Correct the `JEVR_SWAP_POINT` comment**: it currently describes a `jev-harness route` shell-out that is not what was built and is no longer the plan; rewrite it to describe the real wiring.
- Update the `registry.mjs` jev `status` string to describe **both** states honestly (real Jev when a credential resolves; local heuristic otherwise), replacing the obsolete "jev-harness lacks a custom-criteria interface" framing.
- **Rename the tool** from `local_tier_heuristic` to `tier_classifier`, since the name must not assert a local-only implementation; `source` reports which path answered. Rationale and migration note are in `design.md`.
- Update README's jev section to describe the optional real-Jev path and what enabling it requires.

### Out of Scope (explicitly unchanged)

- The test-gate (Reviewer-blocking interception) stays parked; no interception is (re)attempted and `TEST_GATE_ISSUE` is not touched.
- `codegraph.mjs`, `openspec.mjs`, and their registry entries are untouched.
- No retry/backoff loop in the tool's `execute()` path, even though the docs recommend it for 429/529.
- No behavior change for Copilot targets — `add jev` still refuses cleanly (exit 1, no files written).
- No new npm dependency: the call uses the built-in `fetch` and the built-in `fs`/JSON reader.

## Capabilities

### New Capabilities

- `jev-tier-routing`: optional real-Jev (System One) tier classification for the Planner — OpenCode Zen first, TypeSafe optional — with the existing local heuristic as an unconditional, fail-open fallback and unchanged consumer-facing result contract.

### Modified Capabilities

- _None._ `openspec/specs/` is currently empty, so this is the project's first capability spec.

## Impact

**Code:** `templates/opencode/plugin/jev-tier-router/index.js` (credential resolution + classifier + tool registration + swap-point comment), `src/addons/jev.mjs` (status string, tool-name constant, Planner instruction text), `src/addons/registry.mjs` (jev entry), `README.md` (jev section), and `tests/jev.test.mjs` + `tests/addons.test.mjs` (new/updated coverage).

**Contract/consumers:** the Planner instruction injected into a target repo's `AGENTS.md` (fenced block `JEV_TIER_ROUTING`) — its `confidence >= 0.6` logic is unchanged, but its wording ("This is a local heuristic, not a Jev call") must be corrected.

**Dependencies / environment:** optional network dependency on `https://opencode.ai/zen/v1/systemone` and/or `https://api.typesafe.ai/v1/systemone`. Credential sources: `OPENCODE_API_KEY` (env), the OpenCode auth store at `$XDG_DATA_HOME/opencode/auth.json` / `~/.local/share/opencode/auth.json` (provider `opencode-go`), or `TYPESAFE_API_KEY` (env). No new npm dependency.

**Verification scope:** the real path was **live-exercised at the API level** in this environment against OpenCode Zen using the stored `opencode-go` credential (one direct `systemone` call returned `{"answers":{"tier":{"type":"choice","choice":"trivial","confidence":1}}}`). Route-level end-to-end execution of the shipped plugin through the Planner remains **pending** the change's verification tasks 7.1/7.2 and is not claimed here. The no-key path remains sandbox-verifiable; TypeSafe remains contract-verified only (no `TYPESAFE_API_KEY` present).
