# Architectural Decisions

> One entry per locked-in choice. Reverse chronological. Concise — not an ADR template.

## Format

    ## YYYY-MM-DD — <decision title>
    **Context:** Why we needed to decide.
    **Choice:** What we chose.
    **Trade-offs:** What we gave up.
    **Revisit:** Trigger that would re-open this decision (or "never").

---

## 2026-09-30 — Adopt OpenCode session hooks as the deterministic Jev call site
**Context:** The `tier_classifier` tool is advisory — the Planner has to choose to call it, so the classification can silently not happen, which is the opposite of TypeSafe's "code in control" model. The repo also carried a blanket belief that "OpenCode plugin hooks don't fire under OpenChamber routing". Research found that claim was derived from *tool-interception* hooks (`tool.execute.before` / `permission.ask`) and had never been tested against the V2 **session** hook family (`ctx.session.hook("prompt" | "context")`); the server log also shows project plugins loading alongside the OpenChamber agent tool.
**Choice:** Register both session hooks in the tier-router plugin — `prompt` classifies once per admission, `context` injects the tier as a system instruction (never rewriting the user's prompt text) — enabled by default with `CLI_FIVE_JEVR_HOOKS=0` as opt-out, leaving the tool as the fallback path. Verified in a real session: hooks fire, the async Jev call completes during admission, and the model receives the injected tier.
**Trade-offs:** The `context` hook runs per model call (including tool-driven continuations), so the injection line repeats; the classification itself stays once-per-admission via a per-session cache. `last`-result reuse was restricted to session-less events so concurrent sessions cannot bleed tiers. Hook behaviour on the OpenChamber **managed** server (as opposed to `--standalone`) was never exercised and remains the open gate.
**Revisit:** If the managed OpenChamber server drops the hooks, revert this path and record the platform limitation; if OpenCode ships a first-class classifier/instruction seam, migrate to it.

## 2026-09-30 — Prefer OpenCode Zen (free Jev) over TypeSafe for the real tier path
**Context:** The first entry below was written before we discovered that Jev is served through the user's existing OpenCode credential at `https://opencode.ai/zen/v1/systemone` (models `jev-1.13-free` / `jev-1.13`), verified live: neither OpenCode server process exports `OPENCODE_API_KEY`, but the key is in the credential store at `~/.local/share/opencode/auth.json` under provider `opencode-go` (OpenCode v2.0.17). So the earlier design — TypeSafe-only, `TYPESAFE_API_KEY`, model `jev-1.13.0` — would not work for a `/connect`-based user at all.
**Choice:** Order the providers **OpenCode Zen first** (credential from `OPENCODE_API_KEY`, else the auth store's `opencode-go` entry), **TypeSafe second** (only when `TYPESAFE_API_KEY` is set and no OpenCode credential resolved), with per-provider default models `jev-1.13-free` / `jev-1.13.0` and a `CLI_FIVE_JEVR_MODEL` override because the free tier is explicitly limited-time. The entry below is superseded on provider, key source, and model pin; its transport and one-bounded-attempt/no-retry decisions still stand.
**Trade-offs:** Reading OpenCode's private `auth.json` couples the plugin to an undocumented file format, mitigated by preferring the documented env var and by degrading every read failure to "no credential". Defaulting to the free model means routing quality/support is at TypeSafe's/Tencent's discretion for Free-tier Jev.
**Revisit:** If OpenCode exposes provider credentials through the stable plugin API (`ctx.integration.connection.active/resolve`), switch to it and drop the file read; or when the free tier ends, flip the default to `jev-1.13` and tell users.

## 2026-09-30 — Real-Jev tier path: direct HTTP, pinned model, one bounded attempt
**Context:** Change `add-jev-real-api-path` adds an optional real TypeSafe (Jev) path to the tier router. Step 0 confirmed from docs that `TYPESAFE_API_KEY` is the auth convention and that versioned IDs (`jev-1.13.0`) are accepted in the `model` field. We had to choose a transport, a model reference, and a failure policy for a call made inside a Planner's tool turn.
**Choice:** Call `POST https://api.typesafe.ai/v1/systemone` with built-in `fetch` (no `@typesafe-ai/sdk` dependency in the copied plugin), pin `model` to `jev-1.13.0` rather than `jev-latest`, and allow exactly one attempt with a 3000 ms timeout and **no** retry/backoff — any failure falls back to the existing local heuristic (`classifyTask`), not a bare `major`.
**Trade-offs:** Pinning means manual version bumps and we forgo the SDK's automatic backoff; a 3 s cap can produce a false fallback on a slow first call. Accepted because the plugin must stay dependency-free, the Planner threshold (0.6) must be reproducible, and a retry inside the hot path is a stalled-turn risk rather than a resilience win.
**Revisit:** If Jev ships a version with materially different calibration (re-tune the 0.6 cutoff then bump the pin), or if the SDK becomes the sanctioned integration surface.

## 2026-09-30 — Rename the jev tier tool `local_tier_heuristic` → `tier_classifier`
**Context:** Once a TypeSafe key can be present, a tool named `local_tier_heuristic` misdescribes its own mechanism, which contradicts the plugin's deliberate "TRUTHFUL NAMING" intent. The Planner instruction text had to change anyway (it currently asserts "This is a local heuristic, not a Jev call").
**Choice:** Rename to `tier_classifier` and let the result's `source` field (`jev_api` vs `local_heuristic`) report which path actually answered; `add jev` is idempotent so a re-run refreshes both the plugin file and the `AGENTS.md` fence.
**Trade-offs:** A scaffold that is never re-run keeps an `AGENTS.md` naming the old tool; the Planner's call then fails open to its own judgment. No alias/shim is provided for the old name.
**Revisit:** If stale-name support tickets appear, add a temporary alias in the plugin rather than reverting the rename.

---

## 2026-09-30 — Commit add-on artifacts; gitignore the generated CodeGraph index
**Context:** Installing the `codegraph` and `openspec` add-ons into cli-five's own repo produced tracked config changes (`AGENTS.md`, `opencode.json`) plus new OpenSpec-owned surfaces (`openspec/`, `.opencode/commands/`, `.opencode/skills/`) and, after `codegraph init`, a generated `.codegraph/` index.
**Choice:** Version-control the add-on artifacts (`openspec/` config/changes/specs and the `.opencode/commands|skills` surfaces), consistent with the already-tracked `.opencode/agents/`; add `.codegraph/` to `.gitignore` and never commit it.
**Trade-offs:** Committing the OpenSpec surfaces means they can drift from a user's globally installed OpenSpec version (refresh with `openspec update --force`); excluding `.codegraph/` means each checkout must run `codegraph init` locally before `codegraph explore` works.
**Revisit:** If CodeGraph ships a portable/CI-buildable index meant to be shared, or if OpenSpec surface churn becomes noisy in diffs.

## 2026-09-27 — Keep the `--target` default as `copilot`
**Context:** An external review flagged the `copilot` default as an unassigned "flip the default" item. We had to choose: flip to `opencode`, require an explicit `--target` with `--yes`, or keep the status quo.
**Choice:** Keep `copilot` as the default for `--yes`/non-interactive runs (the `--yes` branch of `choosePlatform` in `src/steps/platform.mjs`, `src/commands/init.mjs:207`). Both platforms remain fully installable and documented — verified with dry-run scaffolds for `--target copilot` and `--target opencode` (exit 0), Copilot plugin install at `README.md:25`, OpenCode config at `README.md:92`/`276`.
**Trade-offs:** The CLI default does not match this repo's own OpenCode-scaffolded workspace; OpenCode users must pass `--target opencode` or use the interactive prompt.
**Revisit:** A deliberate breaking release, or evidence that OpenCode is the dominant audience.

## 2026-09-27 — Untrack `node_modules` + generated logs without rewriting history
**Context:** `node_modules/` (337 files) and six stray `.ai_npm_*.log` files were committed to git. An external review recommended untracking plus a possible `git filter-repo` history purge.
**Choice:** Remove both from the index (`git rm --cached`), add `.ai_*.log` to `.gitignore`, and leave git history intact (no `filter-repo`/BFG/fresh-start).
**Trade-offs:** The blobs persist in older commits and `.git` stays ~2.3 MB. Accepted because `package.json`'s `files` whitelist already keeps `node_modules` out of the published npm tarball and the log contents are harmless.
**Revisit:** If `.git` grows past ~10 MB, or any committed log ever contains sensitive data.
