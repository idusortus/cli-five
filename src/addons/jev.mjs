import kleur from 'kleur';
import { existsSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../util/log.mjs';
import { mergeBlock } from '../util/merge.mjs';
import { templatePath } from '../util/fs.mjs';
import { detectPlatform } from '../util/platforms.mjs';

export const JEVR_STATUS =
  'real Jev when a credential resolves (OpenCode Zen free model jev-1.13-free, or TypeSafe jev-1.13.0); local heuristic otherwise';
export const JEVR_TOOL = 'tier_classifier';
export const TEST_GATE_ISSUE = 'https://github.com/idusortus/cli-five/issues';

const PLUGIN_REL = join('.opencode', 'plugin', 'jev-tier-router');

/**
 * `add jev` — tier-routing only.
 *
 * Ships a tier-classification tool for the Planner. Does NOT wire the
 * test-gate (parked: OpenCode plugin hooks don't fire under OpenChamber's
 * embedded-server routing). The classifier uses real Jev when a credential is
 * available (OpenCode Zen first, TypeSafe optional) and falls back to the local
 * heuristic otherwise.
 */
export async function runJev({ cwd }) {
  const platform = detectPlatform(cwd);

  if (platform !== 'opencode') {
    log.err('jev is OpenCode-only. No tools.add-equivalent surface exists for Copilot.');
    log.dim('Re-run init with --target opencode, then `npx cli-five add jev`.');
    process.exitCode = 1;
    return;
  }

  const written = [];

  // 1. Plugin directory (package.json + index.js), confirmed convention.
  const pluginDir = join(cwd, PLUGIN_REL);
  mkdirSync(pluginDir, { recursive: true });
  for (const file of ['package.json', 'index.js']) {
    const src = templatePath('opencode', 'plugin', 'jev-tier-router', file);
    const dest = join(pluginDir, file);
    cpSync(src, dest);
    written.push({ path: dest, written: true });
  }

  // 2. Register the plugin path in opencode.json's `plugins` array.
  //    mergeBlock deep-merges JSON but replaces arrays, so read the existing
  //    array, union it, and hand the unioned value to mergeBlock (single
  //    write path — no second merge approach).
  const opencodePath = join(cwd, 'opencode.json');
  const plugins = readPlugins(opencodePath);
  const pluginRef = toPosix(PLUGIN_REL);
  if (!plugins.includes(pluginRef)) plugins.push(pluginRef);
  mergeBlock(opencodePath, 'jev', { plugins }, { track: true, metaKey: '$cliFive' });

  // 3. Planner instruction in AGENTS.md (fenced block, idempotent).
  const agentsPath = join(cwd, 'AGENTS.md');
  mergeBlock(agentsPath, 'jev-tier-routing', plannerInstruction());

  log.ok(`Plugin written to ${kleur.bold(toPosix(PLUGIN_REL))}`);
  log.ok(`Registered in opencode.json (plugins[])`);
  log.ok('Planner instruction added to AGENTS.md');
  log.raw('');
  log.info(`Tool: ${kleur.bold(JEVR_TOOL)} (tier-routing only)`);
  log.warn('Status: ' + JEVR_STATUS);
  log.dim(`Test-gate is parked — see ${TEST_GATE_ISSUE}`);
}

function plannerInstruction() {
  return `## Tier routing

Before planning, call the \`${JEVR_TOOL}\` tool once with the task description.

- If it returns \`confidence\` >= 0.6, use its \`tier\` (trivial | minor | major) as your planning depth.
- If \`confidence\` < 0.6, or the tool is unavailable, use your own judgment and default to \`major\`.
- The classifier is optional: it uses real Jev when a credential is available (Jev is free on OpenCode) and a local heuristic otherwise. Never block or fail a turn because the tool is unavailable.`;
}

function readPlugins(opencodePath) {
  if (!existsSync(opencodePath)) return [];
  try {
    const cfg = JSON.parse(readFileSync(opencodePath, 'utf8'));
    return Array.isArray(cfg.plugins) ? [...cfg.plugins] : [];
  } catch {
    return [];
  }
}

function toPosix(p) {
  return p.split('\\').join('/');
}

export const __testables = { plannerInstruction, readPlugins, detectPlatform };
