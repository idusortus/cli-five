import prompts from 'prompts';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { log } from '../util/log.mjs';
import { writeFile } from '../util/fs.mjs';

/**
 * Maps detected stacks to instruction file templates.
 * `skillHints` keys are skill names — only referenced if the skill is actually installed.
 */
const INSTRUCTION_CATALOG = [
  {
    id: 'typescript',
    stackIds: ['node-ts', 'node'],
    filename: 'typescript.instructions.md',
    applyTo: '**/*.ts,**/*.tsx,**/*.js,**/*.jsx',
    label: 'TypeScript / JavaScript',
    guidelines: [
      'Prefer strict TypeScript (`strict: true`). Avoid `any`; use `unknown` with type guards.',
      'Use named exports over default exports for better discoverability.',
      'Prefer `interface` over `type` for object shapes that may be extended.',
      'Keep files under 300 lines. Extract helpers into co-located modules.',
    ],
    skillHints: {
      'vercel-react-best-practices':
        'Use the **vercel-react-best-practices** skill when writing or reviewing React / Next.js components for performance.',
      'vercel-composition-patterns':
        'Use the **vercel-composition-patterns** skill when refactoring components with boolean-prop proliferation or designing reusable component APIs.',
      'frontend-design':
        'Use the **frontend-design** skill when building new UI components, pages, or layouts.',
    },
  },
  {
    id: 'python',
    stackIds: ['python'],
    filename: 'python.instructions.md',
    applyTo: '**/*.py',
    label: 'Python',
    guidelines: [
      'Use type hints on all public functions and methods.',
      'Prefer `pathlib.Path` over `os.path`.',
      'Use `dataclasses` or `pydantic` for structured data.',
      'Follow PEP 8. Keep line length ≤ 100 chars.',
    ],
    skillHints: {
      'python-best-practices':
        'Use the **python-best-practices** skill for idiomatic Python patterns and code review.',
    },
  },
  {
    id: 'kotlin',
    stackIds: ['kotlin-android', 'gradle'],
    filename: 'kotlin.instructions.md',
    applyTo: '**/*.kt,**/*.kts',
    label: 'Kotlin',
    guidelines: [
      'Use `data class` for value objects.',
      'Prefer `val` over `var`; favour immutability.',
      'Use sealed classes / interfaces for restricted hierarchies.',
      'Follow Kotlin coding conventions (kotlinlang.org/docs/coding-conventions.html).',
    ],
    skillHints: {},
  },
  {
    id: 'dotnet',
    stackIds: ['dotnet'],
    filename: 'dotnet.instructions.md',
    applyTo: '**/*.cs,**/*.fs',
    label: '.NET / C#',
    guidelines: [
      'Use `record` types for immutable DTOs.',
      'Prefer `async/await` throughout; avoid `.Result` or `.Wait()`.',
      'Follow .NET naming conventions (PascalCase for public, _camelCase for private fields).',
      'Target nullable reference types (`<Nullable>enable</Nullable>`).',
    ],
    skillHints: {
      'microsoft-foundry':
        'Use the **microsoft-foundry** skill for Azure / Foundry deployment patterns.',
    },
  },
  {
    id: 'rust',
    stackIds: ['rust'],
    filename: 'rust.instructions.md',
    applyTo: '**/*.rs',
    label: 'Rust',
    guidelines: [
      'Prefer owned types in public APIs; borrow internally.',
      'Use `thiserror` for library errors, `anyhow` for application errors.',
      'Run `cargo clippy -- -D warnings` before committing.',
      'Keep `unsafe` blocks minimal, documented, and audited.',
    ],
    skillHints: {
      'code-review': 'Use the **code-review** skill for thorough Rust code review.',
    },
  },
  {
    id: 'go',
    stackIds: ['go'],
    filename: 'go.instructions.md',
    applyTo: '**/*.go',
    label: 'Go',
    guidelines: [
      'Follow Effective Go and the Go Code Review Comments guide.',
      'Return errors; do not panic in library code.',
      'Use `context.Context` as the first parameter for cancellable operations.',
      'Run `go vet` and `staticcheck` before committing.',
    ],
    skillHints: {},
  },
  {
    id: 'ruby',
    stackIds: ['ruby'],
    filename: 'ruby.instructions.md',
    applyTo: '**/*.rb,**/*.rake',
    label: 'Ruby',
    guidelines: [
      'Follow the Ruby Style Guide.',
      'Prefer `frozen_string_literal: true` at the top of every file.',
      'Use keyword arguments for methods with 3+ parameters.',
      'Keep controller actions thin; push logic into models or service objects.',
    ],
    skillHints: {},
  },
  {
    id: 'php',
    stackIds: ['php'],
    filename: 'php.instructions.md',
    applyTo: '**/*.php',
    label: 'PHP',
    guidelines: [
      'Use strict types (`declare(strict_types=1)`).',
      'Follow PSR-12 coding style.',
      'Use type declarations for parameters and return types.',
      'Prefer dependency injection over static calls.',
    ],
    skillHints: {},
  },
  {
    id: 'java',
    stackIds: ['maven', 'gradle'],
    filename: 'java.instructions.md',
    applyTo: '**/*.java',
    label: 'Java',
    guidelines: [
      'Use `record` types (Java 16+) for immutable value objects.',
      'Prefer `var` for local variables when the type is obvious.',
      'Follow Google Java Style Guide.',
      'Use `Optional` for nullable return types; never pass `null` as a parameter.',
    ],
    skillHints: {},
  },
  {
    id: 'css',
    stackIds: ['node-ts', 'node'],
    filename: 'css.instructions.md',
    applyTo: '**/*.css,**/*.scss,**/*.less',
    label: 'CSS / Styling',
    guidelines: [
      'Prefer CSS custom properties (variables) over hard-coded values.',
      'Use logical properties (`inline-size`, `block-size`) for internationalization.',
      'Keep specificity low; prefer class selectors over IDs or element selectors.',
    ],
    skillHints: {
      'frontend-design':
        'Use the **frontend-design** skill when designing distinctive, high-quality UI.',
      'web-design-guidelines':
        'Use the **web-design-guidelines** skill to audit UI against Web Interface Guidelines.',
    },
  },
];

