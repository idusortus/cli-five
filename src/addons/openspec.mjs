import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../util/platforms.mjs';

/**
 * OpenSpec add-on constants + read-only detection.
 *
 * Unlike CodeGraph, this add-on has no config file to merge: the real install
 * is the external OpenSpec CLI. `openspec init --tools <tool>` creates the
 * `openspec/` directory (config.yaml + changes/ + specs/) AND installs the
 * editor surfaces for the chosen tool — the `opsx-*` commands and
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
 * Where OpenSpec installs its editor surfaces, per platform. `commandsDir` /
 * `skillsDir` are path segments; `commandSuffix` distinguishes OpenCode's
 * `*.md` commands from Copilot's `*.prompt.md` prompts.
 */
const SURFACE = {
  [PLATFORM_OPENCODE]: {
    commandsDir: ['.opencode', 'commands'],
    commandSuffix: '.md',
    commandsLabel: '.opencode/commands/opsx-*.md',
    skillsDir: ['.opencode', 'skills'],
    skillsLabel: '.opencode/skills/openspec-*/SKILL.md',
  },
  [PLATFORM_COPILOT]: {
    commandsDir: ['.github', 'prompts'],
    commandSuffix: '.prompt.md',
    commandsLabel: '.github/prompts/opsx-*.prompt.md',
    skillsDir: ['.github', 'skills'],
    skillsLabel: '.github/skills/openspec-*/SKILL.md',
  },
};

function hasCommands(cwd, surface) {
  const dir = join(cwd, ...surface.commandsDir);
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('opsx-') &&
        entry.name.endsWith(surface.commandSuffix)
    );
  } catch {
    return false;
  }
}

function hasSkills(cwd, surface) {
  const dir = join(cwd, ...surface.skillsDir);
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith('openspec-') &&
        existsSync(join(dir, entry.name, 'SKILL.md'))
    );
  } catch {
    return false;
  }
}

/**
 * True when the platform's editor surfaces are present (commands or skills).
 * Used to choose `init --tools` over `update --force`: surfaces can be missing
 * even when `openspec/` exists (e.g. the repo was set up for a different
 * platform), and `update` refreshes existing surfaces rather than adding them.
 */
export function openspecSurfaceFor(cwd, platform) {
  const surface = SURFACE[platform];
  if (!surface) return false;
  return hasCommands(cwd, surface) || hasSkills(cwd, surface);
}

/**
 * Inspect a workspace for evidence that OpenSpec is already set up, on either
 * platform. Read-only. Returns human-readable signals (empty when absent).
 */
export function detectOpenSpec(cwd) {
  const signals = [];

  if (existsSync(join(cwd, 'openspec'))) signals.push('openspec/');

  for (const surface of Object.values(SURFACE)) {
    if (hasCommands(cwd, surface)) signals.push(surface.commandsLabel);
    if (hasSkills(cwd, surface)) signals.push(surface.skillsLabel);
  }

  return signals;
}

export const __testables = { TOOL_BY_PLATFORM, SURFACE, detectOpenSpec, openspecSurfaceFor };
