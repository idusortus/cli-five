import { join } from 'node:path';
import { log } from '../util/log.mjs';
import { readTemplate, render, writeFile, listFilesRecursive, relTo, templatePath } from '../util/fs.mjs';
import { readFileSync } from 'node:fs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE, agentDirFor, agentFileFor } from '../util/platforms.mjs';
import { addCodegraphTo } from '../addons/codegraph.mjs';

const AGENT_NAMES = ['orchestrator', 'planner', 'coder', 'designer', 'reviewer'];
const HISTORY_FILES = ['orchestrator.md', 'planner.md', 'coder.md', 'designer.md', 'reviewer.md'];

// Legacy cost-mode maps for GitHub Copilot (used when models are not customized).
const COPILOT_COST_MODE_MAP = {
  premium: {
    Orchestrator: 'Claude Sonnet 4.6 (copilot)',
    Planner: 'Claude Opus 4.6 (copilot)',
    Coder: 'GPT-5.3-Codex (copilot)',
    Designer: 'Claude Opus 4.6 (copilot)',
    Reviewer: 'Claude Opus 4.6 (copilot)',
  },
  cheap: {
    Orchestrator: 'GPT-4.1 (copilot)',
    Planner: 'GPT-4o (copilot)',
    Coder: 'GPT-4.1 (copilot)',
    Designer: 'GPT-4o (copilot)',
    Reviewer: 'GPT-5 mini (copilot)',
  },
  mixed: {
    Orchestrator: 'GPT-4.1 (copilot)',
    Planner: 'GPT-4o (copilot)',
    Coder: 'GPT-5.3-Codex (copilot)',
    Designer: 'GPT-4o (copilot)',
    Reviewer: 'Claude Opus 4.6 (copilot)',
  },
};

export function scaffold({ cwd, answers, args }) {
  const platform = answers.platform || PLATFORM_COPILOT;
  const vars = buildVars(answers);
  const written = [];

  if (platform === PLATFORM_OPENCODE) {
    written.push(...scaffoldOpenCode({ cwd, answers, args, vars }));
  } else {
    written.push(...scaffoldCopilot({ cwd, answers, args, vars }));
  }

  // Shared memory primitives
  // NOTE: AGENTS.md is written WITHOUT the CodeGraph block here. When CodeGraph
  // is enabled, the block is merged in afterward by addCodegraphTo() — the same
  // code path `add codegraph` uses (one implementation, two entry points).
  for (const tmpl of [
    'AGENTS.md.tmpl',
    'PROJECT.md.tmpl',
    'STATE.md.tmpl',
    'decisions.md.tmpl',
    'agent-diary.md.tmpl',
  ]) {
    const out = render(readTemplate(tmpl), vars);
    const target = tmpl.replace(/\.tmpl$/, '');
    written.push(writeFile(join(cwd, target), out, args));
  }

  // Per-agent histories
  for (const file of HISTORY_FILES) {
    written.push(writeFile(join(cwd, 'histories', file), readTemplate('histories', file), args));
  }

  // CodeGraph — delegated to the shared add codegraph implementation.
  if (answers.codegraph) {
    for (const t of addCodegraphTo({ cwd, platform, dryRun: args.dryRun })) {
      written.push({ path: t.path, written: !args.dryRun && t.action !== 'unchanged' });
    }
  }

  return written;
}

function scaffoldCopilot({ cwd, answers, args, vars }) {
  const written = [];
  const modelByAgent = answers.customizedModels
    ? answers.modelMap
    : COPILOT_COST_MODE_MAP[answers.costMode] || COPILOT_COST_MODE_MAP.premium;

  // Agents
  for (const file of AGENT_NAMES.map((n) => `${n}.agent.md`)) {
    const src = readFileSync(templatePath('.github', 'agents', file), 'utf8');
    const swapped = swapModel(src, modelByAgent);
    written.push(writeFile(join(cwd, '.github', 'agents', file), swapped, args));
  }

  // copilot-instructions.md
  const ci = render(readTemplate('.github', 'copilot-instructions.md.tmpl'), vars);
  written.push(writeFile(join(cwd, '.github', 'copilot-instructions.md'), ci, args));

  // Empty containers
  written.push(
    writeFile(
      join(cwd, '.github', 'instructions', 'README.md'),
      readTemplate('.github', 'instructions', 'README.md'),
      args,
    ),
  );
  written.push(
    writeFile(join(cwd, '.github', 'skills', 'README.md'), readTemplate('.github', 'skills', 'README.md'), args),
  );

  return written;
}

