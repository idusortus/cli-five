import kleur from 'kleur';
import prompts from 'prompts';

// ── Preset stacks ─────────────────────────────────────────────────────
// Curated defaults for fast project bootstrap with optional freeform mode.
const STACK_PRESETS = [
  {
    title: 'SPA: Vanilla HTML/CSS/JS + CDN',
    value: 'spa-vanilla-cdn',
    description: 'No build step. Browser-native app with CDN-loaded libraries.',
    stack: ['HTML + CSS + JavaScript'],
    frameworks: ['CDN (no bundler)'],
    quickstart: 'mkdir -p public && printf "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>SPA</title></head><body><div id=\"app\"></div><script src=\"./app.js\"></script></body></html>" > public/index.html && printf "document.getElementById(\"app\").textContent = \"Hello SPA\";" > public/app.js',
  },
  {
    title: 'SPA: React + Vite',
    value: 'spa-react-vite',
    description: 'React single-page app powered by Vite.',
    stack: ['Node + JavaScript'],
    frameworks: ['React', 'Vite'],
    quickstart: 'pnpm create vite@latest . --template react && pnpm install && pnpm dev',
  },
  {
    title: 'Web+DB: Python Flask + SQLite',
    value: 'webdb-flask-sqlite',
    description: 'Server-rendered web app with Flask and local SQLite storage.',
    stack: ['Python'],
    frameworks: ['Flask', 'SQLite'],
    quickstart: 'python -m venv .venv && source .venv/bin/activate && pip install flask && python app.py',
  },
  {
    title: 'Web+DB: Node.js + Express + SQLite',
    value: 'webdb-express-sqlite',
    description: 'Node web app with Express and SQLite.',
    stack: ['Node + JavaScript'],
    frameworks: ['Express', 'SQLite'],
    quickstart: 'pnpm init && pnpm add express sqlite3 && node server.js',
  },
  {
    title: 'Stack: Next.js + Prisma + SQLite',
    value: 'stack-next-prisma-sqlite',
    description: 'Full-stack Next.js with Prisma ORM and SQLite.',
    stack: ['Node + TypeScript'],
    frameworks: ['Next.js', 'Prisma', 'SQLite', 'React'],
    quickstart: 'pnpm create next-app@latest . --ts --eslint --app --src-dir --import-alias "@/*" && pnpm add prisma @prisma/client && pnpm prisma init --datasource-provider sqlite && pnpm dev',
  },
  {
    title: 'Stack: FastAPI + React/Vite',
    value: 'stack-fastapi-react-vite',
    description: 'FastAPI backend paired with a React/Vite frontend.',
    stack: ['Python', 'Node + JavaScript'],
    frameworks: ['FastAPI', 'React', 'Vite'],
    quickstart: 'python -m venv .venv && source .venv/bin/activate && pip install fastapi uvicorn && pnpm create vite@latest web --template react && cd web && pnpm install && pnpm dev',
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

export async function interview(detected, args, docHints = {}) {
  if (args.yes) return defaults(detected, docHints);

  const onCancel = () => {
    throw new Error('Interview cancelled. Nothing was written.');
  };

  const hasDocs = (docHints.files?.length ?? 0) > 0;
  const skipHint = hasDocs ? kleur.dim('  (↵ to skip — your docs cover this)') : '';

  // ── Basic info ────────────────────────────────────────────────────
  const basic = await prompts(
    [
      {
        type: 'text',
        name: 'projectName',
        message: 'Project name',
        initial: docHints.projectName || detected.projectName,
      },
      {
        type: 'text',
        name: 'oneLiner',
        message: `One-line description (becomes PROJECT.md vision)${skipHint}`,
        initial: docHints.oneLiner || '',
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
        message: `Primary goal of this project (one sentence)${skipHint}`,
        initial: docHints.goals || '',
      },
      {
        type: 'text',
        name: 'constraints',
        message: `Hard constraints (perf, deps, deploy, compliance — one sentence, optional)${skipHint}`,
        initial: docHints.constraints || '',
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
    ...defaults(detected, docHints),
    ...basic,
    ...stackAnswers,
    ...rest,
    presetId: preset,
    quickstart: chosenPreset?.quickstart || '',
    docs: docHints.raw || '',
    docFiles: docHints.files || [],
  });
}

/** Default stack is first preset when nothing is detected and --yes is used. */
function defaults(detected, docHints = {}) {
  const hasDetected = detected.stacks.length > 0;
  const fallback = STACK_PRESETS[0];
  return {
    projectName: docHints.projectName || detected.projectName,
    oneLiner: docHints.oneLiner || '',
    stack: hasDetected ? detected.stacks.map((s) => s.label) : fallback.stack,
    frameworks: hasDetected ? [] : fallback.frameworks,
    goals: docHints.goals || '',
    constraints: docHints.constraints || '',
    costMode: 'premium',
    snark: true,
    presetId: hasDetected ? 'custom' : fallback.value,
    quickstart: hasDetected ? '' : fallback.quickstart,
    docs: docHints.raw || '',
    docFiles: docHints.files || [],
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
