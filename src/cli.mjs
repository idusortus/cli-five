import kleur from 'kleur';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { init } from './commands/init.mjs';
import { doctor } from './commands/doctor.mjs';
import { listStacks } from './commands/list-stacks.mjs';
import { add } from './commands/add.mjs';
import { listAddonsCommand } from './commands/list-addons.mjs';
import { STACK_SIGNATURES } from './steps/detect.mjs';

const HELP = `${kleur.bold('cli-five')} ${kleur.gray('— Code Like I\'m Five')}
Scaffold a 5-agent AI team into any repo.

${kleur.bold('Usage')}
  npx cli-five <command> [options]

${kleur.bold('Commands')}
  init            Scaffold the 5 agents + required tooling (minimal by default)
  add <name>      Install an optional add-on (dispatcher; targets land later)
  list-addons     Show installed vs. available add-ons
  doctor          Validate an existing cli-five setup
  list-stacks     Show detectable tech stacks
  help            Show this message

${kleur.bold('Flags')}
  --yes, -y       Accept defaults and skip confirmations (still gated on overwrite)
  --force         Overwrite without confirmation. Dangerous. Use with --yes.
  --dry-run       Print actions without writing files
  --full-interview Run the full legacy interview (docs, goals, persona, models). Enables CodeGraph by default
  --skills        Force skill discovery (default: full interview only)
  --no-skills     Skip the skills.sh discovery step
  --instructions  Force stack-specific instruction generation
  --no-instructions Skip instruction generation
  --persona       Include the snarky persona block
  --no-persona    Omit the snarky persona block
  --codegraph     Add CodeGraph MCP + instructions (default: only with --full-interview)
  --no-codegraph  Skip CodeGraph MCP + instructions
  --doc <file>    Read project docs to pre-fill interview (repeatable; implies --full-interview)
  --cost-mode <m> Override cost mode (premium, cheap, mixed) — skips interview question
  --target <t>    Target platform: copilot or opencode (default: copilot)
  --provider <p>  Model provider: copilot, opencode, opencode-go (default: platform default)
  --cwd <path>    Run against a directory other than the current one
  --version, -v   Print version and exit
`;

export async function run(argv) {
  const args = parse(argv);
  const cmd = args._[0] || 'help';

  switch (cmd) {
    case 'init':
      return init(args);
    case 'add':
      return add(args);
    case 'list-addons':
      return listAddonsCommand(args);
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
    fullInterview: false,
    skills: null,
    instructions: null,
    persona: null,
    codegraph: null,
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
    else if (a === '--full-interview' || a === '--full') out.fullInterview = true;
    else if (a === '--skills') out.skills = true;
    else if (a === '--no-skills') out.skills = false;
    else if (a === '--instructions') out.instructions = true;
    else if (a === '--no-instructions') out.instructions = false;
    else if (a === '--persona') out.persona = true;
    else if (a === '--no-persona') out.persona = false;
    else if (a === '--codegraph') out.codegraph = true;
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
