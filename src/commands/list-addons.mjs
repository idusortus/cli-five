import kleur from 'kleur';
import { log } from '../util/log.mjs';
import { detectAddon, listAddons } from '../addons/registry.mjs';

/**
 * `cli-five list-addons` — show what is installed vs. available.
 *
 * "Installed" is detected read-only from workspace artifacts. CodeGraph is
 * listed honestly even though its `add` plumbing has not moved yet.
 */
export function listAddonsCommand(args) {
  const cwd = args.cwd;
  log.raw(kleur.bold().magenta('\ncli-five list-addons') + kleur.gray(`  ${cwd}`));
  log.raw('');

  log.raw(`  ${kleur.gray(pad('ADD-ON', 12))} ${kleur.gray(pad('STATUS', 12))} ${kleur.gray(pad('ADD', 10))} ${kleur.gray('DETAIL')}`);
  log.raw(`  ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(30)}`);

  for (const addon of listAddons()) {
    const signals = detectAddon(addon, cwd);
    const installed = signals.length > 0;
    const addable = typeof addon.run === 'function';
    const detail = installed ? signals.join(', ') : addon.note || '';

    const statusText = pad(installed ? 'installed' : 'not found', 12);
    const status = installed ? kleur.green(statusText) : kleur.gray(statusText);
    const addableText = pad(addable ? 'available' : 'planned', 10);
    const addableColored = addable ? kleur.green(addableText) : kleur.yellow(addableText);

    log.raw(`  ${pad(addon.name, 12)} ${status} ${addableColored} ${kleur.dim(detail)}`);
  }

  log.raw('');
  log.dim('Install with `npx cli-five add <name>` once a target is available.');
  log.raw('');
}

function pad(value, width) {
  return String(value).padEnd(width);
}
