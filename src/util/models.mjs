// Model catalogs and defaults per provider.
// Provider IDs match the values used in OpenCode config (`provider/model-id`).

export const PROVIDER_COPILOT = 'copilot';
export const PROVIDER_ZEN = 'opencode';
export const PROVIDER_GO = 'opencode-go';

export const PROVIDERS = [PROVIDER_COPILOT, PROVIDER_ZEN, PROVIDER_GO];

export const PROVIDER_LABELS = {
  [PROVIDER_COPILOT]: 'GitHub Copilot',
  [PROVIDER_ZEN]: 'OpenCode Zen',
  [PROVIDER_GO]: 'OpenCode Go',
};

const AGENTS = ['Orchestrator', 'Planner', 'Coder', 'Designer', 'Reviewer'];

export const DEFAULT_MODEL_MAP = {
  [PROVIDER_COPILOT]: {
    Orchestrator: 'Claude Sonnet 4.6 (copilot)',
    Planner: 'Claude Opus 4.6 (copilot)',
    Coder: 'GPT-5.3-Codex (copilot)',
    Designer: 'Gemini 3.1 Pro (Preview) (copilot)',
    Reviewer: 'Claude Sonnet 4.6 (copilot)',
  },
  [PROVIDER_ZEN]: {
    Orchestrator: 'opencode/gpt-5.3-codex',
    Planner: 'opencode/claude-opus-4-6',
    Coder: 'opencode/gpt-5.3-codex',
    Designer: 'opencode/gemini-3.1-pro',
    Reviewer: 'opencode/claude-sonnet-4-6',
  },
  [PROVIDER_GO]: {
    Orchestrator: 'opencode-go/qwen3.8-max',
    Planner: 'opencode-go/deepseek-v4-pro',
    Coder: 'opencode-go/qwen3.8-max',
    Designer: 'opencode-go/gpt-5.6-luna',
    Reviewer: 'opencode-go/kimi-k2.7-code',
  },
};

// Curated model choices shown in the interview picker.
// Each entry is a full model reference string for the given provider.
export const PROVIDER_MODEL_CATALOG = {
  [PROVIDER_COPILOT]: [
    'Claude Sonnet 4.6 (copilot)',
    'Claude Opus 4.6 (copilot)',
    'Claude Opus 4.5 (copilot)',
    'GPT-5.3-Codex (copilot)',
    'GPT-5.2-Codex (copilot)',
    'GPT-5.1-Codex (copilot)',
    'GPT-5 (copilot)',
    'GPT-5 mini (copilot)',
    'GPT-4.1 (copilot)',
    'GPT-4o (copilot)',
    'Gemini 3.1 Pro (Preview) (copilot)',
    'Gemini 3 Flash (Preview) (copilot)',
  ],
  [PROVIDER_ZEN]: [
    'opencode/gpt-5.3-codex',
    'opencode/gpt-5.2-codex',
    'opencode/gpt-5.1-codex',
    'opencode/gpt-5.1-codex-max',
    'opencode/gpt-5.1-codex-mini',
    'opencode/gpt-5',
    'opencode/gpt-5-nano',
    'opencode/claude-opus-4-6',
    'opencode/claude-opus-4-5',
    'opencode/claude-sonnet-4-6',
    'opencode/claude-sonnet-4-5',
    'opencode/gemini-3.1-pro',
    'opencode/gemini-3-flash',
    'opencode/kimi-k2.7-code',
    'opencode/kimi-k2.6',
    'opencode/qwen3.8-max',
    'opencode/qwen3.8-flash',
    'opencode/qwen3.7-plus',
    'opencode/deepseek-v4-pro',
    'opencode/deepseek-v4.1-flash',
  ],
  [PROVIDER_GO]: [
    'opencode-go/qwen3.8-max',
    'opencode-go/qwen3.8-flash',
    'opencode-go/qwen3.7-max',
    'opencode-go/qwen3.7-plus',
    'opencode-go/qwen3.6-plus',
    'opencode-go/deepseek-v4-pro',
    'opencode-go/deepseek-v4.1-flash',
    'opencode-go/deepseek-v4-flash',
    'opencode-go/kimi-k3',
    'opencode-go/kimi-k2.7-code',
    'opencode-go/kimi-k2.6',
    'opencode-go/glm-5.3',
    'opencode-go/glm-5.2',
    'opencode-go/glm-5.1',
    'opencode-go/glm-5.3-flash',
    'opencode-go/minimax-m3',
    'opencode-go/minimax-m2.7',
    'opencode-go/gpt-6-luna',
    'opencode-go/gpt-5.6-luna',
    'opencode-go/muse-spark-1.3-contributor',
    'opencode-go/muse-spark-1.2-contributor',
    'opencode-go/mimo-v2.6-flash',
    'opencode-go/mimo-v2.6-pro',
    'opencode-go/grok-4.7',
    'opencode-go/grok-4.6',
    'opencode-go/longcat-2.0',
    'opencode-go/space-bunny-free',
  ],
};

export function getDefaultModelMap(provider) {
  return { ...DEFAULT_MODEL_MAP[provider] };
}

export function getModelCatalog(provider) {
  return PROVIDER_MODEL_CATALOG[provider] || [];
}

export function isValidProvider(value) {
  return PROVIDERS.includes(value);
}

export function normalizeProvider(value) {
  if (!value) return PROVIDER_COPILOT;
  const lower = String(value).toLowerCase();
  if (lower === 'zen') return PROVIDER_ZEN;
  if (lower === 'go') return PROVIDER_GO;
  if (lower === 'opencode') return PROVIDER_ZEN;
  if (lower === 'opencode-go') return PROVIDER_GO;
  if (lower === 'copilot' || lower === 'github-copilot') return PROVIDER_COPILOT;
  return isValidProvider(lower) ? lower : PROVIDER_COPILOT;
}

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

export function agentNames() {
  return [...AGENTS];
}

export function providerForPlatform(platform, provider) {
  if (platform === 'opencode') {
    return normalizeProvider(provider || PROVIDER_ZEN);
  }
  return PROVIDER_COPILOT;
}
