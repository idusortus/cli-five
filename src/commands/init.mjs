import kleur from 'kleur';
import prompts from 'prompts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename, join, extname } from 'node:path';
import { log } from '../util/log.mjs';
import { detect } from '../steps/detect.mjs';
import { confirmOverwriteIfNeeded } from '../steps/confirm.mjs';
import { interview } from '../steps/interview.mjs';
import { scaffold, summarize } from '../steps/scaffold.mjs';
import { skillDiscovery } from '../steps/skills.mjs';
import { instructionGeneration } from '../steps/instructions.mjs';
import { isGitRepo, gitInit } from '../util/git.mjs';

export async function init(args) {
  const cwd = args.cwd;
  log.raw(kleur.bold().magenta('\ncli-five init') + kleur.gray(`  ${cwd}`));

  // 1. Detect
  log.step('1/6 Detect workspace');
  const detected = detect(cwd);
  log.info(`Project: ${kleur.bold(detected.projectName)}`);
  log.info(`Mode:    ${detected.isBrownfield ? kleur.yellow('brownfield') : kleur.green('greenfield')}`);
  if (detected.stacks.length) log.info(`Stack:   ${detected.stacks.map((s) => s.label).join(', ')}`);
  if (!detected.hasGit) log.warn('Not a git repository.');

  // 2. git init if needed
  if (!detected.hasGit) {
    if (args.yes || (await ask('Run `git init`?', true))) {
      gitInit(cwd);
      log.ok('Initialised git repo.');
    } else {
      log.warn('Continuing without git. You will regret this.');
    }
  }

  // 3. Overwrite gate
  log.step('2/6 Confirm overwrites');
  const ok = await confirmOverwriteIfNeeded(detected, args);
  if (!ok) {
    log.warn('Aborted. Nothing written.');
    return;
  }
  if (!detected.hasAgents && !detected.hasCopilotInstructions) log.dim('No collisions.');

  // 4. Input mode — docs or manual interview
  log.step('3/6 Project info');
  let docHints;

  if (args.docs.length > 0) {
    // --doc was passed on the CLI — validate with retry
    docHints = loadDocs(args.docs, cwd);
    if (docHints.files.length === 0) {
      log.warn('None of the --doc files could be loaded.');
    }
  } else if (args.yes) {
    docHints = loadDocs([], cwd);
  } else {
    docHints = await collectDocFiles(cwd);
  }

  if (docHints.files.length > 0 && args.docs.length > 0) {
    log.info(`Loaded ${docHints.files.length} doc${docHints.files.length > 1 ? 's' : ''}: ${docHints.files.join(', ')}`);
    if (docHints.projectName) log.dim(`  → project name: ${docHints.projectName}`);
    if (docHints.oneLiner) log.dim(`  → description: ${docHints.oneLiner}`);
  }

  // 5. Interview (pre-filled from docs if available, otherwise manual)
  const answers = await interview(detected, args, docHints);

  // CLI --cost-mode override
  if (args.costMode && ['premium', 'cheap', 'mixed'].includes(args.costMode)) {
    answers.costMode = args.costMode;
  }

  if (answers.presetId && answers.presetId !== 'custom') {
    log.info(`Preset: ${answers.presetId}`);
  }
  if (answers.frameworks.length) log.info(`Stack:  ${answers.stack.join(', ')} + ${answers.frameworks.join(', ')}`);

  // 5. Scaffold
  log.step('4/6 Scaffold');
  const written = scaffold({ cwd, answers, args });
  if (args.dryRun) log.warn('--dry-run: no files written. Plan:');
  log.raw(summarize(written, cwd));
  if (!args.dryRun) log.ok(`Wrote ${written.length} files.`);

  // 6. Skill discovery
  log.step('5/6 Skill discovery');
  await skillDiscovery({ cwd, answers, args });

  // 7. Custom instructions
  log.step('6/6 Custom instructions');
  const instrWritten = await instructionGeneration({ cwd, answers, args });
  if (instrWritten && instrWritten.length > 0) {
    if (args.dryRun) log.warn('--dry-run: instruction plan:');
    for (const w of instrWritten) {
      log.raw(`  ${w.written ? '+' : '~'} ${w.path.replace(cwd + '/', '')}`);
    }
    if (!args.dryRun) log.ok(`Wrote ${instrWritten.length} instruction file${instrWritten.length > 1 ? 's' : ''}.`);
  }

  // 8. Next steps
  printNextSteps(answers);
}

