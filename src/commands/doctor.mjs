import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import kleur from 'kleur';
import { log } from '../util/log.mjs';
import {
  AGENT_FILES,
  OPENCODE_AGENT_FILES,
  validateAgentSource,
  validateOpenCodeAgentSource,
} from '../util/agents.mjs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../util/platforms.mjs';

const COPILOT_REQUIRED = [
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

const OPENCODE_REQUIRED = [
  'opencode.json',
  '.opencode/agents/orchestrator.md',
  '.opencode/agents/planner.md',
  '.opencode/agents/coder.md',
  '.opencode/agents/designer.md',
  '.opencode/agents/reviewer.md',
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
  const platform = detectPlatform(cwd);
  log.raw(kleur.bold().magenta('\ncli-five doctor') + kleur.gray(`  ${cwd}`));
  log.info(`Detected platform: ${kleur.bold(platform)}`);
  let fail = 0;

  const required = platform === PLATFORM_OPENCODE ? OPENCODE_REQUIRED : COPILOT_REQUIRED;

  log.step('Required');
  for (const p of required) {
    const ok = existsSync(join(cwd, p));
    if (ok) log.ok(p);
    else {
      log.err(p);
      fail++;
    }
  }

  log.step('Agent integrity');
  if (platform === PLATFORM_OPENCODE) {
    for (const file of OPENCODE_AGENT_FILES) {
      const relPath = join('.opencode', 'agents', file);
      const fullPath = join(cwd, relPath);
      if (!existsSync(fullPath)) continue;

      const errors = validateOpenCodeAgentSource(readFileSync(fullPath, 'utf8'), file);
      if (errors.length === 0) {
        log.ok(relPath);
        continue;
      }

      log.err(relPath);
      for (const error of errors) {
        log.raw(kleur.red(`  - ${error}`));
      }
      fail++;
    }
  } else {
    for (const file of AGENT_FILES) {
      const relPath = join('.github', 'agents', file);
      const fullPath = join(cwd, relPath);
      if (!existsSync(fullPath)) continue;

      const errors = validateAgentSource(readFileSync(fullPath, 'utf8'), file);
      if (errors.length === 0) {
        log.ok(relPath);
        continue;
      }

      log.err(relPath);
      for (const error of errors) {
        log.raw(kleur.red(`  - ${error}`));
      }
      fail++;
    }
  }

  if (platform === PLATFORM_OPENCODE) {
    log.step('OpenCode config');
    const opencodePath = join(cwd, 'opencode.json');
    if (existsSync(opencodePath)) {
      try {
        const cfg = JSON.parse(readFileSync(opencodePath, 'utf8'));
        if (cfg.mcp?.codegraph) {
          log.ok('opencode.json has CodeGraph MCP entry');
        } else {
          log.warn('opencode.json missing CodeGraph MCP entry (ok if CodeGraph disabled)');
        }
      } catch (err) {
        log.err(`opencode.json is not valid JSON: ${err.message}`);
        fail++;
      }
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

function detectPlatform(cwd) {
  if (existsSync(join(cwd, '.opencode', 'agents'))) return PLATFORM_OPENCODE;
  if (existsSync(join(cwd, '.github', 'agents', 'orchestrator.agent.md'))) return PLATFORM_COPILOT;
  return PLATFORM_COPILOT;
}
