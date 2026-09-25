# cli-five

> **Code Like I'm Five** — scaffold a 5-agent AI team into any repo.

## Two ways to install

### Full setup (recommended for teams)

```bash
npx cli-five init
```

Interviews you, lets you pick a target platform and model provider, scaffolds agents + memory files + stack-specific instructions, discovers skills, and tells you what to do next.

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
│   ├── copilot-instructions.md  # Persona + project mandates from interview
│   ├── instructions/            # Stack-specific coding guidelines
│   └── skills/                  # Installed skills from awesome-copilot + skills.sh
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
├── .github/instructions/        # Stack-specific coding guidelines
├── .github/skills/              # Installed skills
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
npx cli-five init              # interview + scaffold + skill discovery
npx cli-five doctor            # validate an existing cli-five setup
npx cli-five list-stacks       # show detectable tech stacks
npx cli-five help
```

### Flags

| Flag | Effect |
|---|---|
| `--yes`, `-y` | Accept interview defaults (overwrite gate still active) |
| `--force` | Overwrite without confirmation (use with `--yes`) |
| `--dry-run` | Print actions, write nothing |
| `--no-skills` | Skip skills.sh discovery step |
| `--no-codegraph` | Skip CodeGraph MCP + instructions |
| `--target <t>` | Target platform: `copilot` or `opencode` (default: `copilot`) |
| `--provider <p>` | Model provider: `copilot`, `opencode`, `opencode-go` (default: platform default) |
| `--cost-mode <m>` | Set cost mode for Copilot: `premium`, `cheap`, or `mixed` |
| `--doc <file>` | Read project docs to pre-fill interview (repeatable) |
| `--cwd <path>` | Run against a different directory |

## What `init` does

1. **Detect** — fingerprints stack (Node/TS, Python, .NET, Kotlin, Rust, Go, etc.). Brownfield-aware.
2. **Choose platform** — GitHub Copilot or OpenCode, with optional CodeGraph pairing.
3. **git init** — if needed. Asks first.
4. **Overwrite gate** — double-confirms ("Proceed?" then "R U Sure?"). Only `--force --yes` bypasses.
5. **Project info** — name, one-liner, stack, frameworks, goals, constraints, persona toggle.
6. **Model configuration** — pick a provider and optionally override each agent's model.
7. **Scaffold** — writes platform-specific files. Swaps `model:` per provider/selection.
8. **Skill discovery** — multi-source discovery from **awesome-copilot** and **skills.sh**.
9. **Custom instructions** — generates stack-specific `.instructions.md` files for detected languages.
10. **Next steps** — platform-specific instructions. No button-clicking required.

## Model providers

During `init` you can choose the model provider and optionally customize each agent's model.

| Provider | Platform | Example model |
|---|---|---|
| GitHub Copilot | Copilot | `Claude Sonnet 4.6 (copilot)` |
| OpenCode Zen | OpenCode | `opencode/gpt-5.3-codex` |
| OpenCode Go | OpenCode | `opencode-go/qwen3.8-max` |

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

CodeGraph adds a local, graph-backed codebase context server. When enabled, cli-five:

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

cli-five searches **two sources** for skills matching your detected stack:

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