async function ask(message, initial = false) {
  const { v } = await prompts({ type: 'confirm', name: 'v', message, initial });
  return Boolean(v);
}

function printNextSteps(answers) {
  const hasDocs = answers.docFiles?.length > 0;

  log.raw('');
  log.raw(kleur.bold().green('Done. Next steps:'));
  log.raw('');
  log.raw(`  1. Open this folder in VS Code Insiders.`);
  log.raw(`  2. Enable Copilot subagent invocations (settings.json):`);
  log.raw(kleur.gray(`        "chat.subagents.allowInvocationsFromSubagents": true`));
  log.raw(`  3. Open Copilot Chat — select an agent from the dropdown (${kleur.bold('not')} @mention).`);
  log.raw(`  4. Select ${kleur.bold('Orchestrator')} — use handoff buttons or ask it to delegate:`);
  log.raw(kleur.gray(`        📋 Plan  💻 Code  🎨 Design  🔍 Review`));
  log.raw(`  5. ${hasDocs ? 'Kickoff prompt (paste this into Orchestrator):' : 'Or go autonomous:'}`);
  if (hasDocs) {
    const docList = answers.docFiles.join(', ');
    log.raw(kleur.cyan(`        Review PROJECT.md (your source docs — ${docList} — are embedded`));
    log.raw(kleur.cyan(`        in the Source Documents section) and begin implementation.`));
  } else {
    log.raw(kleur.gray(`        read PROJECT.md and implement Phase 1.`));
  }
  log.raw(`  6. Review generated instruction files in .github/instructions/.`);
  log.raw(kleur.gray(`        Edit applyTo globs and guidelines to fit your project.`));
  log.raw('');
  log.raw(kleur.dim('  Quick plugin install (personal, no project config):'));
  log.raw(kleur.dim('    copilot plugin install idusortus/cli-five'));
  log.raw('');
  log.raw(kleur.dim('Edit cost mode anytime by changing `model:` in .github/agents/*.agent.md.'));
  log.raw('');
}

// ── Interactive doc file collection ───────────────────────────────────

const MANUAL_SENTINEL = '__manual__';
const SKIP_SENTINEL = '__skip__';

async function collectDocFiles(cwd) {
  const { mode } = await prompts({
    type: 'select',
    name: 'mode',
    message: 'How would you like to describe your project?',
    choices: [
      { title: 'Provide document(s)', value: 'docs', description: 'Feed existing files (README, PRD, etc.) — we extract what we can' },
      { title: 'Answer questions', value: 'manual', description: 'Short interactive interview' },
    ],
    initial: 0,
  });
  if (mode === undefined || mode === 'manual') return loadDocs([], cwd);

  // Retry loop — keep asking until we get valid files or user opts out
  while (true) {
    const selectedPaths = await pickFiles(cwd);

    // User cancelled or chose skip
    if (selectedPaths === null) return loadDocs([], cwd);

    const hints = loadDocs(selectedPaths, cwd);
    if (hints.files.length > 0) {
      log.info(`Loaded ${hints.files.length} doc${hints.files.length > 1 ? 's' : ''}: ${hints.files.join(', ')}`);
      if (hints.projectName) log.dim(`  → project name: ${hints.projectName}`);
      if (hints.oneLiner) log.dim(`  → description: ${hints.oneLiner}`);
      return hints;
    }

    // Nothing loaded — offer retry
    log.warn('No valid files were loaded.');
    const { next } = await prompts({
      type: 'select',
      name: 'next',
      message: 'What would you like to do?',
      choices: [
        { title: 'Try selecting files again', value: 'retry' },
        { title: 'Answer questions manually instead', value: 'manual' },
      ],
    });
    if (next !== 'retry') return loadDocs([], cwd);
  }
}

async function pickFiles(cwd) {
  const candidates = discoverDocCandidates(cwd);

  if (candidates.length > 0) {
    const choices = [
      ...candidates.map(f => ({ title: f, value: f })),
      { title: kleur.dim('Type path(s) manually'), value: MANUAL_SENTINEL },
      { title: kleur.dim('Skip — answer questions instead'), value: SKIP_SENTINEL },
    ];

    const { files } = await prompts({
      type: 'autocompleteMultiselect',
      name: 'files',
      message: 'Select project documents',
      choices,
      hint: 'Type to filter, space to select, enter to confirm',
      suggest: (input, choices) =>
        choices.filter(c =>
          c.value === MANUAL_SENTINEL || c.value === SKIP_SENTINEL ||
          c.title.toLowerCase().includes(input.toLowerCase())
        ),
    });

    if (!files || files.length === 0) return null;
    if (files.includes(SKIP_SENTINEL)) return null;
    if (!files.includes(MANUAL_SENTINEL)) return files;
    // Fall through to manual entry
  }

  // Manual entry (also reached when no candidates found)
  return await manualPathEntry(cwd);
}

