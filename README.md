# cli-five

> **Code Like I'm Five** — scaffold a 5-agent VS Code Copilot team into any repo.

## Two ways to install

### Full setup (recommended for teams)

```bash
npx cli-five init
```

Interviews you, scaffolds agents + memory files + stack-specific instructions, discovers skills from **awesome-copilot** and **skills.sh**, and tells you what to do next.

### Quick plugin install (personal use)

```
copilot plugin install idusortus/cli-five
```

Installs the 5 agents to your Copilot profile. No project config, no interview — just the agents with sensible defaults.

## What you get

```
your-repo/
├── .github/
│   ├── agents/                  # 5 agents with handoffs + subagent delegation
│   │   ├── orchestrator.agent.md  # 📋 Plan  💻 Code  🎨 Design  🔍 Review
│   │   ├── planner.agent.md       # 🎯 Execute  💻 Code Directly
│   │   ├── coder.agent.md         # 🔍 Review  🎯 Back to Orchestrator
│   │   ├── designer.agent.md      # 🔍 Review  🎯 Back to Orchestrator
│   │   └── reviewer.agent.md      # 🎯 Back to Orchestrator  💻 Fix Issues
│   ├── copilot-instructions.md  # Persona + project mandates from interview
│   ├── instructions/            # Stack-specific coding guidelines
│   └── skills/                  # Installed skills from awesome-copilot + skills.sh
├── AGENTS.md                    # Tool-agnostic project context (agents.md standard)
├── PROJECT.md                   # Long-form vision (rarely changes)
├── STATE.md                     # Cross-session status (changes constantly)
├── decisions.md                 # Architectural decision log
├── agent-diary.md               # Append-only session log
└── histories/                   # Per-agent accumulated learnings
```

## Orchestration modes

The Orchestrator supports **both** delegation patterns:

- **Handoff buttons** — Click `📋 Plan`, `💻 Code`, `🎨 Design`, or `🔍 Review` to manually transition between agents with pre-filled context.
- **Subagent delegation** — Ask the Orchestrator to handle a complex task and it calls Planner → Coder → Reviewer autonomously.

Each specialist also has handoffs: Coder/Designer → Reviewer, Reviewer → Coder (fix loop), and everyone → back to Orchestrator.

## Commands

```bash
npx cli-five init              # interview + scaffold + skill discovery
npx cli-five doctor            # validate an existing setup
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
| `--cost-mode <m>` | Set cost mode: `premium`, `cheap`, or `mixed` |
| `--cwd <path>` | Run against a different directory |

## What `init` does

1. **Detect** — fingerprints stack (Node/TS, Python, .NET, Kotlin, Rust, Go, etc.). Brownfield-aware.
2. **git init** — if needed. Asks first.
3. **Overwrite gate** — double-confirms ("Proceed?" then "R U Sure?"). Only `--force --yes` bypasses.
4. **Interview** — name, one-liner, stack, frameworks, goals, constraints, cost mode, persona toggle.
5. **Scaffold** — writes 18 files. Substitutes answers into templates. Swaps `model:` per cost mode. Adds `handoffs:` to all agents.
6. **Skill discovery** — the hero feature. Multi-source discovery from **awesome-copilot** (30k+ ★ community marketplace) and **skills.sh**. Color-coded recommendations, source attribution, multiselect install, and post-install breadcrumbs with copy-paste commands for the awesome-copilot suggestion skill and MCP server.
7. **Custom instructions** — generates stack-specific `.instructions.md` files for detected languages.
8. **Next steps** — tells you to use handoff buttons or autonomous mode, offers plugin install shortcut.

## Cost modes

| Agent | `premium` (1x–3x) | `cheap` (0x) | `mixed` |
|---|---|---|---|
| Orchestrator | Claude Sonnet 4.6 | GPT-4.1 | GPT-4.1 |
| Planner | Claude Opus 4.6 | GPT-4o | GPT-4o |
| Coder | GPT-5.3-Codex | GPT-4.1 | GPT-5.3-Codex |
| Designer | Claude Opus 4.6 | GPT-4o | GPT-4o |
| Reviewer | Claude Opus 4.6 | GPT-5 mini | Claude Opus 4.6 |

Override from CLI: `npx cli-five init --cost-mode cheap`
Change anytime by editing the `model:` line in `.github/agents/*.agent.md`.

## Required VS Code settings

```jsonc
{
  "chat.subagents.allowInvocationsFromSubagents": true
}
```

## Skill discovery

cli-five searches **two sources** for skills matching your detected stack:

| Source | What it has | Stars |
|---|---|---|
| **awesome-copilot** | Skills, instructions, agents, plugins from the GitHub community | 30k+ |
| **skills.sh** | Curated skill repos (Vercel, Anthropic, Microsoft, etc.) | — |

Recommendations show with source attribution and are pre-selected for one-click install. After installation, you get breadcrumbs for ongoing discovery:

- **Suggest skill** — `copilot plugin install awesome-copilot@suggest` (AI-driven repo analysis)
- **MCP server** — `awesome-copilot-mcp` for programmatic search from any agent
- **CLI browser** — `npx skills find` for interactive search

## What this is not

- **Not a runtime.** Once scaffolded, your repo doesn't depend on `cli-five`. You can uninstall the package and the agents still work.
- **Not a workflow engine.** No `/plan-phase`, no `/ship`, no 50 slash commands. Use `/agent-customization` in Copilot Chat to extend.
- **Not Ralph.** No issue-polling daemons, no autonomous loops, no crypto tokens.

## Why the name

ELI5 → CLI5. Code Like I'm Five. Five agents. Get it? Yeah, it's a stretch. But the npm name was available.

## Influences

- [bradygaster/squad](https://github.com/bradygaster/squad) — see [docs/squad-review.md](docs/squad-review.md)
- [burkeholland/ultralight](https://github.com/burkeholland/ultralight) — see [docs/ultralight-review.md](docs/ultralight-review.md)
- [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) — see [docs/gsd-review.md](docs/gsd-review.md)

## Local development

```bash
git clone https://github.com/idusortus/cli-five
cd cli-five
npm install
node bin/cli-five.mjs init --cwd /tmp/test-target
```

## License

MIT.
