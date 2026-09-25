import kleur from 'kleur';
import prompts from 'prompts';
import {
  PLATFORM_COPILOT,
  PLATFORM_OPENCODE,
  PLATFORMS,
  platformLabel,
} from '../util/platforms.mjs';
import { log } from '../util/log.mjs';
import {
  agentNames,
  getDefaultModelMap,
  getModelCatalog,
  normalizeProvider,
  providerForPlatform,
  providerLabel,
  PROVIDER_COPILOT,
  PROVIDER_ZEN,
  PROVIDERS,
} from '../util/models.mjs';

const CUSTOM_SENTINEL = '__custom__';

/**
 * Ask the user to choose a target platform.
 * If args.target is a valid platform, skip the prompt.
 */
export async function choosePlatform(args) {
  if (args.target) {
    const t = String(args.target).toLowerCase();
    if (PLATFORMS.includes(t)) {
      return { platform: t, codegraph: args.codegraph !== false };
    }
  }

  if (args.yes) {
    return { platform: PLATFORM_COPILOT, codegraph: args.codegraph !== false };
  }

  const { platform } = await prompts({
    type: 'select',
    name: 'platform',
    message: 'Target platform',
    choices: [
      {
        title: 'GitHub Copilot',
        value: PLATFORM_COPILOT,
        description: 'VS Code / Copilot Chat agent customization files',
      },
      {
        title: 'OpenCode',
        value: PLATFORM_OPENCODE,
        description: 'OpenCode project agents + opencode.json',
      },
    ],
    initial: 0,
  });

  if (!platform) {
    throw new Error('Platform selection cancelled. Nothing was written.');
  }

  const { codegraph } = await prompts({
    type: 'confirm',
    name: 'codegraph',
    message: `Add CodeGraph MCP + instructions for ${platformLabel(platform)}?`,
    initial: true,
  });

  return { platform, codegraph: codegraph !== false };
}

/**
 * Ask the user whether to customize models, pick a provider, and optionally
 * override per-agent models.
 */
export async function chooseModels(platform, args) {
  // Defaults for the platform.
  const defaultProvider = providerForPlatform(platform, args.provider);
  const defaults = getDefaultModelMap(defaultProvider);

  if (args.yes) {
    return {
      provider: defaultProvider,
      modelMap: defaults,
      customized: false,
    };
  }

  const { customize } = await prompts({
    type: 'confirm',
    name: 'customize',
    message: 'Customize agent models?',
    initial: false,
  });

  if (!customize) {
    return {
      provider: defaultProvider,
      modelMap: defaults,
      customized: false,
    };
  }

  const provider = await chooseProvider(platform, args.provider);
  const baseMap = getDefaultModelMap(provider);

  // Show defaults and ask which agents to override.
  log.raw(kleur.dim('\n  Default models:'));
  for (const agent of agentNames()) {
    log.raw(kleur.dim(`    ${agent.padEnd(14)} → ${baseMap[agent]}`));
  }

  const { overrideAgents } = await prompts({
    type: 'multiselect',
    name: 'overrideAgents',
    message: 'Select agents whose model you want to change',
    choices: agentNames().map((name) => ({ title: name, value: name })),
    hint: 'Space to toggle, Enter to confirm',
  });

  const modelMap = { ...baseMap };

  if (overrideAgents && overrideAgents.length > 0) {
    const catalog = getModelCatalog(provider);
    const choices = buildModelChoices(catalog);

    for (const agent of overrideAgents) {
      const { model } = await prompts({
        type: 'select',
        name: 'model',
        message: `Model for ${agent}`,
        choices,
        initial: 0,
      });

      if (model === CUSTOM_SENTINEL) {
        const { custom } = await prompts({
          type: 'text',
          name: 'custom',
          message: `Custom model for ${agent}`,
          initial: baseMap[agent],
        });
        if (custom) modelMap[agent] = custom.trim();
      } else if (model) {
        modelMap[agent] = model;
      }
    }
  }

  return { provider, modelMap, customized: true };
}

async function chooseProvider(platform, cliProvider) {
  if (cliProvider) {
    const normalized = normalizeProvider(cliProvider);
    if (platform === PLATFORM_OPENCODE || normalized === PROVIDER_COPILOT) {
      return normalized;
    }
  }

  if (platform === PLATFORM_COPILOT) {
    return PROVIDER_COPILOT;
  }

  const { provider } = await prompts({
    type: 'select',
    name: 'provider',
    message: 'OpenCode model provider',
    choices: [
      {
        title: providerLabel(PROVIDER_ZEN),
        value: PROVIDER_ZEN,
        description: 'Curated, tested models via OpenCode Zen',
      },
      {
        title: 'OpenCode Go',
        value: 'opencode-go',
        description: 'Low-cost open-coding model subscription',
      },
    ],
    initial: 0,
  });

  if (!provider) {
    throw new Error('Provider selection cancelled. Nothing was written.');
  }

  return provider;
}

function buildModelChoices(catalog) {
  const choices = catalog.map((id) => ({ title: id, value: id }));
  choices.push({ title: kleur.dim('Type custom model...'), value: CUSTOM_SENTINEL });
  return choices;
}
