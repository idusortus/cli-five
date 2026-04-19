import prompts from 'prompts';

const COST_MODES = [
  { title: 'Premium (default)', value: 'premium', description: 'Sonnet/Opus/Codex. Best quality, real cost.' },
  { title: 'Cheap (0x)', value: 'cheap', description: 'GPT-4.1 / GPT-4o / GPT-5 mini. Free tier-friendly.' },
  { title: 'Mixed', value: 'mixed', description: 'Premium Coder + Reviewer, cheap everything else.' },
];

export async function interview(detected, args) {
  if (args.yes) return defaults(detected);

  const onCancel = () => {
    throw new Error('Interview cancelled. Nothing was written.');
  };

  const answers = await prompts(
    [
      {
        type: 'text',
        name: 'projectName',
        message: 'Project name',
        initial: detected.projectName,
      },
      {
        type: 'text',
        name: 'oneLiner',
        message: 'One-line description (becomes PROJECT.md vision)',
        initial: '',
      },
      {
        type: 'list',
        name: 'stack',
        message: 'Tech stack (comma separated)',
        initial: detected.stacks.map((s) => s.label).join(', '),
        separator: ',',
      },
      {
        type: 'list',
        name: 'frameworks',
        message: 'Frameworks / key libraries (comma separated, optional)',
        initial: '',
        separator: ',',
      },
      {
        type: 'text',
        name: 'goals',
        message: 'Primary goal of this project (one sentence)',
      },
      {
        type: 'text',
        name: 'constraints',
        message: 'Hard constraints (perf, deps, deploy, compliance — one sentence, optional)',
      },
      {
        type: 'select',
        name: 'costMode',
        message: 'Agent cost mode',
        choices: COST_MODES,
        initial: 0,
      },
      {
        type: 'confirm',
        name: 'snark',
        message: 'Include the snarky persona block in copilot-instructions.md?',
        initial: true,
      },
    ],
    { onCancel },
  );

  return normalize({ ...defaults(detected), ...answers });
}

function defaults(detected) {
  return {
    projectName: detected.projectName,
    oneLiner: '',
    stack: detected.stacks.map((s) => s.label),
    frameworks: [],
    goals: '',
    constraints: '',
    costMode: 'premium',
    snark: true,
  };
}

function normalize(a) {
  const trim = (s) => (typeof s === 'string' ? s.trim() : s);
  return {
    ...a,
    projectName: trim(a.projectName),
    oneLiner: trim(a.oneLiner),
    goals: trim(a.goals),
    constraints: trim(a.constraints),
    stack: (a.stack || []).map(trim).filter(Boolean),
    frameworks: (a.frameworks || []).map(trim).filter(Boolean),
  };
}
