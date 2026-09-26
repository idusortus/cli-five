import kleur from 'kleur';
import prompts from 'prompts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLATFORM_COPILOT,
  PLATFORM_OPENCODE,
  PLATFORMS,
  platformLabel,
} from '../util/platforms.mjs';
import { log } from '../util/log.mjs';
import { detectAuthenticatedProviders, preferredProviderForAuth } from '../util/auth.mjs';
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
 * Resolve whether CodeGraph should be enabled when no explicit `--codegraph`
 * / `--no-codegraph` value was passed.
 *
 * The registration/opt-out mechanism is unchanged — this only decides the
 * default: on for the full interview, off for minimal init.
 */
export function resolveCodegraphDefault(args, fullInterview) {
  if (args.codegraph === true || args.codegraph === false) return args.codegraph;
  return Boolean(fullInterview);
}

/**
 * Ask the user to choose a target platform.
 * If args.target is a valid platform, skip the prompt.
 *
 * Options:
 *   autoDetect   — infer the platform from an existing scaffold before prompting
 *   askCodegraph — whether to ask the CodeGraph opt-out question (full interview)
 *   codegraphDefault — resolved default when no explicit flag was passed
 *
 * Note: CodeGraph registration and the `--no-codegraph` opt-out are unchanged;
 * this only controls whether the question is asked / what the default is.
 */
export async function choosePlatform(args, { autoDetect = false, askCodegraph = true, codegraphDefault } = {}) {
  if (codegraphDefault === undefined) codegraphDefault = args.codegraph !== false;

  if (args.target) {
    const t = String(args.target).toLowerCase();
    if (PLATFORMS.includes(t)) {
      return { platform: t, codegraph: codegraphDefault };
    }
  }

  if (autoDetect) {
    const existing = detectExistingPlatform(args.cwd);
    if (existing) {
      log.dim(`Detected existing ${platformLabel(existing)} scaffold.`);
      return { platform: existing, codegraph: codegraphDefault };
    }
  }

  if (args.yes) {
    return { platform: PLATFORM_COPILOT, codegraph: codegraphDefault };
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

  if (!askCodegraph) {
    return { platform, codegraph: codegraphDefault };
  }

  const { codegraph } = await prompts({
    type: 'confirm',
    name: 'codegraph',
    message: `Add CodeGraph MCP + instructions for ${platformLabel(platform)}?`,
    initial: true,
  });

  return { platform, codegraph: codegraph !== false };
}

/** Infer an existing scaffold's platform, or null when there is no scaffold. */
export function detectExistingPlatform(cwd) {
  if (existsSync(join(cwd, '.opencode', 'agents'))) return PLATFORM_OPENCODE;
  if (existsSync(join(cwd, '.github', 'agents', 'orchestrator.agent.md'))) return PLATFORM_COPILOT;
  return null;
}

/**
 * Ask the user whether to customize models, pick a provider, and optionally
 * override per-agent models.
 */
export async function chooseModels(platform, args) {
  // Defaults for the platform, refined by what the user is actually authed for.
  const authedProvider = platform === PLATFORM_OPENCODE && !args.provider
    ? preferredProviderForAuth(platform)
    : null;
  const defaultProvider = providerForPlatform(platform, args.provider || authedProvider);
  const defaults = getDefaultModelMap(defaultProvider);

  if (authedProvider && authedProvider !== PROVIDER_ZEN) {
    log.dim(`Detected authenticated OpenCode provider: ${providerLabel(authedProvider)} (using it instead of the ${providerLabel(PROVIDER_ZEN)} default).`);
  }

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

  const authed = detectAuthenticatedProviders();
  const isAuthed = (p) => authed.includes(p);
  const annotate = (p, label, description) => ({
    title: isAuthed(p) ? `${label} ${kleur.green('(authenticated)')}` : label,
    value: p,
    description,
  });

  const choices = [
    annotate(PROVIDER_ZEN, providerLabel(PROVIDER_ZEN), 'Curated, tested models via OpenCode Zen'),
    annotate(PROVIDER_GO, 'OpenCode Go', 'Low-cost open-coding model subscription'),
  ];
  // Put an authenticated provider first so the default is one that works.
  const initial = Math.max(0, choices.findIndex((c) => isAuthed(c.value)));

  const { provider } = await prompts({
    type: 'select',
    name: 'provider',
    message: 'OpenCode model provider',
    choices,
    initial,
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
