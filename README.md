# cli-five

> **Code Like I'm Five** — scaffold a 5-agent AI team into any repo.

## Three ways to install

### Full setup (recommended for teams)

```bash
npx cli-five init
```

By default `init` is **minimal**: it scaffolds the 5-agent team and the tooling they need, asking only for the target platform and (when it can't find them) your project name and one-liner. Name and description are auto-pulled from `package.json` and `README.md`. Optional integrations — including CodeGraph, skills, and instruction files — are **not** installed unless you ask.

```bash
npx cli-five init --full-interview   # legacy: docs, goals, persona, model picker, CodeGraph, skills, instructions
npx cli-five init --codegraph        # minimal, but add the CodeGraph MCP + AGENTS.md block
```

`--full-interview` (or passing `--doc`) restores the complete guided setup: stack presets, goals, constraints, persona toggle, per-agent model overrides, Copilot cost modes, CodeGraph, skill discovery, and stack-specific instruction generation. Individual pieces can also be toggled with `--codegraph`, `--skills`, `--instructions`, and `--persona`.

### Quick plugin install (personal use, Copilot only)

```
copilot plugin install idusortus/cli-five
```

Installs the 5 agents to your Copilot profile. No project config, no interview — just the agents with the same autonomous contracts shipped by the scaffolded templates.

### Let an agent do it (prompt)

Paste a ready-made prompt into any repo and have your agent install *and verify* cli-five there:

```text
Install cli-five in this repo for OpenCode and verify it works. Preview with
`npx -y cli-five@latest init --target opencode --dry-run --yes` first, then run it
without --dry-run. Confirm all five agents appear in `opencode debug agents`, run a
live orchestrator->planner delegation smoke test, run `npx -y cli-five@latest doctor`,
gitignore STATE.md/agent-diary.md/histories/, and leave everything staged without
committing. Report what you verified.
```

The full version — platform detection, provider/auth checks, collision preview, stop conditions, and what to report back — is in **[docs/INSTALL_PROMPT.md](https://github.com/idusortus/cli-five/blob/main/docs/INSTALL_PROMPT.md)**. It is generic: use it in any repository, Copilot or OpenCode.

## Supported platforms

cli-five can scaffold for:

- **GitHub Copilot** — `.github/agents/*.agent.md` + `copilot-instructions.md`
- **OpenCode** — `.opencode/agents/*.md` + `opencode.json`

Both platforms can optionally include a **CodeGraph** MCP server and instructions.

Run `npx cli-five init` and choose your platform. If you want both, run it again in the same repo.

## What you get

### GitHub Copilot layout

```
your-repo/
├── .github/
│   ├── agents/                  # 5 agents — Orchestrator delegates autonomously
│   │   ├── orchestrator.agent.md
│   │   ├── planner.agent.md
│   │   ├── coder.agent.md
│   │   ├── designer.agent.md
│   │   └── reviewer.agent.md
│   ├── copilot-instructions.md  # Project mandates (persona is opt-in)
│   ├── instructions/            # Container; stack guidelines via --instructions
│   └── skills/                  # Container; skills via --skills
├── .vscode/mcp.json             # CodeGraph MCP server (optional)
├── AGENTS.md                    # Tool-agnostic project context (agents.md standard)
├── PROJECT.md                   # Long-form vision (rarely changes)
├── STATE.md                     # Cross-session status (changes constantly)
├── decisions.md                 # Architectural decision log
├── agent-diary.md               # Append-only session log
└── histories/                   # Per-agent accumulated learnings
```

### OpenCode layout

```
your-repo/
├── .opencode/
│   └── agents/                  # 5 agents — Orchestrator delegates autonomously
│       ├── orchestrator.md
│       ├── planner.md
│       ├── coder.md
│       ├── designer.md
│       └── reviewer.md
├── opencode.json                # Project config, model defaults, CodeGraph MCP (optional)
├── .github/instructions/        # Container; stack guidelines via --instructions
├── .github/skills/              # Container; skills via --skills
├── AGENTS.md                    # Project rules + optional CodeGraph block
├── PROJECT.md
├── STATE.md
├── decisions.md
├── agent-diary.md
└── histories/
```

## How it works

Select the **Orchestrator** agent and describe what you want. The Orchestrator autonomously calls Planner → Coder/Designer → Reviewer without any manual handoff clicks.

```
User: implement from plan.md
Orchestrator → [calls Planner] → [calls Coder] → [calls Reviewer] → done
```

No buttons. No "click here to continue". Just results.

The plugin agents and scaffolded `.github/agents/*.agent.md` templates are intentionally kept in sync. The repository test suite checks that parity so the quick-install path does not quietly degrade.

## Commands

```bash
npx cli-five init              # minimal scaffold (5 agents + required tooling)
npx cli-five init --full-interview  # full guided setup (interview, models, skills, instructions)
npx cli-five add <name>        # install an optional add-on
npx cli-five list-addons       # show installed vs. available add-ons
npx cli-five doctor            # validate an existing cli-five setup
npx cli-five list-stacks       # show detectable tech stacks
npx cli-five help
```

### Flags

| Flag | Effect |
|---|---|
| `--yes`, `-y` | Accept defaults (overwrite gate still active) |
| `--force` | Overwrite without confirmation (use with `--yes`) |
| `--dry-run` | Print actions, write nothing |
| `--full-interview`, `--full` | Run the full legacy interview (docs, goals/constraints/persona, model picker). Also enables CodeGraph, skills + instructions |
| `--skills` / `--no-skills` | Force skill discovery on/off |
| `--instructions` / `--no-instructions` | Force stack-specific instruction generation on/off |
| `--persona` / `--no-persona` | Include / omit the snarky persona block |
| `--codegraph` / `--no-codegraph` | Force CodeGraph MCP + instructions on/off (default: on with `--full-interview`, off otherwise) |
| `--target <t>` | Target platform: `copilot` or `opencode` (default: `copilot`) |
| `--provider <p>` | Model provider: `copilot`, `opencode`, `opencode-go` (default: platform default) |
| `--cost-mode <m>` | Set cost mode for Copilot: `premium`, `cheap`, or `mixed` |
| `--doc <file>` | Read project docs to pre-fill interview (repeatable; implies `--full-interview`) |
| `--cwd <path>` | Run against a different directory |

## What `init` does

Default (`npx cli-five init`):

1. **Detect** — fingerprints stack (Node/TS, Python, .NET, Kotlin, Rust, Go, etc.). Brownfield-aware.
2. **Choose platform** — explicit `--target`, auto-detected from an existing scaffold, or prompted.
3. **git init** — if needed. Asks first.
4. **Overwrite gate** — double-confirms ("Proceed?" then "R U Sure?"). Only `--force --yes` bypasses.
5. **Project info** — name and one-liner auto-pulled from `package.json` / `README.md`; asks only when missing or ambiguous.
6. **Model configuration** — platform/provider defaults, no prompt.
7. **Scaffold** — writes the 5 agents + required project memory/tooling files. Swaps `model:` per provider defaults.
8. **Done** — prints platform-specific next steps.

`--full-interview` additionally runs:

- **Docs / manual interview** — project docs, stack preset, goals, constraints.
- **Model customization** — provider picker + per-agent model overrides.
- **Persona toggle** — snarky persona block.
- **CodeGraph** — MCP registration + `AGENTS.md` block (also available standalone via `--codegraph`).
- **Skill discovery** — multi-source discovery from **awesome-copilot** and **skills.sh**.
- **Custom instructions** — stack-specific `.instructions.md` files for detected languages.

## Idempotency

Re-running cli-five converges instead of blindly overwriting:

- **`add <name>` is a true no-op on re-run.** Add-ons merge into existing files (`mergeBlock`), so there are no duplicate MCP entries or `AGENTS.md` blocks.
- **`init` converges.** Managed files — the agent files, `copilot-instructions.md`, and container READMEs — are rewritten only when their contents actually differ. Unchanged files are left alone; the plan uses `+ created`, `~ updated`, `= unchanged`, `. skipped`.
- **User-owned files are create-once.** `PROJECT.md`, `STATE.md`, `decisions.md`, `agent-diary.md`, `AGENTS.md`, `histories/*.md`, and generated `.github/instructions/*.instructions.md` are written on first run and then skipped, so your edits survive a re-run.
- **`opencode.json` is merged, not replaced.** cli-five seeds its defaults only where keys are missing, preserving your `mcp`, `plugins`, `permission`, and model overrides.
- **`--force` opts back into overwrite** for a deliberate reset (use with `--yes`), including replacing `opencode.json` wholesale. Note it also resets user-owned memory (`STATE.md`, `PROJECT.md`, `histories/*`), so there is no scripted "refresh managed files only" yet.

`--dry-run` prints the same plan without writing anything.

## Add-ons

Optional integrations live outside the default scaffold and are installed with `cli-five add <name>`.

```bash
npx cli-five add             # list known targets
npx cli-five add codegraph   # CodeGraph MCP registration + AGENTS.md instructions
npx cli-five add jev         # tier routing for the Planner + opt-in Reviewer-spawn gate (OpenCode only)
npx cli-five add openspec    # drive the OpenSpec CLI: openspec/ + editor commands + skills
npx cli-five list-addons     # installed vs. available status
```

Add-ons use `mergeBlock(file, markerFence, content)` to layer a fenced block into an existing JSON or Markdown file without touching the rest of it (distinct from init's blunt overwrite gate). Markdown gets `<!-- NAME_START -->` / `<!-- NAME_END -->` fences; JSON is deep-merged with existing keys preserved. Re-running an add-on is idempotent — no duplicate MCP entries or AGENTS.md sections.

### CodeGraph (`add codegraph`)

`add codegraph` registers the CodeGraph MCP server and adds the CodeGraph section to `AGENTS.md`. It works on **both platforms**:

| Target | MCP registration | Instructions |
|---|---|---|
| Copilot | `.vscode/mcp.json` → `servers.codegraph` | `AGENTS.md` block |
| OpenCode | `opencode.json` → `mcp.codegraph` | `AGENTS.md` block |

**The `init` flags are now thin wrappers.** `init --codegraph` and `init --no-codegraph` still behave exactly as before, but they call the *same* underlying `add codegraph` logic — one implementation, two entry points. CodeGraph remains off by default in minimal `init` and on with `--full-interview`; pass `--codegraph` to force it on, `--no-codegraph` to force it off.

cli-five still does **not** run `codegraph init` itself — it only registers the server and reminds you to index the project:

```bash
npm i -g @colbymchenry/codegraph
codegraph init
```

### Jev (`add jev`) — tier routing + opt-in spawn gate, OpenCode only

`add jev` scaffolds an OpenCode plugin that adds a `tier_classifier` tool. The Planner calls it once per task to classify the work as `trivial` / `minor` / `major`, then scales planning depth accordingly.

The classifier is **optional real Jev** with a local fallback:

- **With a credential, it calls real Jev (System One).** On OpenCode it uses the credential you already have and is **free**: set `OPENCODE_API_KEY`, or just be connected via `/connect` (the key is read from the OpenCode credential store at `$XDG_DATA_HOME/opencode/auth.json`, else `~/.local/share/opencode/auth.json`, provider `opencode-go`). It sends one `choice` question to `https://opencode.ai/zen/v1/systemone` with the default model `jev-1.13-free`.
- **TypeSafe is the secondary provider.** With no OpenCode credential but `TYPESAFE_API_KEY` set, it posts to `https://api.typesafe.ai/v1/systemone` with the default model `jev-1.13.0`. (Jev via TypeSafe may be a paid key; the OpenCode free model is the no-extra-account path.)
- **Override the model** for whichever provider is selected with `CLI_FIVE_JEVR_MODEL` (the free OpenCode tier is explicitly limited-time, so this moves the pin without a code change).
- **No credential → the local heuristic, with zero network calls.** The tool then falls back to the local keyword/regex classifier, exactly as it did before the real path existed.

The result contract is unchanged: `{ tier, confidence, rationale, available, source }`, where `source` is `jev_api` for a real call and `local_heuristic` otherwise. An optional diagnostic `note` may accompany a fallback (and is ignored by consumers).

**It gates nothing by default.**

1. **The test-gate is parked.** The original test-gate design (gating Reviewer spawns via `tool.execute.before` / `permission.ask`) does not work: those V1 tool-interception hooks do not fire. The V2 permission `evaluate` hook does — see the opt-in spawn gate below — but it is off unless you turn it on. See [the issue tracker](https://github.com/idusortus/cli-five/issues).

`list-addons` reports each add-on's honest capability rather than a bare "installed":

```
codegraph   installed (MCP registration + AGENTS.md instructions)   available   MCP registration + AGENTS.md instructions
jev         installed (tier routing + opt-in spawn gate)            available   real Jev when a credential resolves (…); local heuristic otherwise; opt-in spawn gate off by default; test-gate parked — <issue link>
```

**Fail-open is non-negotiable.** A missing credential makes **zero** network calls. When a credential is present but the call fails for any reason — 401 / 422 / 429 / 529, a network error, a timeout, or a malformed response — the tool falls back to the **local heuristic's own** `tier` and `confidence` (never a bare `major`), attaches a note reminding you that Jev is available, and never throws. Only an unexpected internal error that prevents even the local heuristic reports `available: false`. cli-five and the scaffolded agents behave identically whether the plugin works, is missing, or is broken.

**Session-hook spike (deterministic path).** The plugin also registers OpenCode V2 **session hooks** (`ctx.session.hook('prompt', …)` and `ctx.session.hook('context', …)`) that classify the incoming prompt once at admission and inject the resulting tier as a **system instruction** — the user's prompt text is never rewritten, and no tool call is required. The path is **on by default** and disabled with **`CLI_FIVE_JEVR_HOOKS=0`**; it is inert (no throw, no behaviour change) on hosts without the session-hook surface. Every hook firing and every registration outcome is appended to the jev journal at **`.opencode/journals/jev-tier-router.log`**, so "did the hooks fire?" is answerable from the log alone. Measured: V2 session hooks **do fire** under OpenChamber's managed server (the old "hooks don't fire" belief came from the V1 *tool-interception* hooks and never applied to this family), and the permission `evaluate` hook below is likewise measured to fire. The **routing policy** remains an open question (the spike classifies every admission by default); the `tier_classifier` tool stays as the fallback and A/B control.

**Spawn gate (opt-in).** The plugin also ships an **opt-in Reviewer-spawn gate**, built on the OpenCode V2 permission `evaluate` hook (the measured enforcement surface). Enable it with either switch:

- **`.opencode/jev.json`** — the switch that works under **OpenChamber routing**, whose long-running `opencode serve` process never inherits your client environment. Write the project file and the change takes effect on the **next event, with no server restart**:

  ```json
  { "spawnGate": "shadow" }
  ```

  Accepted values are `off` | `shadow` | `enforce`; anything else — a missing, unreadable, unparseable, or keyless file — is `off`. The file is read against an `mtime`/`size`/`inode` stat signature (one `statSync` per in-scope event; a changed signature re-reads), so toggling it back and forth costs nothing else. If `ctx.location` yields no project directory, the file switch is disabled and the journal records `spawn-gate-config: no project directory; file switch disabled`.

- **`CLI_FIVE_JEVR_SPAWN_GATE=shadow|enforce`** — the env override, for **standalone/CI** runs (`opencode run --standalone`). When set, it **wins over the file**. An **unrecognised value, including a typo, is `off` — it does not fall through to the file**, so a bad env value silently disables the gate (and the journal shows no decision lines). Default `off`.

The gate's `evaluate` hook is always registered; the mode is resolved per event, so neither switch needs a reload. The gate acts only on `subagent` spawns whose target agent matches `reviewer` — everything else returns before any file read or network call.

- It reads the session transcript, finds the **most recent test run only**, and asks Jev two `noul` questions in one request: did that run fail, and is the failure **mechanical** (a missing import/module/dependency, a typo, a syntax error, or formatting) and fixable without design judgment or code review?
- **`shadow`** classifies and journals what it *would* deny but never changes the outcome. **`enforce`** may set `effect = 'deny'`, so the Reviewer spawn is blocked and its tokens are not spent; the deny is capped at **2 per session**.
- **Fail-open is non-negotiable:** a missing credential (zero network calls), a Jev error, a timeout, a malformed/unknown response, a transcript with no detectable test-run output, or any host error all leave the spawn **allowed** and set no effect. The handler never throws.
- Every decision is journaled to the **project's** `.opencode/journals/jev-tier-router.log` (the sink follows the resolved project directory, so under OpenChamber routing lines land in the project — not the server process's cwd) with `session`, `agent`, `mode`, `p_failing`, `p_mechanical`, `decision` (`allow` | `would-deny` | `deny`), `provider`, `model`, `latency_ms`, `state_chars`, and a `reason`. `CLI_FIVE_LOGFILE` overrides the path when set. Decision lines use the reserved `spawn-gate:` prefix; setup and config notices use `spawn-gate-config:` so the two never mix. Tally the decisions from the project root with:

  ```bash
  grep -h 'spawn-gate:' .opencode/journals/jev-tier-router.log | sed -E 's/.*decision=([a-z-]+).*/\1/' | sort | uniq -c
  ```

The "test run" detector is a documented heuristic (pass/fail counts, `PASS`/`FAIL`, `AssertionError`, `Traceback`, `Error:`, `✗`/`✓`, `npm test`/`pytest`/`jest`/`vitest`), and the cutoffs (`p_failing >= 0.85 && p_mechanical >= 0.85`), 5 s timeout, 8000-char state cap, and 2-deny cap are named constants at the top of `index.js`. The README's contract is the default-off path: a plain `add jev` install gates nothing until you opt in.

**What leaves the machine.** The session hooks and the `tier_classifier` tool both send the text they classify — the user's prompt, or the tool's `description` — to the resolved Jev provider (OpenCode Zen, or TypeSafe if that key is configured); the session hooks do so **by default** once a credential resolves, and `CLI_FIVE_JEVR_HOOKS=0` turns them off. The spawn gate is distinct only in *what* it sends: a **truncated slice of the session transcript** — the most recent test-run output plus the last few messages, capped at ~8000 characters. With the spawn gate at its default `off` (no `CLI_FIVE_JEVR_SPAWN_GATE` and no `.opencode/jev.json` `spawnGate`), the gate reads no transcript and makes no call; that statement is about the gate, not a claim that the rest of the plugin is silent.

**Why `shadow` comes first.** The two cutoffs are **initial values, not tuned ones**. `p_mechanical` is phrasing-sensitive: measured live, `Cannot find module 'left-pad'` scored **0.95** and `SyntaxError: Unexpected token '}'` scored **0.91**, but a bare `ReferenceError: helper is not defined` scored **0.76** and a pass/fail count with no error text scored **0.16** — so at the shipped 0.85 cutoff some genuinely mechanical failures are allowed through. Run in `shadow` on real work first, read the journal's `p_failing`/`p_mechanical` columns, and only move to `enforce` once you have seen what it would deny in your own codebase.

**Copilot has no equivalent.** `add jev` refuses cleanly on a Copilot target (exit 1, no files written) — there is no `tools.add`-style surface there.

### OpenSpec (`add openspec`)

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is the spec-driven change workflow. Unlike CodeGraph, it has **no config file for cli-five to merge** — the real install is the external OpenSpec CLI, which owns `openspec/` (`config.yaml`, `changes/`, `specs/`) *and* the editor surfaces (the `opsx-*` commands + `openspec-*` skills). So `add openspec` drives that CLI idempotently:

- **`openspec/` absent, or the platform's surfaces missing** → `openspec init --tools <tool>` (creates the directory and installs the surfaces; safe to re-run).
- **`openspec/` and the surfaces both present** → `openspec update --force` (refreshes in place, no prompt).

The surfaces check matters for platform switches: a repo set up for Copilot, then used from OpenCode, gets re-`init`ed to add the OpenCode `opsx-*` commands rather than only refreshed.

The `<tool>` id is `opencode` for OpenCode and `github-copilot` for Copilot, so it works on **both** platforms.

cli-five does **not** bundle or install the OpenSpec CLI. Install it first:

```bash
npm i -g @fission-ai/openspec
```

If the CLI is missing, the runner prints that line and stops (exit 1, nothing written). `--dry-run` prints the exact command it would run without executing it.

### Bootstrap the agentic stack (skill + prompt)

Two packaged artifacts automate the whole setup — the cli-five agent team, CodeGraph, and OpenSpec — idempotently:

- **Skill:** `skills/bootstrap-agentic-stack/SKILL.md` (shipped in the package). Copy the `skills/bootstrap-agentic-stack/` folder into the target repo's `.opencode/skills/` to make it invocable there.
- **Prompt:** `docs/BOOTSTRAP_AGENTIC_STACK_PROMPT.md` — a copy-paste prompt for agents (or repos) that cannot load the skill yet.

Both survey first, add only what is missing, change repo files only, and never commit or push. The prompt document carries the full procedure and guardrails.

## Model providers

During `init --full-interview` you can choose the model provider and optionally customize each agent's model. The minimal `init` path uses provider defaults (honouring `--provider` and `--cost-mode`).

| Provider | Platform | Example model |
|---|---|---|
| GitHub Copilot | Copilot | `Claude Sonnet 4.6 (copilot)` |
| OpenCode Zen | OpenCode | `opencode/gpt-5.3-codex` |
| OpenCode Go | OpenCode | `opencode-go/deepseek-v4.1-flash` |

**On OpenCode, the default provider is auth-aware.** cli-five checks which provider you are actually authenticated for (`opencode auth list`) and uses it instead of blindly defaulting to OpenCode Zen. If you are authenticated for Go only, `init --target opencode` writes Go models automatically — no `--provider` flag needed. If nothing is detected, or the selected provider does not match your auth, `init` prints a warning telling you how to fix it, so you do not end up with agent files whose models silently fail.

`--yes` uses the provider's defaults. `--provider opencode-go --yes` skips the provider prompt.

**OpenCode Go defaults:** all five agents use `opencode-go/deepseek-v4.1-flash`, except the Planner, which uses `opencode-go/kimi-k2.7-code`.

### Copilot cost modes

| Agent | `premium` (1x–3x) | `cheap` (0x) | `mixed` |
|---|---|---|---|
| Orchestrator | Claude Sonnet 4.6 | GPT-4.1 | GPT-4.1 |
| Planner | Claude Opus 4.6 | GPT-4o | GPT-4o |
| Coder | GPT-5.3-Codex | GPT-4.1 | GPT-5.3-Codex |
| Designer | Gemini 3.1 Pro (Preview) | GPT-4o | GPT-4o |
| Reviewer | Claude Sonnet 4.6 | GPT-5 mini | Claude Sonnet 4.6 |

Override from CLI: `npx cli-five init --cost-mode cheap`
Change anytime by editing the `model:` line in the agent files.

## CodeGraph

CodeGraph adds a local, graph-backed codebase context server. It is **off by default** in the minimal scaffold; enable it with `--codegraph` or `--full-interview`. When enabled, cli-five:

- Registers the CodeGraph MCP server in `opencode.json` (OpenCode) or `.vscode/mcp.json` (Copilot).
- Adds a marker-fenced CodeGraph section to `AGENTS.md`.
- Tells you to run `codegraph init` to index the project.

cli-five does **not** install or run the CodeGraph CLI automatically. After scaffolding:

```bash
npm i -g @colbymchenry/codegraph
codegraph init
```

## Required settings

### GitHub Copilot

```jsonc
{
  "chat.subagents.allowInvocationsFromSubagents": true
}
```

### OpenCode

No extra settings required. Project agents live in `.opencode/agents/` and the project config in `opencode.json`.

## Skill discovery

Skill discovery runs during `init --full-interview` (or when you pass `--skills`). cli-five searches **two sources** for skills matching your detected stack:

| Source | What it has | Stars |
|---|---|---|
| **awesome-copilot** | Skills, instructions, agents, plugins from the GitHub community | 30k+ |
| **skills.sh** | Curated skill repos (Vercel, Anthropic, Microsoft, etc.) | — |

Recommendations show with source attribution. Only cli-five core skills are pre-selected; suggested skills from skills.sh and awesome-copilot require manual selection (press Space) before install. After installation, you get breadcrumbs for ongoing discovery:

Take time to read each installed skill so you understand what it does and can catch overlap or conflicts before they affect your workflow.

- **Suggest skill** — `copilot plugin install awesome-copilot@suggest` (AI-driven repo analysis)
- **MCP server** — `awesome-copilot-mcp` for programmatic search from any agent
- **CLI browser** — `npx skills find` for interactive search

## What this is not

- **Not a runtime.** Once scaffolded, your repo doesn't depend on `cli-five`. You can uninstall the package and the agents still work.
- **Not a workflow engine.** No `/plan-phase`, no `/ship`, no 50 slash commands. Use `/agent-customization` in Copilot Chat or OpenCode commands to extend.
- **Not Ralph.** No issue-polling daemons, no autonomous loops, no crypto tokens.

## Why the name

ELI5 → CLI5. Code Like I'm Five. Five agents. Get it? Yeah, it's a stretch. But the npm name was available.

## Influences

- [bradygaster/squad](https://github.com/bradygaster/squad) — see [docs/squad-review.md](https://github.com/idusortus/cli-five/blob/main/docs/squad-review.md)
- [burkeholland/ultralight](https://github.com/burkeholland/ultralight) — see [docs/ultralight-review.md](https://github.com/idusortus/cli-five/blob/main/docs/ultralight-review.md)
- [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) — see [docs/gsd-review.md](https://github.com/idusortus/cli-five/blob/main/docs/gsd-review.md)

## Notes

- The plugin install path and the scaffolded project path are both supported and now validated against each other.
- `npm test` includes agent integrity checks in addition to the existing skill-step tests.
- Google Antigravity AGY CLI support is planned but not implemented yet.

## Local development

```bash
git clone https://github.com/idusortus/cli-five
cd cli-five
npm ci
npm run lint          # ESLint 10 (flat config)
npm test              # node --test
node bin/cli-five.mjs init --cwd /tmp/test-target
```

CI (`.github/workflows/ci.yml`) runs lint + tests on Node 20/22/24 for every pull request
and push to `main`; the publish workflow runs the same gate before releasing. The dev
tooling (ESLint 10) needs Node ≥ 20.19 even though the CLI itself runs on Node ≥ 20.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT.
