---
name: bootstrap-agentic-stack
description: 'Set up or repair the agentic coding stack in a repository — the OpenCode agent team via cli-five, the CodeGraph MCP, and OpenSpec. Use when asked to: set up agents in this repo, bootstrap agentic tooling, make this repo agent-ready, install cli-five, enable CodeGraph, enable OpenSpec, check what agent tooling is missing, or repair a broken agent setup.'
version: 1.1.0
---

# Skill: bootstrap-agentic-stack

Make a repository **agent-ready** — idempotently enable, in order: the **cli-five** 5-agent team (OpenCode target), the **CodeGraph** MCP registration + instructions, and **OpenSpec** (the spec-driven change workflow). It detects what already exists and adds only what's missing. `cli-five init` is idempotent and non-destructive, so re-running it on an already set-up repo is safe.

This skill **drives cli-five** rather than reimplementing its scaffolding, changes **repo files only** (never the machine-global OpenCode config), and does not install CLIs globally unless you explicitly approve.

## Non-negotiable rules
- **Idempotent & non-destructive:** survey first; `cli-five init` converges managed files and creates user-owned files once — it will not overwrite. Skip anything already present; never create duplicate MCP entries or `AGENTS.md` sections.
- **`--yes` is the safe, non-interactive mode:** it never prompts and only writes missing files. The only overwrite path is **`--force --yes`**, which also resets the user-owned memory files (`PROJECT.md`, `STATE.md`, `decisions.md`, `agent-diary.md`). Confirm before using `--force`; never use it just to "refresh".
- **Confirm before the irreversible/global:** a global CLI install, `codegraph init` (builds an index), and `openspec init` (creates `openspec/`).
- **Verify, don't assume:** "files exist" ≠ "it works" — run the checks in step 6.
- **Repo files only:** never edit `~/.config/opencode/**`.
- **Don't commit or push;** leave the changes staged for review.

## Procedure

### 1. Survey (no writes)
- Identify the project (name/purpose from `package.json` / `README`).
- Detect the platform: **OpenCode** (`.opencode/`, `opencode.json`, or you are running under OpenCode/OpenChamber) vs **Copilot** (`.github/agents/`). Default to OpenCode when running under OpenCode/OpenChamber; if ambiguous, ask.
- Record what already exists: `.opencode/agents/`, `opencode.json`, `AGENTS.md`, `.codegraph/`, `openspec/`, `STATE.md`, `decisions.md`, `agent-diary.md`, `histories/`.
- Check tool availability (do not install yet): `npx -y cli-five@latest --version`, `openspec --version`, `codegraph --version`. Note which are missing.
- If the target is OpenCode, run `opencode auth list` and record the authenticated provider(s) — agents whose models are not authenticated fail silently later.

### 2. Agent team (cli-five)
- If `.opencode/agents/` is missing or incomplete: preview, then install.
  - `npx -y cli-five@latest init --target opencode --dry-run --yes` — read the plan. `--yes` keeps it non-interactive and preserves existing files.
  - Plan symbols: `+ created`, `~ updated`, `= unchanged`, `. skipped`. Under `--yes` you will only see `+` / `=` / `.` — there is no overwrite (`~` only appears if `--force` was passed).
  - `npx -y cli-five@latest init --target opencode --yes`
- `init` is idempotent and non-destructive: managed files converge (byte-compare), user-owned files (`PROJECT.md`, `STATE.md`, `decisions.md`, `agent-diary.md`, `AGENTS.md`, `histories/*.md`) are create-once, and `opencode.json` is merged **add-only** (existing `mcp`, `plugins`, and model overrides are preserved). Re-running is safe.
- If it already exists: run `npx -y cli-five@latest doctor` and add only what it reports missing.
- Provider: cli-five is **auth-aware** and auto-selects the provider you're authenticated for. Pass `--provider <id>` only to override.

### 3. CodeGraph
- Register the MCP server + `AGENTS.md` block (an idempotent fenced merge): `npx -y cli-five@latest add codegraph`.
- Indexing is a separate step that needs the CodeGraph CLI: `npm i -g @colbymchenry/codegraph && codegraph init`. **Do not install the CLI or run `codegraph init` without confirming** — one is a global install and the other writes `.codegraph/`. If the CLI is absent, print those two commands and stop this branch.

### 4. OpenSpec
- **Preferred:** drive the cli-five add-on — `npx -y cli-five@latest add openspec`. It runs `openspec init --tools opencode` when `openspec/` is absent **or** the platform's surfaces are missing (e.g. after a platform switch), and `openspec update --force` when both are present, so re-running is idempotent; either path creates `openspec/` + `config.yaml` and installs the editor surfaces (the `opsx-*` commands and `openspec-*` skills). Preview with `--dry-run`. It requires the OpenSpec CLI (`npm i -g @fission-ai/openspec`); if that is missing the add-on prints the install line and stops without writing.
- **Fallback** (cli-five unavailable): confirm, then from the repo root run `openspec init --tools opencode`. (Verified on `@fission-ai/openspec` v1.13.1: it creates `openspec/` and installs the surfaces non-interactively.) Refresh later with `openspec update --force`. Version fallback: if the installed OpenSpec offers no such mechanism, vendor the `opsx-*` commands and `openspec-*` skills from a known-good source and record the version used.
- The add-on prints `Present: …` listing what it installed; that plus `openspec list --json` (a `root` object) confirms the root.

### 5. OpenChamber (nothing to install)
- OpenChamber is a client that opens OpenCode repos; there is no per-repo config to write. Note only that it can open this repo, and that OpenCode **plugin hooks do not fire under OpenChamber's embedded-server routing**, so anything relying on plugin interception is inert there.

### 6. Verify (this is the point)
- `opencode reload` then `opencode debug agents` → the agent team is registered.
- Live smoke test (proves models resolve, not just that files exist): `opencode run --agent orchestrator --auto "Use your subagent tool to spawn the planner; have it reply with exactly PLAN-OK, then reply with only what it returned."` → expect `PLAN-OK`. A "Model unavailable" means a provider mismatch — fix it, don't leave broken agent files.
- `npx -y cli-five@latest doctor` → required files present.
- OpenSpec: `openspec list --json` shows a `root`, and the add-on reported `Present: …`.
- `opencode.json` contains the `codegraph` MCP entry and `AGENTS.md` has the fenced CodeGraph block.
- If a cli-five step throws, re-run it with `CLI_FIVE_DEBUG=1` to see the full stack.

### 7. Git hygiene
- Gitignore mutable per-session memory: `STATE.md`, `agent-diary.md`, `histories/`.
- Keep tracked: `.opencode/agents/`, `opencode.json`, `AGENTS.md`, `PROJECT.md`, `decisions.md`, `openspec/`.
- Stage but do not commit; report what is staged vs. ignored.

## Stop and ask if
- The platform is ambiguous.
- You'd need `--force` (that path overwrites and resets the user-owned memory files).
- A required CLI is missing (print the install command; don't install without approval).
- No OpenCode provider is authenticated.
- Any step fails twice.

## Report back
- Platform + provider chosen, and why.
- What was already present vs. enabled now.
- Verification output (agent list, smoke-test result, `doctor`, `openspec list`).
- What is staged vs. ignored, and anything that needed a human.
