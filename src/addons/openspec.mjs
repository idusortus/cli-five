import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../util/platforms.mjs';

/**
 * OpenSpec add-on constants + read-only detection.
 *
 * Unlike CodeGraph, this add-on has no config file to merge: the real install
 * is the external OpenSpec CLI. `openspec init --tools <tool>` creates the
 * `openspec/` directory (config.yaml + changes/ + specs/) AND installs the
 * editor surfaces for the chosen tool — 7 `opsx-*` commands and 7
 * `openspec-*` skills. So `add openspec` drives that CLI idempotently.
 */
export const OPENSPEC_STATUS = 'OpenSpec CLI-driven: openspec/ config + editor commands + skills';

/** The npm package that provides the `openspec` binary. */
export const OPENSPEC_PACKAGE = '@fission-ai/openspec';

/**
 * `--tools` ids accepted by `openspec init` (verified on v1.13.1).
 * Copilot's id is `github-copilot`; OpenCode's is `opencode`.
 */
const TOOL_BY_PLATFORM = {
  [PLATFORM_OPENCODE]: 'opencode',
  [PLATFORM_COPILOT]: 'github-copilot',
};

/**
 * The `openspec init --tools <id>` value for a platform, or `null` when
 * OpenSpec has no editor surface for it.
 */
export function openspecToolFor(platform) {
  return TOOL_BY_PLATFORM[platform] || null;
}

/**
 * Inspect a workspace for evidence that OpenSpec is already set up.
 * Read-only. Returns a list of human-readable signals (empty when absent).
 */
export function detectOpenSpec(cwd) {
  const signals = [];

  if (existsSync(join(cwd, 'openspec'))) signals.push('openspec/');

  if (existsSync(join(cwd, '.opencode', 'commands', 'opsx-archive.md'))) {
    signals.push('.opencode/commands/opsx-archive.md');
  }

  // Any `.opencode/skills/openspec-*/SKILL.md` counts as the skills surface.
  const skillsDir = join(cwd, '.opencode', 'skills');
  if (existsSync(skillsDir)) {
    try {
      const found = readdirSync(skillsDir, { withFileTypes: true }).some(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('openspec-') &&
          existsSync(join(skillsDir, entry.name, 'SKILL.md'))
      );
      if (found) signals.push('.opencode/skills/openspec-*/SKILL.md');
    } catch {
      /* ignore unreadable skills dir */
    }
  }

  return signals;
}

export const __testables = { TOOL_BY_PLATFORM, detectOpenSpec };
