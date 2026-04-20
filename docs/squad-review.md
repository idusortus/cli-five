# Squad Review

## What It Is

Squad is a larger, human-directed Copilot team system built around a CLI, persistent team state, upgrade flows, and optional background automation. It installs a repo-local team, keeps long-lived state under `.squad/`, and has a much broader operating surface than cli-five.

## What It Gets Right

- Treats agent state as durable project infrastructure, not one-off chat prompts.
- Makes upgrades explicit with `squad upgrade`, which is a strong answer to prompt drift.
- Documents human oversight clearly instead of pretending the system is fully autonomous.
- Supports richer operating modes such as watch/triage loops, externalized state, and SDK-first configuration.

## What cli-five Should Borrow

- A first-class upgrade story for agent-owned files.
- Stronger validation and docs around what files are owned by the tool versus user-owned state.
- Clearer separation between reusable agent framework and per-project memory/state.
- Better lifecycle documentation for installation, upgrade, and doctor-style repair.

## What cli-five Should Not Copy

- The full watch-mode / Ralph automation surface. It is powerful, but it drags the project toward issue polling, long-running orchestration, and a lot more operational complexity than cli-five needs.
- The heavier team-state taxonomy. cli-five works because it is smaller and easier to drop into a repo quickly.
- CLI sprawl. Squad has a broad command surface; cli-five's value is the quicker setup of a familiar five-agent workflow.

## Bottom Line

Squad proves that persistent multi-agent structure can work, but it is a much bigger product. The useful lesson for cli-five is not to become Squad-lite. The useful lesson is to keep the five-agent opinionated workflow, add upgrade and validation discipline, and avoid silent drift between installed agent definitions.