export async function instructionGeneration({ cwd, answers, args }) {
  if (args.yes) {
    log.dim('Non-interactive mode — generating all matching instructions.');
    return generateAll(cwd, answers, args);
  }

  const installedSkills = detectInstalledSkills(cwd);
  const candidates = matchCandidates(answers, installedSkills);

  if (candidates.length === 0) {
    log.dim('No stack-specific instruction templates matched.');
    return [];
  }

  log.raw('');
  log.raw('  Matched instruction templates:');
  log.raw('');
  for (const c of candidates) {
    const skillCount = c.matchedSkills.length;
    const suffix = skillCount ? ` (${skillCount} skill${skillCount > 1 ? 's' : ''} linked)` : '';
    log.raw(`    ${c.label.padEnd(28)} → .github/instructions/${c.filename}${suffix}`);
  }
  log.raw('');

  const { selected } = await prompts({
    type: 'multiselect',
    name: 'selected',
    message: 'Generate instruction files?',
    choices: candidates.map((c) => ({
      title: `${c.label} (${c.applyTo})`,
      value: c,
      selected: true,
    })),
    hint: 'Space to toggle, Enter to confirm',
  });

  if (!selected || selected.length === 0) {
    log.dim('No instructions generated.');
    return [];
  }

  return writeInstructions(cwd, selected, args);
}

function generateAll(cwd, answers, args) {
  const installedSkills = detectInstalledSkills(cwd);
  const candidates = matchCandidates(answers, installedSkills);
  return writeInstructions(cwd, candidates, args);
}

function matchCandidates(answers, installedSkills) {
  const detectedIds = new Set((answers.stack || []).map(stackLabelToId));
  const out = [];
  const seen = new Set();

  for (const entry of INSTRUCTION_CATALOG) {
    if (seen.has(entry.id)) continue;
    const matches = entry.stackIds.some((sid) => detectedIds.has(sid));
    if (!matches) continue;
    seen.add(entry.id);

    const matchedSkills = Object.keys(entry.skillHints).filter((s) => installedSkills.has(s));
    out.push({ ...entry, matchedSkills });
  }

  return out;
}

function writeInstructions(cwd, candidates, args) {
  const written = [];
  for (const c of candidates) {
    const content = renderInstruction(c);
    const target = join(cwd, '.github', 'instructions', c.filename);
    written.push(writeFile(target, content, args));
  }
  return written;
}

function renderInstruction(entry) {
  const lines = [];
  lines.push('---');
  lines.push(`applyTo: "${entry.applyTo}"`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${entry.label}`);
  lines.push('');

  for (const g of entry.guidelines) {
    lines.push(`- ${g}`);
  }

  const activeHints = entry.matchedSkills
    .map((s) => entry.skillHints[s])
    .filter(Boolean);

  if (activeHints.length > 0) {
    lines.push('');
    lines.push('## Skills');
    lines.push('');
    for (const h of activeHints) {
      lines.push(`- ${h}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Scan .agents/skills/ and .github/skills/ for installed skill directories.
 */
function detectInstalledSkills(cwd) {
  const skills = new Set();
  for (const dir of [join(cwd, '.agents', 'skills'), join(cwd, '.github', 'skills')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md'))) {
        skills.add(entry.name);
      }
    }
  }

  // Also check skills-lock.json
  const lockPath = join(cwd, 'skills-lock.json');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lock.skills) {
        for (const name of Object.keys(lock.skills)) {
          skills.add(name);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return skills;
}

/**
 * Best-effort reverse mapping from interview label → STACK_SIGNATURES id.
 * Falls through to lowercase comparison.
 */
function stackLabelToId(label) {
  const LABEL_MAP = {
    'node + typescript': 'node-ts',
    'node': 'node',
    'python': 'python',
    '.net': 'dotnet',
    'rust': 'rust',
    'go': 'go',
    'kotlin / android': 'kotlin-android',
    'gradle (jvm)': 'gradle',
    'maven (jvm)': 'maven',
    'ruby': 'ruby',
    'php': 'php',
  };
  const lower = (label || '').toLowerCase().trim();
  return LABEL_MAP[lower] || lower;
}
