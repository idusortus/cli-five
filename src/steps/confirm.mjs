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

  const first = await prompts({
    type: 'confirm',
    name: 'ok',
    message: 'This will OVERWRITE the files above. Proceed?',
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
  return out;
}
