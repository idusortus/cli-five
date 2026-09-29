import kleur from 'kleur';
import { log } from '../util/log.mjs';
import { detectAddon, listAddons } from '../addons/registry.mjs';

/**
 * `cli-five list-addons` — show what is installed vs. available.
 *
 * "Installed" is detected read-only from workspace artifacts. Status text is
 * deliberately honest: an add-on that ships partial capability (e.g. jev's
 * tier-routing without the parked test-gate) must not read as fully installed.
 */
export function listAddonsCommand(args) {
  const cwd = args.cwd;
  log.raw(kleur.bold().magenta('\ncli-five list-addons') + kleur.gray(`  ${cwd}`));
  log.raw('');

  const rows = listAddons().map((addon) => {
    const signals = detectAddon(addon, cwd);
    const installed = signals.length > 0;
    const addable = typeof addon.run === 'function';

    // An installed add-on with a `capability` note is partial — say so.
    const statusLabel = installed
      ? (addon.capability ? `installed (${addon.capability})` : 'installed')
      : 'not found';

    const detail = installed
      ? [addon.status || signals.join(', ')].filter(Boolean).join(' — ')
      : addon.note || addon.status || '';

    return { addon, installed, addable, statusLabel, detail };
  });

  // Size the status column to the longest label so the DETAIL column stays aligned.
  const statusWidth = Math.max(14, ...rows.map((r) => r.statusLabel.length));
  log.raw(`  ${kleur.gray(pad('ADD-ON', 12))} ${kleur.gray(pad('STATUS', statusWidth))} ${kleur.gray(pad('ADD', 10))} ${kleur.gray('DETAIL')}`);
  log.raw(`  ${'─'.repeat(12)} ${'─'.repeat(statusWidth)} ${'─'.repeat(10)} ${'─'.repeat(30)}`);

  for (const { addon, installed, addable, statusLabel, detail } of rows) {
    const statusText = pad(statusLabel, statusWidth);
    const status = installed ? kleur.green(statusText) : kleur.gray(statusText);
    const addableText = pad(addable ? 'available' : 'planned', 10);
    const addableColored = addable ? kleur.green(addableText) : kleur.yellow(addableText);

    log.raw(`  ${pad(addon.name, 12)} ${status} ${addableColored} ${kleur.dim(detail)}`);
  }

  log.raw('');
  log.dim('Install with `npx cli-five add <name>`.');
  log.raw('');
}

function pad(value, width) {
  return String(value).padEnd(width);
}
