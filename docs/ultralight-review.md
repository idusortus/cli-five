# Ultralight Review

## What It Is

Ultralight is the closest reference point to cli-five's current direction: a small multi-agent Copilot plugin with an Orchestrator, Planner, Coder, and Designer, distributed as a plugin and bundled with Context7 and a frontend-design skill.

## What It Gets Right

- Plugin-first distribution keeps setup friction low.
- Bundles the tools the agents actually rely on, especially Context7.
- Keeps the orchestrator thin and outcome-focused.
- Uses a small, legible agent roster instead of trying to model an entire software org.

## What cli-five Should Borrow

- Treat plugin distribution as a first-class path, not a reduced-capability afterthought.
- Keep bundled agent dependencies explicit and close to the agent definitions.
- Preserve a tight scope: install fast, route work cleanly, avoid workflow theater.

## Where cli-five Should Go Further

- cli-five's scaffolded project memory is still useful. Ultralight is strong on plugin delivery, but weaker on project-local state scaffolding.
- cli-five benefits from a Planner, Coder, Designer, and Reviewer split. The review gate remains worth keeping.
- cli-five should enforce parity between plugin agents and scaffolded agents. Ultralight's small plugin surface makes that easier; cli-five needs tests to keep both channels aligned.

## Bottom Line

Ultralight is the cleanest proof that the plugin path is viable and that handoff buttons are not required for the model to work. Its main lesson for cli-five is to ship one strong autonomous contract everywhere instead of maintaining a strong template path and a weak plugin path.