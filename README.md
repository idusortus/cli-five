# cli-five

> **Code Like I'm Five** — scaffold a 5-agent AI team into any repo.

## Two ways to install

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
npx cli-five add <name>        # install an optional add-on (dispatcher; targets land later)
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

## Add-ons

Optional integrations live outside the default scaffold and are installed with `cli-five add <name>`.

```bash
npx cli-five add            # list known targets
npx cli-five add codegraph  # CodeGraph MCP registration + AGENTS.md instructions
npx cli-five add jev        # tier-routing tool for the Planner (OpenCode only)
npx cli-five list-addons    # installed vs. available status
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

### Jev (`add jev`) — tier-routing only, OpenCode only

`add jev` scaffolds an OpenCode plugin that adds a `local_tier_heuristic` tool. The Planner calls it once per task to classify the work as `trivial` / `minor` / `major`, then scales planning depth accordingly.

**Two things it deliberately does *not* do, stated plainly:**

1. **It does not call Jev.** `jev-harness` 0.2.0's `route` subcommand exposes no custom-criteria interface — it emits its own fixed tier vocabulary (`deterministic` / `lightweight_system2` / `heavy_system2`) and returns a constant confidence (`0.88`) under its offline/mock engine, so it cannot be thresholded on. The shipped tool is therefore a **local heuristic**, truthfully named `local_tier_heuristic`. The swap point for real Jev wiring is marked in `templates/opencode/plugin/jev-tier-router/index.js` (`JEVR_SWAP_POINT`).
2. **The test-gate is parked.** Gating Reviewer spawns via plugin interception (`tool.execute.before` / `permission.ask`) does not work: OpenCode plugin hooks do not fire under OpenChamber's embedded-server routing. Do not expect `add jev` to gate anything.

`list-addons` reports each add-on's honest capability rather than a bare "installed":

```
codegraph   installed (MCP registration + AGENTS.md instructions)   available   MCP registration + AGENTS.md instructions
jev         installed (tier-routing only)                           available   local heuristic — …; test-gate parked — <issue link>
```

**Fail-open is non-negotiable.** If the classifier is unavailable, errors, or returns malformed output, the tool returns `available: false` with tier `major` (the expensive tier) and never throws. The Planner falls back to its own judgment. cli-five and the scaffolded agents behave identically whether the plugin works, is missing, or is broken.

**Copilot has no equivalent.** `add jev` refuses cleanly on a Copilot target (exit 1, no files written) — there is no `tools.add`-style surface there.


## Model providers

During `init --full-interview` you can choose the model provider and optionally customize each agent's model. The minimal `init` path uses provider defaults (honouring `--provider` and `--cost-mode`).

| Provider | Platform | Example model |
|---|---|---|
| GitHub Copilot | Copilot | `Claude Sonnet 4.6 (copilot)` |
| OpenCode Zen | OpenCode | `opencode/gpt-5.3-codex` |
| OpenCode Go | OpenCode | `opencode-go/qwen3.8-max` |

**On OpenCode, the default provider is auth-aware.** cli-five checks which provider you are actually authenticated for (`opencode auth list`) and uses it instead of blindly defaulting to OpenCode Zen. If you are authenticated for Go only, `init --target opencode` writes Go models automatically — no `--provider` flag needed. If nothing is detected, or the selected provider does not match your auth, `init` prints a warning telling you how to fix it, so you do not end up with agent files whose models silently fail.

`--yes` uses the provider's defaults. `--provider opencode-go --yes` skips the provider prompt.

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

- [bradygaster/squad](https://github.com/bradygaster/squad) — see [docs/squad-review.md](docs/squad-review.md)
- [burkeholland/ultralight](https://github.com/burkeholland/ultralight) — see [docs/ultralight-review.md](docs/ultralight-review.md)
- [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) — see [docs/gsd-review.md](docs/gsd-review.md)

## Notes

- The plugin install path and the scaffolded project path are both supported and now validated against each other.
- `npm test` includes agent integrity checks in addition to the existing skill-step tests.
- Google Antigravity AGY CLI support is planned but not implemented yet.

## Local development

```bash
git clone https://github.com/idusortus/cli-five
cd cli-five
npm install
node bin/cli-five.mjs init --cwd /tmp/test-target
```

## License

MIT.