async function manualPathEntry(cwd) {
  const { raw } = await prompts({
    type: 'list',
    name: 'raw',
    message: 'File paths (comma-separated, relative to project root)',
    separator: ',',
  });

  const paths = (raw || []).map(p => p.trim()).filter(Boolean);
  if (paths.length === 0) return null;

  // Validate immediately so user sees which ones failed
  const valid = [];
  const invalid = [];
  for (const p of paths) {
    if (existsSync(resolve(cwd, p))) {
      valid.push(p);
    } else {
      invalid.push(p);
    }
  }

  if (invalid.length > 0) {
    for (const p of invalid) log.warn(`Not found: ${p}`);
  }

  return valid.length > 0 ? valid : paths; // return all — loadDocs will warn again, triggers retry
}

function discoverDocCandidates(cwd) {
  const IGNORE = new Set(['node_modules', '.git', '.github', 'dist', 'build', '.next', 'coverage', '.turbo', '.vercel']);
  const DOC_EXTS = new Set(['.md', '.txt', '.rst', '.mdx']);
  const DOC_NAMES = new Set(['package.json']);
  const results = [];

  function walk(dir, prefix) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (IGNORE.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rel.split('/').length < 3) walk(join(dir, entry.name), rel);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if (DOC_EXTS.has(ext) || DOC_NAMES.has(entry.name.toLowerCase())) {
          results.push(rel);
        }
      }
    }
  }

  walk(cwd, '');
  return results.sort();
}

// ── --doc file loading + extraction ───────────────────────────────────

function loadDocs(docPaths, cwd) {
  const empty = { files: [], projectName: '', oneLiner: '', goals: '', constraints: '', raw: '' };
  if (!docPaths || docPaths.length === 0) return empty;

  const sections = [];
  const files = [];
  let projectName = '';
  let oneLiner = '';
  let goals = '';
  let constraints = '';

  for (const rawPath of docPaths) {
    const abs = resolve(cwd, rawPath);
    if (!existsSync(abs)) {
      log.warn(`--doc: file not found: ${rawPath}`);
      continue;
    }

    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch (err) {
      log.warn(`--doc: cannot read ${rawPath}: ${err.message}`);
      continue;
    }

    const name = basename(abs);
    files.push(name);
    sections.push(`### ${name}\n\n${content.trim()}`);

    // ── Heuristic extraction ──────────────────────────────────────
    // Try package.json first (structured data)
    if (name === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        if (pkg.name && !projectName) projectName = pkg.name;
        if (pkg.description && !oneLiner) oneLiner = pkg.description;
      } catch { /* ignore malformed JSON */ }
      continue;
    }

    // For markdown/text files — extract from headings and first paragraph
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // First H1 → project name hint
      if (!projectName && /^#\s+/.test(line)) {
        projectName = line.replace(/^#+\s*/, '').trim();
        continue;
      }

      // First non-empty paragraph after H1 → one-liner hint
      if (projectName && !oneLiner && line && !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('- ') && !line.startsWith('|')) {
        oneLiner = line.length > 120 ? line.slice(0, 117) + '...' : line;
        continue;
      }

      // ## Goal / ## Purpose / ## Overview → goals hint
      if (!goals && /^##\s+(goal|purpose|overview|objective|vision)/i.test(line)) {
        const body = collectSection(lines, i + 1);
        if (body) goals = body;
        continue;
      }

      // ## Constraints → constraints hint
      if (!constraints && /^##\s+(constraint|requirement|limit|scope)/i.test(line)) {
        const body = collectSection(lines, i + 1);
        if (body) constraints = body;
        continue;
      }
    }
  }

  return {
    files,
    projectName,
    oneLiner,
    goals,
    constraints,
    raw: sections.join('\n\n---\n\n'),
  };
}

/** Collect text from startIdx until the next heading or EOF. */
function collectSection(lines, startIdx) {
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (/^##?\s+/.test(lines[i]) && out.length > 0) break;
    const trimmed = lines[i].trim();
    if (trimmed) out.push(trimmed);
    if (out.length >= 3) break; // Keep it short — just the first few lines
  }
  return out.join(' ');
}
