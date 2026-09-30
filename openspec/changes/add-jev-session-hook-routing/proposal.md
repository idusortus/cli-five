# Proposal

## Why

The shipped `tier_classifier` tool is **advisory**: the Planner must choose to call it, so the classification can silently not happen. TypeSafe's documented shape is the opposite — decision code in control. OpenCode V2 exposes a deterministic, admission-time hook (`ctx.session.hook("prompt", …)`, plus `ctx.session.hook("context", …)` for pre-dispatch instruction injection) that runs **once per user prompt, before the model sees it**. This change wires that path so the tier is always available. It is being built as a **spike**: the platform belief in this repo — "OpenCode plugin hooks don't fire under OpenChamber routing" — was established for tool-interception hooks (`tool.execute.before` / `permission.ask`) and has never been tested for session hooks. This change makes that testable and, if hooks do fire, keeps the deterministic path as the primary mechanism.

## What Changes

- Register **session hooks** in the jev tier-router plugin: a `prompt` hook that classifies the incoming user prompt once per admission, and a `context` hook that injects the resulting tier as a system instruction immediately before model dispatch.
- The injected instruction is **system-side only**: the user's own prompt text is NOT rewritten. Injection is additive and reversible.
- **Graceful absence:** if the host does not expose `ctx.session.hook` (older/V1 API, or a host that drops the hook), the plugin MUST be inert — no throw, no behaviour change — and the existing `tier_classifier` tool remains the only path.
- **Fail-open:** a classification failure falls back to the existing local heuristic; the hook never rejects, blocks, or delays admission beyond the existing bounded call.
- **Opt-out:** `CLI_FIVE_JEVR_HOOKS=0` disables the hook path without touching code.
- **Observability:** every hook firing (and every failure to register or fire) is appended to the existing jev journal, so a tester can prove from the log alone whether the hooks ran.

### Out of Scope

- Removing the `tier_classifier` tool — it stays as the fallback path (and the A/B control).
- Retry/backoff, caching beyond a single per-session result, or per-agent model overrides.
- The test-gate; `codegraph.mjs`; `openspec.mjs`.
- Any change to the classifier, credential resolution, criteria, models, or the result contract.

## Capabilities

### New Capabilities

- `jev-session-routing`: deterministic, admission-time tier classification and system-side injection, with graceful absence and the tool path retained as fallback.

### Modified Capabilities

- _None._ `openspec/specs/` is empty; both this and `add-jev-real-api-path` introduce new capabilities.

## Impact

**Code:** `templates/opencode/plugin/jev-tier-router/index.js` (hook registration + journal lines; the classifier and resolver are reused unchanged). Tests in `tests/jev.test.mjs`. `README.md` gains a short spike note.

**Depends on:** the uncommitted `add-jev-real-api-path` change (this builds on its classifier, credential resolver, and journal sink).

**Verification scope:** hooks are exercised in a real OpenCode session; whether they fire under OpenChamber's managed server specifically is the open question this spike exists to answer, and the log is the evidence.

## Outcome (decided after the spike)

Keep the deterministic path as primary if hooks fire under OpenChamber; otherwise retain the tool-only path and record the platform limitation in `decisions.md`.
