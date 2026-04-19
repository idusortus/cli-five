import kleur from 'kleur';
import prompts from 'prompts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
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
    // --doc was passed on the CLI — use those files directly
    docHints = loadDocs(args.docs, cwd);
  } else if (args.yes) {
    // --yes skips the choice — go straight to defaults
    docHints = loadDocs([], cwd);
  } else {
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
    if (mode === undefined) { log.warn('Cancelled.'); return; }

    if (mode === 'docs') {
      const { paths } = await prompts({
        type: 'list',
        name: 'paths',
        message: 'File paths (comma-separated, relative to project root)',
        separator: ',',
      });
      if (!paths || paths.length === 0) { log.warn('No files provided. Falling back to interview.'); }
      docHints = loadDocs((paths || []).map(p => p.trim()).filter(Boolean), cwd);
    } else {
      docHints = loadDocs([], cwd);
    }
  }

  if (docHints.files.length > 0) {
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
  log.raw('');
  log.raw(kleur.bold().green('Done. Next steps:'));
  log.raw('');
  log.raw(`  1. Open this folder in VS Code Insiders.`);
  log.raw(`  2. Enable Copilot subagent invocations (settings.json):`);
  log.raw(kleur.gray(`        "chat.subagents.allowInvocationsFromSubagents": true`));
  log.raw(`  3. Open Copilot Chat — select an agent from the dropdown (${kleur.bold('not')} @mention).`);
  log.raw(`  4. Select ${kleur.bold('Orchestrator')} — use handoff buttons or ask it to delegate:`);
  log.raw(kleur.gray(`        📋 Plan  💻 Code  🎨 Design  🔍 Review`));
  log.raw(`  5. Or go autonomous:`);
  log.raw(kleur.gray(`        read PROJECT.md and implement Phase 1.`));
  log.raw(`  6. Review generated instruction files in .github/instructions/.`);
  log.raw(kleur.gray(`        Edit applyTo globs and guidelines to fit your project.`));
  log.raw('');
  log.raw(kleur.dim('  Quick plugin install (personal, no project config):'));
  log.raw(kleur.dim('    copilot plugin install idusortus/cli-five'));
  log.raw('');
  log.raw(kleur.dim('Edit cost mode anytime by changing `model:` in .github/agents/*.agent.md.'));
  log.raw('');
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
