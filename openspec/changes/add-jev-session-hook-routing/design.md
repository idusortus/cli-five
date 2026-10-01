# Design

## Context

See `proposal.md` for motivation. This spike exists to settle one question: **do OpenCode V2 session hooks fire in this environment (particularly under OpenChamber's managed server)?**

Mechanism, from the V2 plugin docs (`https://opencode.ai/v2/docs/build/plugins`, Hooks → Sessions):

- `ctx.session.hook("prompt", (event) => …)` — intercepts the incoming user prompt *before* attachment and skill resolution and durable admission; receives an owned, mutable draft. "The hook runs **once during admission**, not before every model call."
- `ctx.session.hook("context", (event) => …)` — modifies assembled system instructions/messages/tools immediately before model dispatch. `event.system.push({ type: "text", text })`.

Existing state this builds on (the uncommitted `add-jev-real-api-path` change): `classifyTask` (pure local heuristic), `resolveJevCredential`, `classifyWithJev` (credential-gated one-attempt call with fail-open), `journal()` (best-effort append, creates its parent directory), and the `tier_classifier` tool registered via `ctx.tool.transform`.

Counter-evidence to the repo's standing belief, gathered during research: the managed OpenChamber config lists plugins, and the server log shows a **project** plugin loading alongside the OpenChamber agent tool:

```
msg="loading plugin" id=.opencode/plugin/jev-tier-router
msg="loading plugin" id=/home/sam/.config/openchamber/agent-tool/openchamber-agent-tool
```

So project plugins load. The "hooks don't fire" claim was made about *tool-interception* hooks, not session hooks — it has never been tested for this family.

## Goals / Non-Goals

**Goals:**
- Register both session hooks with the minimum code that reuses the existing classifier, credential resolver, and journal.
- Make "did the hooks fire?" answerable from the journal alone, with no UI interpretation.
- Keep the user's prompt text untouched and the whole path inert when the surface is missing.

**Non-Goals:**
- Replacing or removing the `tier_classifier` tool.
- Any change to classification logic, criteria, models, timeouts, or the result contract.
- Solving concurrency or exactly-once semantics beyond what admission already provides.

## Decisions

### D1 — `prompt` hook classifies; `context` hook injects
Classification runs in the `prompt` hook (fires once per admission — the cheap, correct cadence); injection runs in the `context` hook, which is the documented place to add system instructions and is scoped to the outgoing call.
*Why not the reverse:* the `context` hook runs for every model call including tool-driven continuations, so classifying there would multiply calls per turn. *Why not both in `prompt`:* rewriting the prompt text persists into history as canonical user input — see D2.

### D2 — Never rewrite the user's prompt text
The `prompt` hook *can* mutate `event.prompt.text`, but that becomes the canonical persisted input and would show the user their own message altered. Injection goes to `event.system` instead — additive, per call, invisible to history.
*Trade-off:* if the `context` hook does not fire, the classification is journaled but not injected — which is itself a useful spike signal.

### D3 — Expect the hook surface to be optional, and be inert without it
Guard on `typeof ctx.session?.hook !== 'function'` and journal the absence. Wrap each registration in try/catch so a rejected registration cannot break plugin load. This is what keeps the spike safe on hosts where the surface does not exist.

### D4 — Hooks are on by default, with an env opt-out
The spike must be testable without editing code, so the hook path is active by default and disabled with `CLI_FIVE_JEVR_HOOKS=0`.
*Why not opt-in via env:* a managed OpenChamber server inherits the environment of whatever launched it, so a tester cannot reliably export a variable into it. Opt-out (rather than no switch) keeps an escape hatch for environments that can set env.

### D5 — Reuse, do not fork, the classifier
The hooks call the existing `classifyWithJev`, so credential resolution, the single bounded attempt, the local fallback, the availability note, and the journal sink all apply unchanged. A hook failure therefore degrades exactly the way a tool failure does.
*Consequence considered:* the prompt hook is async and may await up to the existing timeout (3 s). That is the same budget the tool call already spends, so it introduces no new worst case — it moves the cost from "the agent chose to call it" to "always, once per admission".

### D6 — The journal is the evidence
Because the spike's question is binary ("do hooks fire?"), each hook entry/exit and each registration failure writes a distinct journal line. A reviewer can answer the question from `.opencode/journals/jev-tier-router.log` without trusting an agent's summary.

## Risks / Trade-offs

- **Hooks may simply not fire** → then the change is inert; the journal records no hook lines and the tool path is unaffected. That negative result is the deliverable, and it gets recorded in `decisions.md`.
- **The prompt hook may not await async handlers** → the classification could race the model call. Mitigation: the `context` hook reads a cache that may still be empty and simply skips injection; no incorrect injection is possible, only absent injection. Detected in the spike by comparing journal order against the transcript.
- **Concurrent submissions can run the hook more than once** ("only the first successful admission wins") → at most a duplicate classification; no correctness impact, one extra call at worst.
- **Added latency and one extra call per user turn** → bounded by the existing 3 s timeout; free model on the OpenCode path.
- **Spike code in a shipped template** → the hook path is small, additive, and revertable; the outcome step in `proposal.md` decides keep-or-revert.

## Migration Plan

No data migration. After the spike: if the hooks fire and injection works, promote this to the primary path and keep the tool as fallback; if they do not fire, delete the hook registration and record the platform limitation. Either way the spike is one self-contained addition to a single file.

## Open Questions

- ~~Whether the `prompt` hook awaits an async handler before admitting the prompt.~~ **Answered by measurement:** yes — in the spike's live run the async classification completed (journal: `prompt fired` → `prompt classified`) and the injected instruction reached the model on the same turn.

## Findings — what session hooks can actually do (measured)

Method: a throwaway control-file-driven probe plugin at `/tmp/opencode/probe-repo/.opencode/plugin/hook-probe/` (logs to `/tmp/opencode/hook-probe.log`), run against real `opencode run --standalone` sessions with agent `orchestrator` and subagents on `opencode v2.0.17`. **Nothing in this repo was modified to obtain these results.**

Every row below is **measured** unless the row says otherwise.

### `prompt` hook

| Capability | Result |
|---|---|
| Mutating `event.prompt.text` | **Reaches the model.** A marker appended by the hook was echoed verbatim by the model in its reply. |
| Return value affects flow | **No effect.** Returning `{ rejected: true }` still admitted the prompt; run exited 0. (Matches the docs: "transform input and do not expose a typed rejection API".) |
| Throwing — root session | **Fatal to the run.** Exit 1, `UnexpectedStatus: 500`, prompt not admitted (the `context` hook never fired). The hook's error text was not surfaced to the caller. |
| Throwing — child (subagent) session | **Contained, but reaches the parent as a tool error.** The parent did not crash (exit 0); its `subagent` tool returned `{"error":{"type":"unknown","message":"PROBE_CHILD_THROW"},"content":[]}`. |
| Event shape | `[sessionID, messageID, prompt, metadata, delivery]`; `prompt` = `[text, files, agents, skills]`; **no `agent` field**. |

### `context` hook

| Capability | Result |
|---|---|
| Inject a fabricated message into model context | **Yes.** A pushed user message was acknowledged by the model (it referenced the injected text). |
| Injected message is obeyed as an instruction | **No.** The model identified it as an embedded instruction and declined. (Run-to-run variance: one run ignored it silently, one explicitly named it.) |
| Remove tools from the model's toolset | **Yes.** Deleting `write, edit, shell` removed write capability: no file was created and the model reported no write tool. Deleting only `write` did *not* prevent file creation (remaining tools bypassed it). |
| Override the model in place (`event.model.id = …`) | **Banner changed** (`deepseek-v4.1-flash` → `kimi-k2.7-code`). |
| Replace the `event.model` object reference | **No effect** — banner unchanged. |
| Event shape | `[sessionID, model, system, messages, options, agent, tools]`; carries `agent` (`orchestrator` vs `planner`/`coder`). Fires **for child/subagent sessions too**, and multiple times per turn. |

### Still `unknown` (not measured — do not claim)

- Whether the `event.model` override changes the **actual inference backend** (only the reported banner was observed).
- Mutation of `event.system`, `event.options`, or `event.agent` (not tested).
- Whether `prompt`-hook edits persist into stored history (docs assert "edits become the canonical persisted user input"; **inferred from docs**, not verified here).

### Documented-vs-measured contract cross-check

The local SDK (`@opencode-ai/plugin` v1.18.31) predates the session-hook types — there is no `session.d.ts` and no `SessionPrompt`/`SessionContextHook` export in it — so the only available written contract is the V2 plugin documentation. Where both exist they agree, with one correction: the docs' "synthetic messages … do not run the hook" does **not** cover subagent launches. Subagent admission **does** fire the `prompt` hook (measured), so that sentence refers to `ctx.session.synthetic(...)`/shell/compaction/move only.

## Design Decision — PENDING USER DECISION

The routing **policy** is undecided. Options under consideration (none approved):

| Option | Mechanism | Status |
|---|---|---|
| **A — inherit** | Classify once at the root; child sessions inherit the root's tier. | **Has a known flaw**, see below. |
| **B — classify every session** | Classify each admission independently. This is what the *shipped spike already does*. | Not chosen; not verified as intended. |
| **C — primary only** | Inject for the primary agent only; subagents fall back to the `tier_classifier` tool. | Not chosen. |
| **Hybrid candidate** | One real-Jev classification at the root session; child sessions classify their **own delegation text** with the **local heuristic** (no second API call). | Candidate only — recorded in `specs/jev-session-routing/spec.md`. Not approved. Do not build. |

**Known flaw in option A:** A's mechanism is "don't reclassify — inherit". A trivial delegation inside a `major` turn (e.g. "rename this variable") would therefore inherit `major`, discarding the tier signal for any turn with breadth.

**Newly available constraint on all options:** the classification is only ever **advisory**. Even with the hooks working, the injected tier is a system instruction the model may ignore (measured: the model declined an injected message it judged to be an embedded instruction). The platform *does* have enforcement surfaces — `event.tools` deletion was measured to work, and the docs show a `ctx.permission.hook("evaluate")` with a mutable `event.effect` — but nothing in this change uses them, and using them would be a different design.

