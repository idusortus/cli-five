## General Revision Notes

### Current Direction

- Keep the five-agent workflow small and Copilot-specific.
- Preserve autonomous orchestration instead of restoring button-driven handoffs as the default path.
- Keep plugin installation and scaffolded project generation aligned so users do not get two different systems.
- Prefer validation and upgrade discipline over adding more orchestration surface area.

### External Reference Reviews

- [squad-review.md](./squad-review.md) — larger persistent team system; useful for upgrade and ownership ideas.
- [ultralight-review.md](./ultralight-review.md) — closest plugin-first comparison; useful for keeping the system small.
- [gsd-review.md](./gsd-review.md) — strong context-engineering reference; useful for quality discipline, not scope.

### Product Implication

cli-five's value is not background automation or enterprise process theater. The value is a fast, familiar five-agent Copilot workflow with enough project memory to stay useful across sessions.

### Documentation Priorities

- Keep README focused on installation paths, workflow, and verification.
- Keep project review docs short and comparative instead of turning them into product fan fiction.
- Document only the ideas worth borrowing from external projects, plus the reasons to avoid copying the rest.