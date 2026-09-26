import kleur from 'kleur';
import { log } from '../util/log.mjs';
import { ADDON_NAMES, getAddon, listAddons } from '../addons/registry.mjs';

/**
 * `cli-five add <name>` — dispatch to a registered add-on.
 *
 * This pass ships the dispatcher only. Registered targets without a `run`
 * function respond with a clear stub so the mechanism can be exercised
 * end-to-end without pretending an integration exists.
 */
export async function add(args) {
  const name = args._[1];

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printAddHelp();
    return;
  }

  const addon = getAddon(name);
  if (!addon) {
    log.err(`Unknown add-on: ${name}`);
    printAvailable(addon => addon.name);
    process.exitCode = 2;
    return;
  }

  if (typeof addon.run !== 'function') {
    log.warn(`${addon.label} is registered but not implemented yet.`);
    log.info('The add dispatcher works — this target is reserved for a future release.');
    if (addon.note || addon.status) log.dim(addon.note || addon.status);
    log.dim('Nothing was written to your project.');
    return;
  }

  log.step(`add ${addon.name}`);
  await addon.run({ cwd: args.cwd, args });
}

function printAddHelp() {
  process.stdout.write(`${kleur.bold('cli-five add')} — install an optional add-on\n\n`);
  process.stdout.write(`${kleur.bold('Usage')}\n  npx cli-five add <name>\n\n`);
  printAvailable();
}

function printAvailable() {
  process.stdout.write(`${kleur.bold('Available add-ons')}\n`);
  for (const addon of listAddons()) {
    const addable = typeof addon.run === 'function';
    const statusText = (addable ? 'available' : 'planned').padEnd(10);
    const status = addable ? kleur.green(statusText) : kleur.yellow(statusText);
    process.stdout.write(`  ${addon.name.padEnd(12)} ${status} ${kleur.dim(addon.description)}\n`);
  }
  process.stdout.write(`\n${kleur.dim(`Known names: ${ADDON_NAMES.join(', ')}`)}\n`);
}
