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

export function agentDirFor(platform) {
  return platform === PLATFORM_OPENCODE ? '.opencode/agents' : '.github/agents';
}

export function agentFileFor(platform, name) {
  if (platform === PLATFORM_OPENCODE) {
    return `${name}.md`;
  }
  return `${name}.agent.md`;
}