function scaffoldOpenCode({ cwd, answers, args, vars }) {
  const written = [];
  const modelByAgent = answers.modelMap || {};
  const orchestratorModel = modelByAgent.Orchestrator || 'opencode/gpt-5.3-codex';

  // Agents
  for (const name of AGENT_NAMES) {
    const src = readFileSync(templatePath('opencode', 'agents', `${name}.md`), 'utf8');
    const swapped = swapModel(src, modelByAgent);
    written.push(writeFile(join(cwd, '.opencode', 'agents', `${name}.md`), swapped, args));
  }

  // opencode.json
  const opencodeConfig = buildOpencodeConfig({ answers, orchestratorModel });
  written.push(writeFile(join(cwd, 'opencode.json'), JSON.stringify(opencodeConfig, null, 2) + '\n', args));

  // Empty containers (still useful for OpenCode agents)
  written.push(
    writeFile(
      join(cwd, '.github', 'instructions', 'README.md'),
      readTemplate('.github', 'instructions', 'README.md'),
      args,
    ),
  );
  written.push(
    writeFile(join(cwd, '.github', 'skills', 'README.md'), readTemplate('.github', 'skills', 'README.md'), args),
  );

  return written;
}

function buildOpencodeConfig({ answers, orchestratorModel }) {
  const smallModel = answers.provider === 'opencode-go'
    ? 'opencode-go/qwen3.8-flash'
    : 'opencode/gpt-5-nano';

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: orchestratorModel,
    small_model: smallModel,
    subagent_depth: 2,
  };

  return config;
}

function buildVars(a) {
  return {
    PROJECT_NAME: a.projectName,
    ONE_LINER: a.oneLiner || 'TODO — write a one-line vision statement.',
    STACK: a.stack.length ? a.stack.join(', ') : 'Not yet declared.',
    FRAMEWORKS: a.frameworks.length ? a.frameworks.join(', ') : 'None declared.',
    GOALS: a.goals || 'TODO — declare the primary goal.',
    CONSTRAINTS: a.constraints || 'None declared.',
    QUICKSTART: a.quickstart || 'TODO — add install + run commands here.',
    COST_MODE: a.costMode,
    DOCS_SECTION: a.docs ? `
## Source Documents

The following documents were provided via \`--doc\` at project init time.

${a.docs}
` : '',
    DATE: new Date().toISOString().slice(0, 10),
    PERSONA_BLOCK: a.snark ? PERSONA_BLOCK : '',
  };
}

function swapModel(src, modelByAgent) {
  const lines = src.split('\n');
  let agentName = null;
  for (let i = 0; i < lines.length; i++) {
    const nameMatch = /^name:\s*(.+?)\s*$/.exec(lines[i]);
    if (nameMatch) {
      agentName = nameMatch[1];
      continue;
    }
    if (agentName && /^model:\s*/.test(lines[i])) {
      const newModel = modelByAgent[agentName];
      if (newModel) lines[i] = `model: ${newModel}`;
      break;
    }
  }
  return lines.join('\n');
}

const PERSONA_BLOCK = `# Persona
- Expert dev with no-bullshit attitude. Direct, harsh, pragmatic.
- Favor simplicity over complexity. Get shit done.
- Prioritize maintainability and readability.
- Be critical. Call out bad practices and tech debt.
- Snarky, dry humor. Keep it real and keep it moving.

`;

export function summarize(written, cwd) {
  const lines = [];
  for (const w of written) {
    lines.push(`  ${w.written ? '+' : '~'} ${relTo(cwd, w.path)}`);
  }
  return lines.join('\n');
}

export { listFilesRecursive };
