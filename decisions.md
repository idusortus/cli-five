# Architectural Decisions

> One entry per locked-in choice. Reverse chronological. Concise — not an ADR template.

## Format

    ## YYYY-MM-DD — <decision title>
    **Context:** Why we needed to decide.
    **Choice:** What we chose.
    **Trade-offs:** What we gave up.
    **Revisit:** Trigger that would re-open this decision (or "never").

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
