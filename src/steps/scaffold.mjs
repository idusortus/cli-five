import { join } from 'node:path';
import { log } from '../util/log.mjs';
import { readTemplate, render, writeFile, listFilesRecursive, relTo } from '../util/fs.mjs';
import { templatePath } from '../util/fs.mjs';
import { readFileSync } from 'node:fs';

const AGENT_FILES = [
  'orchestrator.agent.md',
  'planner.agent.md',
  'coder.agent.md',
  'designer.agent.md',
  'reviewer.agent.md',
];

const HISTORY_FILES = ['orchestrator.md', 'planner.md', 'coder.md', 'designer.md', 'reviewer.md'];

const MODEL_MAP = {
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
  const vars = buildVars(answers);
  const written = [];

  // Agents (with model swap per cost mode)
  for (const file of AGENT_FILES) {
    const src = readFileSync(templatePath('.github', 'agents', file), 'utf8');
    const swapped = swapModel(src, MODEL_MAP[answers.costMode]);
    written.push(writeFile(join(cwd, '.github', 'agents', file), swapped, args));
  }

  // copilot-instructions.md (templated)
  const ci = render(readTemplate('.github', 'copilot-instructions.md.tmpl'), vars);
  written.push(writeFile(join(cwd, '.github', 'copilot-instructions.md'), ci, args));

  // Empty containers ready for /agent-customization
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

  // Project root memory primitives (GSD-inspired)
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

  return written;
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
    DATE: new Date().toISOString().slice(0, 10),
    PERSONA_BLOCK: a.snark ? PERSONA_BLOCK : '',
  };
}

function swapModel(src, modelByAgent) {
  // Replace the YAML `model:` line based on the `name:` immediately above/around it.
  const lines = src.split('\n');
  let agentName = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^name:\s*(.+?)\s*$/.exec(lines[i]);
    if (m) {
      agentName = m[1];
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
