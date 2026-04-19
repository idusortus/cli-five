import { existsSync } from 'node:fs';
import { join } from 'node:path';
import kleur from 'kleur';
import { log } from '../util/log.mjs';

const REQUIRED = [
  '.github/copilot-instructions.md',
  '.github/agents/orchestrator.agent.md',
  '.github/agents/planner.agent.md',
  '.github/agents/coder.agent.md',
  '.github/agents/designer.agent.md',
  '.github/agents/reviewer.agent.md',
  'PROJECT.md',
  'STATE.md',
  'decisions.md',
  'agent-diary.md',
];

const OPTIONAL = [
  '.github/instructions',
  '.github/skills',
  'AGENTS.md',
  'histories/orchestrator.md',
];

export async function doctor(args) {
  const cwd = args.cwd;
  log.raw(kleur.bold().magenta('\ncli-five doctor') + kleur.gray(`  ${cwd}`));
  let fail = 0;

  log.step('Required');
  for (const p of REQUIRED) {
    const ok = existsSync(join(cwd, p));
    if (ok) log.ok(p);
    else {
      log.err(p);
      fail++;
    }
  }

  log.step('Optional');
  for (const p of OPTIONAL) {
    if (existsSync(join(cwd, p))) log.ok(p);
    else log.warn(`missing (ok): ${p}`);
  }

  log.raw('');
  if (fail === 0) {
    log.ok('All required files present.');
  } else {
    log.err(`${fail} required file(s) missing. Run \`npx cli-five init\`.`);
    process.exit(1);
  }
}
