import prompts from 'prompts';
import { log } from '../util/log.mjs';

export async function confirmOverwriteIfNeeded(detected, args) {
  const collisions = collideList(detected);
  if (collisions.length === 0) return true;

  log.warn('Existing cli-five artifacts detected:');
  for (const c of collisions) log.dim(`    - ${c}`);

  if (args.force && args.yes) {
    log.warn('--force --yes set. Overwriting without prompts. Hope you have git.');
    return true;
  }

  // Non-interactive: keep what's there and only add missing files. This makes
  // `init --yes` safe to re-run (and it can no longer hang on a prompt).
  if (args.yes) {
    log.info('--yes set: keeping existing files; only missing files are written.');
    log.dim('Use --force to overwrite, or omit --yes to be asked.');
    return true;
  }

  const first = await prompts({
    type: 'confirm',
    name: 'ok',
    message: 'This may OVERWRITE the files above. Proceed?',
    initial: false,
  });
  if (!first.ok) return false;

  const second = await prompts({
    type: 'confirm',
    name: 'sure',
    message: 'R U Sure? Last chance.',
    initial: false,
  });
  return Boolean(second.sure);
}

function collideList(detected) {
  const out = [];
  if (detected.hasAgents) out.push('.github/agents/');
  if (detected.hasCopilotInstructions) out.push('.github/copilot-instructions.md');
  if (detected.hasOpencodeAgents) out.push('.opencode/agents/');
  if (detected.hasOpencodeConfig) out.push('opencode.json');
  return out;
}
