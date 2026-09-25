# Plan: Add OpenCode + CodeGraph support to cli-five

## Executive summary

cli-five currently scaffolds a 5-agent team for **GitHub Copilot** only. This plan adds a runtime choice between:

1. **GitHub Copilot** — existing behavior, `.github/agents/*.agent.md` + `copilot-instructions.md`.
2. **OpenCode + CodeGraph** — new path, `.opencode/agents/*.md` + `opencode.json` + CodeGraph MCP config + a CodeGraph block in `AGENTS.md`.

The user can run `cli-five init` a second time to get the other platform. Google Antigravity AGY CLI is explicitly out of scope for this pass.

A new model-selection interview stage is added: ask whether to customize models, pick a provider (GitHub Copilot, OpenCode Go, OpenCode Zen), apply curated defaults, then optionally override per-agent models.

---

## Research findings

### GitHub Copilot agent format (current)

- Location: `.github/agents/*.agent.md`
- Frontmatter keys: `name`, `description`, `model`, `tools`, `agents` (orchestrator only)
- Model IDs carry a `(copilot)` suffix, e.g. `Claude Sonnet 4.6 (copilot)`
- Subagent invocation uses the `agent` tool
- Context files: `.github/copilot-instructions.md`, `AGENTS.md`

### OpenCode agent format (target: current OpenCode V2)

- Project agents: `.opencode/agents/<name>.md`
- File stem becomes the agent ID (`orchestrator.md` → agent `orchestrator`)
- Frontmatter is YAML and supports the same fields as the JSON `agents` config:
  - `description` (required)
  - `mode`: `primary` | `subagent` | `all`
  - `model`: `provider/model-id`, e.g. `opencode/gpt-5.3-codex`
  - `temperature`, `top_p`, `steps`, `hidden`, `color`
  - `permission`: per-tool/per-agent permission object (`allow` | `ask` | `deny`)
- The markdown body becomes the agent's system prompt
- Subagent invocation uses the `task` tool; the caller needs `permission.task` entries for each subagent it may launch
- Project config: `opencode.json` / `opencode.jsonc` with `$schema: "https://opencode.ai/config.json"`
- OpenCode reads `AGENTS.md` from project root (and traverses up) as project rules

### CodeGraph integration

CodeGraph is a local code-knowledge-graph MCP server. For OpenCode it is configured as:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["codegraph", "serve", "--mcp"],
      "enabled": true
    }
  }
}
```

The official CodeGraph installer also injects a marker-fenced section into `AGENTS.md` so subagents and non-MCP contexts know to call `codegraph explore`. cli-five should do the same:

```markdown
<!-- CODEGRAPH_START -->
## CodeGraph
This project is indexed with CodeGraph. When you need codebase context, run `codegraph explore "<question>"` rather than guessing.
<!-- CODEGRAPH_END -->
```

CodeGraph's own installer wires agents; cli-five should **not** try to install the `codegraph` CLI. We should configure OpenCode to use it and tell the user to run `codegraph init` (or `codegraph install --target=opencode` if they need the CLI) after scaffolding.

### OpenCode providers & models

OpenCode supports 75+ providers. Per the request, the first-class choices are:

| Provider label | Provider ID to use | Notes |
|---|---|---|
| GitHub Copilot | `copilot` | Existing path; model strings use `(copilot)` suffix |
| OpenCode Zen | `opencode` | Curated gateway; model IDs like `opencode/gpt-5.3-codex`, `opencode/claude-opus-4-6` |
| OpenCode Go | `opencode-go` | Low-cost subscription tier; model refs like `opencode-go/kimi-k3` |

Model format in OpenCode config is always `provider/model-id`. For Copilot it remains the friendly `(copilot)` string because Copilot's own agent frontmatter expects it.

---

## Proposed user flow

```text
npx cli-five init

1/8 Detect workspace
2/8 Choose target platform
   → GitHub Copilot
   → OpenCode

3/8 CodeGraph pairing
   → Add CodeGraph MCP + instructions? [Yes / No]

4/8 Confirm overwrites
5/8 Project info (name, docs, stack, goals, constraints, persona)
6/8 Model configuration
   → Use default models? [Yes / Customize]
   → If customize: pick provider (Copilot / OpenCode Zen / OpenCode Go)
   → Show default model map for chosen provider
   → Change any agent's model? [list each agent with current model]
   → Allow freeform input; optionally show curated model list for provider

