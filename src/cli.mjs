import kleur from 'kleur';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { init } from './commands/init.mjs';
import { doctor } from './commands/doctor.mjs';
import { listStacks } from './commands/list-stacks.mjs';
import { add } from './commands/add.mjs';
import { listAddonsCommand } from './commands/list-addons.mjs';
import { PLATFORMS } from './util/platforms.mjs';
import { PROVIDERS } from './util/models.mjs';

const COST_MODES = ['premium', 'cheap', 'mixed'];

// Flags that consume the following token as their value.
const VALUE_FLAGS = new Set(['--doc', '--cost-mode', '--target', '--provider', '--cwd']);
// Closed value sets (flag → canonical allowed values), validated case-insensitively.
const ENUM_FLAGS = { '--cost-mode': COST_MODES, '--target': PLATFORMS, '--provider': PROVIDERS };
// Extra accepted spellings (case-insensitive) that are not canonical values.
// `--provider` accepts the `normalizeProvider` aliases in src/util/models.mjs.
const ENUM_ALIASES = { '--provider': ['zen', 'go', 'github-copilot'] };

const HELP = `${kleur.bold('cli-five')} ${kleur.gray('— Code Like I\'m Five')}
Scaffold a 5-agent AI team into any repo.

${kleur.bold('Usage')}
  npx cli-five <command> [options]

${kleur.bold('Commands')}
  init            Scaffold the 5 agents + required tooling (minimal by default)
  add <name>      Install an optional add-on
  list-addons     Show installed vs. available add-ons
  doctor          Validate an existing cli-five setup
  list-stacks     Show detectable tech stacks
  help            Show this message

${kleur.bold('Flags')}
  --yes, -y       Accept defaults and skip confirmations (keeps existing files — the create policy)
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

  // A parse error is reported before any command dispatches (exit code 2).
  if (args.error) {
    process.stderr.write(kleur.red(`Error: ${args.error}\n\n`));
    process.stdout.write(HELP);
    process.exitCode = 2;
    return;
  }

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
    error: null,
  };
  // Record the first parse error only, so the most specific failure survives.
  const fail = (message) => {
    if (!out.error) out.error = message;
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
    else if (VALUE_FLAGS.has(a)) {
      const value = argv[i + 1];
      // A missing value (end of args) or another flag is an error, not a value.
      if (value === undefined || value.startsWith('-')) {
        fail(`${a} requires a value`);
        continue;
      }
      i += 1;
      applyValue(out, a, value, fail);
    }
    else if (a === '--help' || a === '-h') out._.push('help');
    else if (a === '--version' || a === '-v') out._.push('--version');
    else out._.push(a);
  }
  return out;
}

/** Assign a value-taking flag, validating enum flags and recording failures. */
function applyValue(out, flag, value, fail) {
  if (flag === '--doc') {
    out.docs.push(value);
    return;
  }
  const allowed = ENUM_FLAGS[flag];
  const normalized = allowed ? matchEnum(flag, allowed, value) : value;
  if (allowed && normalized === null) {
    fail(`${flag} "${value}" is not supported (valid: ${allowed.join(', ')})`);
    return;
  }
  if (flag === '--cost-mode') out.costMode = normalized;
  else if (flag === '--target') out.target = normalized;
  else if (flag === '--provider') out.provider = normalized;
  else if (flag === '--cwd') out.cwd = value;
}

/**
 * Case-insensitive enum match. Returns the lowercased value when it is a
 * canonical value or a documented alias, else `null`.
 */
function matchEnum(flag, allowed, value) {
  const lower = String(value).toLowerCase();
  if (allowed.includes(lower)) return lower;
  return (ENUM_ALIASES[flag] || []).includes(lower) ? lower : null;
}

export const __testables = { parse };
