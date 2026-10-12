import kleur from 'kleur';
import { existsSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../util/log.mjs';
import { mergeBlock } from '../util/merge.mjs';
import { templatePath } from '../util/fs.mjs';
import { detectPlatform } from '../util/platforms.mjs';

export const JEVR_STATUS =
  'real Jev when a credential resolves (OpenCode Zen free model jev-1.13-free, or TypeSafe jev-1.13.0); local heuristic otherwise; session hooks off by default (opt in with CLI_FIVE_JEVR_HOOKS=1 or .opencode/jev.json "hooks": true)';
export const JEVR_TOOL = 'tier_classifier';
export const TEST_GATE_ISSUE = 'https://github.com/idusortus/cli-five/issues';

const PLUGIN_REL = join('.opencode', 'plugin', 'jev-tier-router');
const PLUGIN_FILES = ['package.json', 'index.js', 'auth.mjs'];

// README plan symbols: + created, ~ updated, = unchanged, . skipped.
const ACTION_SYMBOL = { created: '+', updated: '~', unchanged: '=', skipped: '.' };

/**
 * `add jev` — tier-routing only.
 *
 * Ships a tier-classification tool for the Planner. Does NOT wire the
 * test-gate (parked: OpenCode plugin hooks don't fire under OpenChamber's
 * embedded-server routing). The classifier uses real Jev when a credential is
 * available (OpenCode Zen first, TypeSafe optional) and falls back to the local
 * heuristic otherwise.
 *
 * Safe to re-run: shipped plugin files are copied only when absent (or when
 * `--force` is passed), and `--dry-run` computes and prints the plan without
 * writing anything.
 */
export async function runJev({ cwd, args = {} }) {
  const platform = detectPlatform(cwd);

  if (platform !== 'opencode') {
    log.err('jev is OpenCode-only. No tools.add-equivalent surface exists for Copilot.');
    log.dim('Re-run init with --target opencode, then `npx cli-five add jev`.');
    process.exitCode = 1;
    return;
  }

  const dryRun = Boolean(args.dryRun);
  const force = Boolean(args.force);
  const plan = [];

  // 1. Plugin directory (package.json + index.js + auth.mjs), confirmed convention.
  const pluginDir = join(cwd, PLUGIN_REL);
  if (!dryRun) mkdirSync(pluginDir, { recursive: true });
  let pluginChanged = false;
  for (const file of PLUGIN_FILES) {
    const src = templatePath('opencode', 'plugin', 'jev-tier-router', file);
    const dest = join(pluginDir, file);
    // Clobber guard: a re-run preserves user-tuned files unless --force.
    const action = existsSync(dest) ? (force ? 'updated' : 'skipped') : 'created';
    if (!dryRun && action !== 'skipped') {
      cpSync(src, dest);
      pluginChanged = true;
    }
    plan.push({ path: dest, action });
  }

  // 2. Register the plugin path in opencode.json's `plugins` array.
  //    mergeBlock deep-merges JSON but replaces arrays, so read the existing
  //    array, union it, and hand the unioned value to mergeBlock (single
  //    write path — no second merge approach).
  const opencodePath = join(cwd, 'opencode.json');
  const agentsPath = join(cwd, 'AGENTS.md');
  let mergeError = false;
  let opencodeResult = null;

  try {
    const plugins = readPlugins(opencodePath);
    const pluginRef = toPosix(PLUGIN_REL);
    if (!plugins.includes(pluginRef)) plugins.push(pluginRef);
    opencodeResult = mergeBlock(opencodePath, 'jev', { plugins }, { track: true, metaKey: '$cliFive', dryRun });
    plan.push(opencodeResult);
  } catch (err) {
    mergeError = true;
    log.warn(`Skipped opencode.json: ${err.message}`);
    log.dim('Fix the file, then re-run `npx cli-five add jev`.');
    process.exitCode = 1;
  }

  // 3. Planner instruction in AGENTS.md (fenced block, idempotent).
  let agentsResult = null;
  try {
    agentsResult = mergeBlock(agentsPath, 'jev-tier-routing', plannerInstruction(), { dryRun });
    plan.push(agentsResult);
  } catch (err) {
    mergeError = true;
    log.warn(`Skipped AGENTS.md: ${err.message}`);
    log.dim('Fix the file, then re-run `npx cli-five add jev`.');
    process.exitCode = 1;
  }

  printPlan(plan, cwd, dryRun);
  if (dryRun) return;

  // Only report success for work actually done this run: a re-run that preserves
  // existing files leaves the `= unchanged` / `. skipped` plan lines above and
  // reports the honest state instead of a false "written".
  const changed = (result) => Boolean(result) && (result.action === 'created' || result.action === 'updated');
  const anyChange = pluginChanged || changed(opencodeResult) || changed(agentsResult);

  log.raw('');
  if (pluginChanged) log.ok(`Plugin written to ${kleur.bold(toPosix(PLUGIN_REL))}`);
  if (changed(opencodeResult)) log.ok('Registered in opencode.json (plugins[])');
  if (changed(agentsResult)) log.ok('Planner instruction added to AGENTS.md');
  if (!anyChange && !mergeError) log.dim('Already up to date — nothing to write.');
  log.raw('');
  log.info(`Tool: ${kleur.bold(JEVR_TOOL)} (tier-routing only)`);
  log.warn('Status: ' + JEVR_STATUS);
  log.dim(`Test-gate is parked — see ${TEST_GATE_ISSUE}`);
}

function printPlan(entries, cwd, dryRun) {
  if (dryRun) log.warn('--dry-run: no files written. Plan:');
  for (const entry of entries) {
    const rel = toPosix(entry.path.replace(cwd + '/', '').replace(cwd + '\\', ''));
    log.raw(`  ${ACTION_SYMBOL[entry.action] || '?'} ${rel} ${kleur.dim(`(${entry.action})`)}`);
  }
}

function plannerInstruction() {
  return `## Tier routing

Before planning, call the \`${JEVR_TOOL}\` tool once with the task description.

- If it returns \`confidence\` >= 0.6, use its \`tier\` (trivial | minor | major) as your planning depth.
- If \`confidence\` < 0.6, or the tool is unavailable, use your own judgment and default to \`major\`.
- The classifier is optional: it uses real Jev when a credential is available (Jev is free on OpenCode) and a local heuristic otherwise. Never block or fail a turn because the tool is unavailable.
- Session hooks (deterministic admission-time routing) are **off by default**. Opt in with \`CLI_FIVE_JEVR_HOOKS=1\` or \`"hooks": true\` in \`.opencode/jev.json\`.`;
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

export const __testables = { plannerInstruction, readPlugins, detectPlatform, PLUGIN_FILES };
