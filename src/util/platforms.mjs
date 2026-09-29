import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Supported cli-five platforms and CodeGraph pairing.

export const PLATFORM_COPILOT = 'copilot';
export const PLATFORM_OPENCODE = 'opencode';

export const PLATFORMS = [PLATFORM_COPILOT, PLATFORM_OPENCODE];

export function isValidPlatform(value) {
  return PLATFORMS.includes(value);
}

export function platformLabel(value) {
  return value === PLATFORM_OPENCODE ? 'OpenCode' : 'GitHub Copilot';
}

/**
 * Detect the platform from an existing scaffold, shared by add-ons and doctor.
 * Returns PLATFORM_OPENCODE, PLATFORM_COPILOT, or 'unknown' when neither
 * scaffold marker is present.
 */
export function detectPlatform(cwd) {
  if (existsSync(join(cwd, '.opencode', 'agents'))) return PLATFORM_OPENCODE;
  if (existsSync(join(cwd, '.github', 'agents', 'orchestrator.agent.md'))) return PLATFORM_COPILOT;
  return 'unknown';
}
