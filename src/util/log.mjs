import kleur from 'kleur';

export const log = {
  info: (msg) => process.stdout.write(`${kleur.cyan('●')} ${msg}\n`),
  ok: (msg) => process.stdout.write(`${kleur.green('✓')} ${msg}\n`),
  warn: (msg) => process.stdout.write(`${kleur.yellow('!')} ${msg}\n`),
  err: (msg) => process.stderr.write(`${kleur.red('✗')} ${msg}\n`),
  step: (msg) => process.stdout.write(`\n${kleur.bold().magenta('▸')} ${kleur.bold(msg)}\n`),
  dim: (msg) => process.stdout.write(`${kleur.gray(msg)}\n`),
  raw: (msg) => process.stdout.write(`${msg}\n`),
};
