# .github/instructions/

Drop `*.instructions.md` files here for language- or path-specific guidance.

Each file should:

- start with YAML frontmatter
- include an `applyTo` glob (e.g. `**/*.ts`) OR a `description` for on-demand loading
- be terse — instructions burn context every time they load

Generate stack-appropriate instructions by running `/agent-customization` in Copilot Chat
after `npx cli-five init`. It will read `PROJECT.md` and propose files based on your stack.

Reference: https://code.visualstudio.com/docs/copilot/copilot-customization
