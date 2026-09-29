# Bootstrap the agentic stack with a prompt

A copy-paste prompt you can drop into any repository to have an AI agent enable the
full agentic coding stack there — the **cli-five** 5-agent team (OpenCode target), the
**CodeGraph** MCP, and **OpenSpec** — *idempotently*, verifying as it goes rather than
just writing files.

Use it when you would rather not drive the tooling yourself, or when you want the setup
checked against the repo's real state (platform, authenticated provider, what already
exists). `cli-five init` is now **idempotent and non-destructive**, so re-running it on a
set-up repo is safe. It changes repo files only and never commits or pushes.

---

## The prompt

Copy everything inside the fence below and paste it to your agent from the repo root.

````text
TASK: Make this repository agent-ready — idempotently enable, in order: (1) the
cli-five 5-agent team (OpenCode target), (2) the CodeGraph MCP registration + AGENTS.md
instructions, and (3) OpenSpec (the spec-driven change workflow). Detect what already
exists and add only what is missing. Do not guess — confirm each step with real command
output and report honestly if something fails.

RULES
- Repo files ONLY. Never edit ~/.config/opencode/**.
- cli-five init is idempotent and non-destructive: managed files converge, user-owned
  files are created once, and opencode.json is merged add-only. It will not overwrite.
- --yes is the safe non-interactive mode: it never prompts and only writes missing files.
  The ONLY overwrite path is `--force --yes`, which also resets the user-owned memory
  files (PROJECT.md, STATE.md, decisions.md, agent-diary.md). Confirm before using
  --force; never use it just to "refresh".
- Confirm before anything irreversible or machine-global: installing a CLI globally
  (npm i -g ...), `codegraph init` (builds an index), and `openspec init` (creates
  openspec/) each need an explicit yes.
- Do NOT commit and do NOT push. Leave the changes staged for review.

STEP 1 — SURVEY (no writes)
- Identify the project (name/purpose from package.json / README).
- Detect the platform: OpenCode (.opencode/, opencode.json, or you are running under
  OpenCode/OpenChamber) vs Copilot (.github/agents/). Default to OpenCode when running
  under OpenCode/OpenChamber; if ambiguous, ASK. Do not pick silently.
- Record what already exists: .opencode/agents/, opencode.json, AGENTS.md, .codegraph/,
  openspec/, STATE.md, decisions.md, agent-diary.md, histories/.
- Check tool availability without installing: `npx -y cli-five@latest --version`,
  `openspec --version`, `codegraph --version`. Note which are missing.
- If OpenCode: run `opencode auth list` and record the authenticated provider(s) —
  agents whose models are not authenticated fail silently at first use.

STEP 2 — AGENT TEAM (cli-five, drive it, don't reimplement it)
- If .opencode/agents/ is missing or incomplete, PREVIEW then install:
    npx -y cli-five@latest init --target opencode --dry-run --yes   # read the plan
    npx -y cli-five@latest init --target opencode --yes
  --yes keeps it non-interactive and preserves existing files (it never prompts). The
  plan symbols are `+ created`, `~ updated`, `= unchanged`, `. skipped`; under --yes you
  will only see `+`/`=`/`.` — there is nothing to overwrite (~ appears only with --force).
- init is idempotent and non-destructive: managed files converge (byte-compare),
  user-owned files (PROJECT.md, STATE.md, decisions.md, agent-diary.md, AGENTS.md,
  histories/*.md) are create-once, and opencode.json is merged add-only (existing `mcp`,
  `plugins`, and model overrides preserved). Re-running is safe.
- If it already exists: run `npx -y cli-five@latest doctor` and add only what it reports
  missing.
- Provider: cli-five is auth-aware and auto-selects the provider you are authenticated
  for; pass --provider <id> only to override.

STEP 3 — CODEGRAPH
- Register the MCP server + AGENTS.md block (idempotent fenced merge):
    npx -y cli-five@latest add codegraph
- Indexing is a SEPARATE step needing the CodeGraph CLI:
    npm i -g @colbymchenry/codegraph && codegraph init
  Do NOT install the CLI or run `codegraph init` without my confirmation — one is a
  global install and the other writes .codegraph/. If the CLI is absent, print those two
  commands and stop this branch.

STEP 4 — OPENSPEC
- PREFERRED: drive the cli-five add-on — `npx -y cli-five@latest add openspec`. It runs
  `openspec init --tools opencode` when openspec/ is absent OR the platform's surfaces are
  missing (e.g. after a platform switch), and `openspec update --force` when both are
  present, so re-running is idempotent; either path creates openspec/ and installs the
  editor surfaces (the opsx-* commands and the openspec-* skills). Preview with --dry-run.
  It needs the OpenSpec CLI (npm i -g @fission-ai/openspec); if that is missing the add-on
  prints the install line and writes nothing.
- FALLBACK (cli-five unavailable): confirm, then from the repo root run
  `openspec init --tools opencode`. (Verified on @fission-ai/openspec v1.13.1: it creates
  openspec/ and installs the surfaces non-interactively.) Refresh later with
  `openspec update --force`. If the installed version offers no such mechanism, vendor the
  opsx-* commands and openspec-* skills from a known-good source and record the version used.
- The add-on prints `Present: …`; that plus `openspec list --json` (a `root` object)
  confirms the root.

STEP 5 — OPENCHAMBER (nothing to install)
- OpenChamber is a client that opens OpenCode repos; there is no per-repo config to
  write. Note only that it can open this repo, and that OpenCode plugin hooks do not
  fire under OpenChamber's embedded-server routing, so anything relying on plugin
  interception is inert there.

STEP 6 — VERIFY (this is the point; "files exist" != "it works")
- `opencode reload`, then `opencode debug agents` -> the agent team is registered.
- Live smoke test (proves models resolve, not just that files exist):
    opencode run --agent orchestrator --auto "Use your subagent tool to spawn the
    planner; have it reply with exactly PLAN-OK, then reply with only what it returned."
  Expect PLAN-OK. A "Model unavailable" means a provider mismatch — fix it, do not
  leave broken agent files.
- `npx -y cli-five@latest doctor` -> required files present.
- OpenSpec: `openspec list --json` shows a `root`, and the add-on printed `Present: …`.
- opencode.json contains the `codegraph` MCP entry and AGENTS.md has the fenced
  CodeGraph block.
- If a cli-five step throws, re-run it with CLI_FIVE_DEBUG=1 to see the full stack.

STEP 7 — GIT HYGIENE
- Gitignore mutable per-session memory: STATE.md, agent-diary.md, histories/.
- Keep tracked: .opencode/agents/, opencode.json, AGENTS.md, PROJECT.md, decisions.md,
  openspec/.
- Stage but do NOT commit; report what is staged vs. ignored.

STOP AND ASK ME IF:
- The platform is ambiguous.
- You'd need --force (that path overwrites and resets the user-owned memory files).
- A required CLI is missing (print the install command; do not install without approval).
- No OpenCode provider is authenticated.
- Any step fails twice.

REPORT BACK:
- Platform + provider chosen, and why.
- What was already present vs. enabled now.
- Verification output (agent list, smoke-test result, doctor, `openspec list`).
- What is staged vs. ignored, and anything that needed a human.
````

---

## Short version

If you just want the bootstrap without the ceremony:

```text
Make this repo agent-ready, idempotently and repo-files-only. Survey first (platform,
provider, what already exists), then: preview+install the cli-five agent team for OpenCode
(`npx -y cli-five@latest init --target opencode --dry-run --yes` then without --dry-run;
init is non-destructive and --yes keeps existing files — only `--force --yes` overwrites,
and it also resets the memory files, so don't use it to refresh), add CodeGraph
(`npx -y cli-five@latest add codegraph`, but ask before `npm i -g @colbymchenry/codegraph`
/ `codegraph init`), and set up OpenSpec (`npx -y cli-five@latest add openspec`; fallback
`openspec init --tools opencode`). Verify for real: `opencode debug agents`, a live
orchestrator->planner smoke test expecting PLAN-OK, `npx -y cli-five@latest doctor`, and
`openspec list --json`. Gitignore STATE.md/agent-diary.md/histories/, keep
.opencode/agents/, opencode.json, AGENTS.md, PROJECT.md, decisions.md, openspec/ tracked,
and leave everything staged without committing. Report what you verified.
```

## Pairs with the skill

This prompt is the paste-in twin of the `bootstrap-agentic-stack` skill
(`skills/bootstrap-agentic-stack/SKILL.md`). Use the prompt when the target repo has no
skill installed yet; to use the skill instead (e.g. under OpenCode without the CLI),
copy `skills/bootstrap-agentic-stack/` into the target repo's `.opencode/skills/`.
Both describe the same procedure and the same guardrails.
