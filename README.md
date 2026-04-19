# cli-five

> **Code Like I'm Five** — scaffold a 5-agent VS Code Copilot team into any repo.

```bash
npx cli-five init
```

That's it. Run it in any folder. It interviews you, scaffolds `.github/agents/` + project memory files, searches skills.sh for relevant skills, and tells you what to do next.

## What you get

```
your-repo/
├── .github/
│   ├── agents/                  # 5 agents: Orchestrator, Planner, Coder, Designer, Reviewer
│   ├── copilot-instructions.md  # Persona + project mandates from interview
│   ├── instructions/            # Empty — populate via /agent-customization in chat
│   └── skills/                  # Empty — populate via skills.sh
├── AGENTS.md                    # Tool-agnostic project context (agents.md standard)
├── PROJECT.md                   # Long-form vision (rarely changes)
├── STATE.md                     # Cross-session status (changes constantly)
├── decisions.md                 # Architectural decision log
├── agent-diary.md               # Append-only session log
└── histories/                   # Per-agent accumulated learnings
```

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
5. **Scaffold** — writes 18 files. Substitutes answers into templates. Swaps `model:` per cost mode.
6. **Skill discovery** — queries skills.sh via `npx skills find <term>` per detected stack. Recommends known-good skills, offers multiselect install, and launches interactive browser.
7. **Next steps** — tells you to run `/agent-customization` for stack-specific instructions.

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
git clone https://github.com/idusortus/squad-mine
cd squad-mine
npm install
node bin/cli-five.mjs init --cwd /tmp/test-target
```

## License

MIT.
