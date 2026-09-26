# Install cli-five with a prompt

A copy-paste prompt you can drop into any repository to have an AI agent (OpenCode,
Copilot, etc.) install and configure cli-five there — and, importantly, *verify* it
works rather than just writing files.

Use it when you would rather not run the CLI yourself, or when you want the install
checked against the repo's real state (platform, authenticated provider, collisions).

Everything in the prompt below was verified against a fresh repository on
`cli-five@0.2.18`: dry-run preview, install, agent registration, `doctor`, and a live
Orchestrator → Planner delegation.

---

## The prompt

Copy everything inside the fence below and paste it to your agent from the repo root.

````text
TASK: Install and configure cli-five in this repository, then verify it actually
works. Do not guess — confirm each step with real command output. Report honestly
if something fails; never paper over a failure.

STEP 0 — SURVEY BEFORE WRITING ANYTHING
- Identify the project: read package.json / pyproject.toml / go.mod / Cargo.toml /
  README for its name and purpose.
- Check what already exists so nothing gets clobbered: .github/, .opencode/,
  AGENTS.md, opencode.json, .vscode/mcp.json, STATE.md, decisions.md.
- Decide the target platform:
    * OpenCode  -> .opencode/ + opencode.json (use this if you are running inside
                   OpenCode/OpenChamber)
    * Copilot   -> .github/agents/ + VS Code Copilot Chat
  If both or neither are evident, ASK ME. Do not pick silently.
- If the target is OpenCode: run `opencode auth list` and record which provider(s)
  are authenticated. This matters: agents whose models are not authenticated fail
  silently at first use, long after install looks successful.

STEP 1 — PREVIEW, DO NOT WRITE
Run a dry run and read the plan:
    npx -y cli-five@latest init --target <opencode|copilot> --dry-run --yes
Include --yes even though it is a dry run: without it, cli-five may stop and prompt
interactively when the project name or description is ambiguous, which will hang you.
Read the "Plan:" file list. If it would overwrite anything you did not expect to
exist, STOP and report before writing.
Note what it says about the project name/tagline: if it reports "Multiple ... found;
--yes picked X", record that so we can correct it later.

STEP 2 — INSTALL
    npx -y cli-five@latest init --target <opencode|copilot> --yes
- Minimal init is the default: 5 agents + required tooling only. No skills, no
  stack instruction files, no persona, no CodeGraph.
- For OpenCode, cli-five auto-selects the provider you are authenticated for. If it
  reports a mismatch or detects no auth, re-run with --provider <id> matching your
  `opencode auth list` output.
- Only add extras if I asked for them:
    --codegraph        CodeGraph MCP registration + AGENTS.md block
    --full-interview   legacy guided setup (docs, goals, persona, models, skills,
                       instructions)
    --skills / --instructions / --persona   individual pieces

STEP 3 — VERIFY IT WORKS (this is the point of the install)
a) Agent registration
   OpenCode: `opencode reload`, then `opencode debug agents`.
     All five must appear: orchestrator, planner, coder, designer, reviewer.
   Copilot: confirm the five .github/agents/*.agent.md files exist, and that VS Code
     settings contain "chat.subagents.allowInvocationsFromSubagents": true.
b) Live smoke test — proves the models resolve, not just that files exist:
   OpenCode:
     opencode run --agent orchestrator --auto "Use your subagent tool to spawn the
     planner agent, ask it to reply with exactly PLAN-OK, then reply with only what
     it returned."
   Expect PLAN-OK. If you see "Model unavailable", the provider does not match your
   auth — fix it with --provider and re-run; do not leave broken agent files.
c) Health check:
     npx -y cli-five@latest doctor
   It must report all required files present. A single warning about a missing
   CodeGraph MCP entry is expected if CodeGraph was not enabled — not a failure.

STEP 4 — GIT HYGIENE
- Add a .gitignore for mutable per-session memory so diffs stay clean:
    STATE.md
    agent-diary.md
    histories/
  Keep decisions.md TRACKED — it is a reviewable architectural record, not churn.
- Track shared config: .opencode/agents/ (or .github/agents/), opencode.json (or
  .vscode/mcp.json), AGENTS.md, PROJECT.md, decisions.md.
- Do NOT commit and do NOT push. Leave the changes staged and report.

STEP 5 — OPTIONAL ADD-ONS (only if I asked for them)
    npx -y cli-five@latest add codegraph   # MCP registration + AGENTS.md instructions,
                                           # works on BOTH platforms
    npx -y cli-five@latest add jev         # tier-routing tool for the Planner,
                                           # OpenCode ONLY; tier-routing only, its
                                           # test-gate is parked
    npx -y cli-five@latest list-addons     # installed vs available, with honest status

STOP AND ASK ME IF:
- The target platform is ambiguous.
- The dry run would overwrite files you did not expect.
- No OpenCode provider is authenticated (do not scaffold models that cannot run).
- Any single step fails twice.

REPORT BACK:
- Which platform and provider you chose, and why.
- The verification output: agent list, smoke-test result, doctor result.
- What is staged vs. ignored.
- Anything you had to correct (e.g. a mis-picked project name or tagline).
````

---

## Why the prompt is shaped this way

These details come from actually installing cli-five and finding the rough edges:

- **`--dry-run` needs `--yes` too.** Without it, an ambiguous project name or
  description makes cli-five prompt interactively — which hangs an agent mid-task.
- **Provider must match your auth.** `init --target opencode` used to default to
  OpenCode Zen regardless of what you were authenticated for, producing agent files
  whose models failed at first use. cli-five now auto-detects the authenticated
  provider, but the prompt still requires a *live* smoke test, because "files exist"
  and "agents run" are different claims.
- **Verify registration, not just file presence.** `opencode debug agents` is what
  proves OpenCode actually picked the agents up.
- **Track config, ignore memory.** `STATE.md`, `agent-diary.md`, and `histories/`
  change on every agent session; committing them buries real diffs in noise.
- **Don't commit or push.** Leave the install staged so a human reviews it first.

## Short version

If you just want the install without the ceremony:

```text
Install cli-five in this repo for OpenCode and verify it works. Preview with
`npx -y cli-five@latest init --target opencode --dry-run --yes` first, then run it
without --dry-run. Confirm all five agents appear in `opencode debug agents`, run a
live orchestrator->planner delegation smoke test, run `npx -y cli-five@latest doctor`,
gitignore STATE.md/agent-diary.md/histories/, and leave everything staged without
committing. Report what you verified.
```