7/8 Scaffold
8/8 Custom instructions
Done. Next steps are platform-specific.
```

`--yes` uses the platform default (`copilot` to stay backward-compatible), enables CodeGraph, and uses the provider's default model map. New flags:
- `--target <copilot|opencode>` overrides the platform question.
- `--no-codegraph` skips CodeGraph even on OpenCode.

---

## File & code changes

### New source modules

| File | Purpose |
|---|---|
| `src/steps/platform.mjs` | Prompt for target platform; validate flag |
| `src/util/models.mjs` | Curated model catalogs + default maps per provider; model swap helpers |
| `src/util/platforms.mjs` | Platform constants, validation, file-location helpers |

### New templates

| Path | Purpose |
|---|---|
| `templates/opencode/agents/orchestrator.md` | OpenCode primary orchestrator |
| `templates/opencode/agents/planner.md` | OpenCode subagent planner |
| `templates/opencode/agents/coder.md` | OpenCode subagent coder |
| `templates/opencode/agents/designer.md` | OpenCode subagent designer |
| `templates/opencode/agents/reviewer.md` | OpenCode subagent reviewer |
| `templates/opencode/opencode.json.tmpl` | Project `opencode.json` with CodeGraph MCP entry |

The OpenCode agent bodies should be adaptations of the existing 5 agents, with:
- Tool references changed to OpenCode tool names (`read`, `edit`, `write`, `bash`, `task`, `skill`, `webfetch`, `websearch`, `lsp`, etc.)
- Orchestrator `permission.task` explicitly allowing `planner`, `coder`, `designer`, `reviewer`
- No `io.github.upstash/context7/*` tool; instead instructions to use `codegraph explore` and `webfetch`

### Modified existing files

| File | Change |
|---|---|
| `src/cli.mjs` | Add `--target <copilot\|opencode>` flag; update help text |
| `src/commands/init.mjs` | Insert platform-selection step after detection; pass `platform` and `models` to scaffold; print platform-specific next steps |
| `src/steps/interview.mjs` | Move model selection out into `src/util/models.mjs`; add provider/model prompts; include `platform`, `provider`, `modelMap` in answers |
| `src/steps/scaffold.mjs` | Branch scaffold by platform; swap models per provider; write `opencode.json` + `.opencode/agents/*.md` + CodeGraph AGENTS.md block for OpenCode |
| `src/commands/doctor.mjs` | Validate required files per platform; validate OpenCode agent frontmatter; check `opencode.json` CodeGraph MCP block when platform is OpenCode |
| `src/util/agents.mjs` | Add OpenCode agent validation helpers; keep Copilot validation |
| `tests/agents.test.mjs` | Add OpenCode template validation; keep Copilot parity test |
| `tests/models.test.mjs` *(new)* | Sanity-check default model maps and validation |
| `README.md` | Document the two platforms, provider/model options, `--target` flag, and CodeGraph prerequisites |
| `package.json` | Possibly add keywords (`opencode`, `codegraph`) |

### Unchanged

- `plugin.json` and `plugin-agents/` remain Copilot-only distribution. They are the quick-install path for Copilot and do not need OpenCode equivalents (OpenCode agents are scaffolded, not installed via plugin registry today).
- The existing `.github/agents/*.agent.md` templates stay Copilot-formatted.

---

## Model defaults

### GitHub Copilot defaults

| Agent | Default model |
|---|---|
| Orchestrator | `Claude Sonnet 4.6 (copilot)` |
| Planner | `Claude Opus 4.6 (copilot)` |
| Coder | `GPT-5.3-Codex (copilot)` |
| Designer | `Gemini 3.1 Pro (Preview) (copilot)` |
| Reviewer | `Claude Sonnet 4.6 (copilot)` |

### OpenCode Zen defaults

| Agent | Default model |
|---|---|
| Orchestrator | `opencode/gpt-5.3-codex` |
| Planner | `opencode/claude-opus-4-6` |
| Coder | `opencode/gpt-5.3-codex` |
| Designer | `opencode/gemini-3.1-pro` |
| Reviewer | `opencode/claude-sonnet-4-6` |

### OpenCode Go defaults

| Agent | Default model |
|---|---|
| Orchestrator | `opencode-go/qwen3.8-max` |
| Planner | `opencode-go/deepseek-v4-pro` |
| Coder | `opencode-go/qwen3.8-max` |
| Designer | `opencode-go/gpt-5.6-luna` |
| Reviewer | `opencode-go/kimi-k2.7-code` |

The curated catalog includes the documented Go models (Qwen, DeepSeek, Kimi, GLM, MiniMax, Grok, GPT Luna, MiMo, etc.). The UI still allows freeform input for any model OpenCode later adds.

### Model-selection UX

1. **Ask custom?** `confirm` — "Customize agent models?" (default false)
2. **Provider** `select` — Copilot / OpenCode Zen / OpenCode Go
3. **Defaults shown** as a table
4. **Per-agent override** `multiselect` or repeated `select` for each agent; choices come from the curated provider catalog plus a "Type custom..." option
5. The final map is stored in `answers.modelMap`

If OpenCode is installed locally, we *could* try `opencode models` to enrich the list, but that requires provider auth and adds fragility. The first pass should use a static catalog plus freeform.

---

## Scaffold behavior per platform

### GitHub Copilot

Same as today:
- `.github/agents/*.agent.md`
- `.github/copilot-instructions.md`
- `.github/instructions/`, `.github/skills/`
- `AGENTS.md`, `PROJECT.md`, `STATE.md`, `decisions.md`, `agent-diary.md`
- `histories/*.md`

### OpenCode (+ CodeGraph)

- `.opencode/agents/*.md` (5 agents)
- `opencode.json` at project root with:
  - `$schema`
  - `model` default (orchestrator model)
  - `small_model` default
  - `subagent_depth: 2` (so orchestrator → subagent → no further nesting)
  - `mcp.codegraph` entry (if CodeGraph enabled)
- `AGENTS.md` with the standard project context **plus** the CodeGraph marker block (if enabled)
- `PROJECT.md`, `STATE.md`, `decisions.md`, `agent-diary.md`
- `histories/*.md`
- `.github/instructions/` can still be generated if the project has those stacks, because instruction files are useful to any agent; but we skip `copilot-instructions.md`

### GitHub Copilot (+ CodeGraph)

Same as today, plus:
- CodeGraph marker block appended to `AGENTS.md`
- A `codegraph` MCP server entry added to `.vscode/mcp.json` (VS Code / Copilot Chat) or printed for manual addition to the user's Copilot settings

No attempt is made to run `codegraph init`; the next-steps message tells the user:

```text
1. Install the CodeGraph CLI if you haven't: npm i -g @colbymchenry/codegraph
2. Run: codegraph init
3. Restart your agent / VS Code.
4. Select the Orchestrator agent and describe what you want built.
```

---

## Validation / doctor

### Copilot checks

Keep existing `doctor` checks:
- Required files exist
- Agent frontmatter valid
- Orchestrator references all 4 subagents

### OpenCode checks

- `.opencode/agents/orchestrator.md` exists and has `mode: primary`
- Other 4 agents exist and have `mode: subagent`
- Each agent has `description` and `model`
- `opencode.json` exists and parses as JSON/JSONC
- `opencode.json` has `mcp.codegraph` entry
- `AGENTS.md` contains the CodeGraph marker block

---

## Tests

1. **Copilot parity**: `plugin-agents/*.agent.md` still matches `templates/.github/agents/*.agent.md`.
2. **Copilot validation**: scaffolded Copilot agents pass `validateAgentSource`.
3. **OpenCode validation** *(new)*: OpenCode agent templates have required frontmatter and non-empty bodies.
4. **Model maps** *(new)*: every provider has a complete 5-agent default map; every model string is non-empty.
5. **Scaffold smoke** *(new)*: run `init` with `--target opencode --yes --dry-run` and assert the expected file list.

---

## Implementation phases

1. **Phase 1 — Platform selection**
   - Add `--target` flag and `src/steps/platform.mjs`
   - Wire platform choice into `init` flow
   - Update help and doctor to know about platform

2. **Phase 2 — Model configuration**
   - Add `src/util/models.mjs` with provider catalogs and defaults
   - Add interview prompts for provider + per-agent model override
   - Store `modelMap` in answers

3. **Phase 3 — OpenCode templates**
   - Create 5 `.opencode/agents/*.md` templates
   - Create `opencode.json.tmpl`
   - Update scaffold to branch by platform and swap models
   - Add CodeGraph block to `AGENTS.md` for OpenCode

4. **Phase 4 — Validation & tests**
   - Update `doctor` for OpenCode
   - Add OpenCode tests
   - Update existing tests to be platform-aware

5. **Phase 5 — Documentation**
   - Update `README.md`
   - Add migration note for existing Copilot users

---

## Decisions confirmed

1. **OpenCode Go provider ID** — Use `opencode-go`; model refs are `opencode-go/<model-id>`.

2. **CodeGraph with Copilot** — CodeGraph is offered as an optional add-on for **both** GitHub Copilot and OpenCode.

3. **`codegraph init` automation** — Do **not** auto-run. Print next-step instructions instead.

4. **Global vs local OpenCode config** — Write a project-local `opencode.json`. Document that it overrides any global config for this project.

5. **AGENTS.md for Copilot** — Add the CodeGraph marker block to `AGENTS.md` only when CodeGraph is enabled; otherwise keep it tool-agnostic.

---

## Migration / backward compatibility

- Running `npx cli-five init` with no flags continues to default to **GitHub Copilot**, preserving existing behavior.
- `--cost-mode` continues to work for Copilot.
- Existing `.github/agents/*.agent.md` files are unaffected by the new OpenCode path.
- The Copilot plugin install (`copilot plugin install idusortus/cli-five`) is unchanged.
