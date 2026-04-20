# GSD Review

## What It Is

Get Shit Done is a much larger context-engineering and workflow system that spans planning, execution, verification, shipping, multi-runtime installation, and a dense command surface. It is optimized for end-to-end guided delivery, not just quick team setup.

## What It Gets Right

- Takes context rot seriously and designs around it with phase planning, fresh execution contexts, and verification loops.
- Keeps verification and shipping as explicit workflow stages instead of hoping generation quality is enough.
- Has a strong install/update story across multiple runtimes.
- Documents why the system exists and what trade-offs it makes.

## What cli-five Should Borrow

- The idea that context structure matters more than prompt cleverness.
- Validation and documentation discipline around agent behavior, state files, and upgrade paths.
- Clear project artifacts that explain where the user is in the workflow and what happens next.

## What cli-five Should Not Copy

- The huge command surface and phase machinery. That would bury cli-five's main value under a lot of ceremony.
- Runtime-specific sprawl. cli-five should stay tightly focused on GitHub Copilot in VS Code.
- Background workflow complexity. GSD earns that scope because it is a broader platform; cli-five does not need it.

## Bottom Line

GSD is useful as a stress test for ideas, not as a shape to imitate directly. The right takeaway for cli-five is to steal the quality discipline, not the mass. Keep the five-agent setup fast and opinionated, but add enough validation and docs that the system does not silently degrade over time.