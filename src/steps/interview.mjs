import prompts from 'prompts';

// ── Preset stacks ─────────────────────────────────────────────────────
// Chosen for: LLM familiarity, low setup friction, minimal config,
// copy-paste quickstart, broad hosting support.
// Research via Context7: Next.js, Vite+React, Express, Hono all score
// 80+ benchmark with high snippet counts and well-indexed docs.
const STACK_PRESETS = [
  {
    title: 'Next.js (TypeScript)',
    value: 'nextjs',
    description: 'Full-stack React. App Router, TypeScript, Tailwind. `npx create-next-app`',
    stack: ['Node + TypeScript'],
    frameworks: ['Next.js', 'React', 'Tailwind CSS'],
    quickstart: 'npx create-next-app@latest . --yes && npm run dev',
  },
  {
    title: 'Vite + React (TypeScript)',
    value: 'vite-react',
    description: 'SPA frontend. Lightning-fast HMR. `npm create vite`',
    stack: ['Node + TypeScript'],
    frameworks: ['Vite', 'React', 'TypeScript'],
    quickstart: 'npm create vite@latest . -- --template react-ts && npm i && npm run dev',
  },
  {
    title: 'Express API (TypeScript)',
    value: 'express',
    description: 'REST API server. Minimal, well-known, huge ecosystem.',
    stack: ['Node + TypeScript'],
    frameworks: ['Express', 'TypeScript'],
    quickstart: 'npm init -y && npm i express typescript tsx @types/express && npx tsx src/index.ts',
  },
  {
    title: 'Hono API (TypeScript)',
    value: 'hono',
    description: 'Ultrafast, Web Standards. Works on Node, Bun, Deno, Cloudflare.',
    stack: ['Node + TypeScript'],
    frameworks: ['Hono', 'TypeScript'],
    quickstart: 'npm create hono@latest . && npm i && npm run dev',
  },
  {
    title: 'Vite + Vue (TypeScript)',
    value: 'vite-vue',
    description: 'SPA frontend with Vue 3 + Composition API.',
    stack: ['Node + TypeScript'],
    frameworks: ['Vite', 'Vue', 'TypeScript'],
    quickstart: 'npm create vite@latest . -- --template vue-ts && npm i && npm run dev',
  },
  {
    title: 'Python + FastAPI',
    value: 'fastapi',
    description: 'Modern Python API with type hints and auto-docs.',
    stack: ['Python'],
    frameworks: ['FastAPI', 'Pydantic', 'Uvicorn'],
    quickstart: 'pip install fastapi uvicorn && uvicorn main:app --reload',
  },
  {
    title: 'Custom (freeform)',
    value: 'custom',
    description: 'Enter your own stack and frameworks manually.',
    stack: [],
    frameworks: [],
    quickstart: '',
  },
];

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

  // ── Basic info ────────────────────────────────────────────────────
  const basic = await prompts(
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
    ],
    { onCancel },
  );

  // ── Stack preset or freeform ──────────────────────────────────────
  // If detection already found a stack, show it as initial hint
  const detectedLabel = detected.stacks.map((s) => s.label).join(', ');

  const { preset } = await prompts(
    {
      type: 'select',
      name: 'preset',
      message: detectedLabel
        ? `Stack preset (detected: ${detectedLabel})`
        : 'Stack preset — pick one or go freeform',
      choices: STACK_PRESETS,
      initial: 0,
    },
    { onCancel },
  );

  let stackAnswers;
  const chosenPreset = STACK_PRESETS.find((p) => p.value === preset);

  if (preset === 'custom') {
    // Freeform: user types whatever they want
    stackAnswers = await prompts(
      [
        {
          type: 'list',
          name: 'stack',
          message: 'Tech stack (comma separated)',
          initial: detectedLabel,
          separator: ',',
        },
        {
          type: 'list',
          name: 'frameworks',
          message: 'Frameworks / key libraries (comma separated)',
          initial: '',
          separator: ',',
        },
      ],
      { onCancel },
    );
  } else {
    stackAnswers = {
      stack: chosenPreset.stack,
      frameworks: chosenPreset.frameworks,
    };
  }

  // ── Remaining questions ───────────────────────────────────────────
  const rest = await prompts(
    [
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

  return normalize({
    ...defaults(detected),
    ...basic,
    ...stackAnswers,
    ...rest,
    presetId: preset,
    quickstart: chosenPreset?.quickstart || '',
  });
}

/** Default stack is Next.js + TypeScript when nothing detected and --yes. */
function defaults(detected) {
  const hasDetected = detected.stacks.length > 0;
  const fallback = STACK_PRESETS[0]; // Next.js (TypeScript)
  return {
    projectName: detected.projectName,
    oneLiner: '',
    stack: hasDetected ? detected.stacks.map((s) => s.label) : fallback.stack,
    frameworks: hasDetected ? [] : fallback.frameworks,
    goals: '',
    constraints: '',
    costMode: 'premium',
    snark: true,
    presetId: hasDetected ? 'custom' : fallback.value,
    quickstart: hasDetected ? '' : fallback.quickstart,
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
