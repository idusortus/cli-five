import kleur from 'kleur';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { init } from './commands/init.mjs';
import { doctor } from './commands/doctor.mjs';
import { listStacks } from './commands/list-stacks.mjs';
import { STACK_SIGNATURES } from './steps/detect.mjs';

const HELP = `${kleur.bold('cli-five')} ${kleur.gray('— Code Like I\'m Five')}
Scaffold a 5-agent AI team into any repo.

${kleur.bold('Usage')}
  npx cli-five <command> [options]

${kleur.bold('Commands')}
  init            Interview + scaffold agents + project memory files
  doctor          Validate an existing cli-five setup
  list-stacks     Show detectable tech stacks
  help            Show this message

${kleur.bold('Flags')}
  --yes, -y       Accept defaults and skip confirmations (still gated on overwrite)
  --force         Overwrite without confirmation. Dangerous. Use with --yes.
  --dry-run       Print actions without writing files
  --no-skills     Skip the skills.sh discovery step
  --doc <file>    Read project docs to pre-fill interview (repeatable)
  --cost-mode <m> Override cost mode (premium, cheap, mixed) — skips interview question
  --target <t>    Target platform: copilot or opencode (default: copilot)
  --provider <p>  Model provider: copilot, opencode, opencode-go (default: platform default)
  --no-codegraph  Skip CodeGraph MCP + instructions
  --cwd <path>    Run against a directory other than the current one
  --version, -v   Print version and exit
`;

export async function run(argv) {
  const args = parse(argv);
  const cmd = args._[0] || 'help';

  switch (cmd) {
    case 'init':
      return init(args);
    case 'doctor':
      return doctor(args);
    case 'list-stacks':
      return listStacks();
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;
    case '--version':
    case '-v': {
      const pkg = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'package.json'), 'utf8'));
      process.stdout.write(`cli-five v${pkg.version}\n`);
      return;
    }
    default:
      process.stderr.write(kleur.red(`Unknown command: ${cmd}\n\n`));
      process.stdout.write(HELP);
      process.exit(2);
  }
}

function parse(argv) {
  const out = {
    _: [],
    yes: false,
    force: false,
    dryRun: false,
    skills: true,
    codegraph: true,
    docs: [],
    costMode: null,
    target: null,
    provider: null,
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-skills') out.skills = false;
    else if (a === '--no-codegraph') out.codegraph = false;
    else if (a === '--doc') out.docs.push(argv[++i]);
    else if (a === '--cost-mode') out.costMode = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--provider') out.provider = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--help' || a === '-h') out._.push('help');
    else if (a === '--version' || a === '-v') out._.push('--version');
    else out._.push(a);
  }
  return out;
}
