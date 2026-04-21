import prompts from 'prompts';
import kleur from 'kleur';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { log } from '../util/log.mjs';

// ── Known-good skill repos (verified working) ────────────────────────
// awesome-copilot skills are discovered dynamically via `skills find`.
const AWESOME_COPILOT_REPO = 'github/awesome-copilot';
const BREADCRUMB_BOX_WIDTH = 66;
const PNPM_INSTALL_DOCS_URL = 'https://pnpm.io/installation';

// Well-known skill repos matched by stack term → repo + suggested skill names (skills.sh)
const SKILL_CATALOG = [
  { terms: ['*'], repo: 'anthropics/skills', skills: ['frontend-design', 'skill-creator'] },
  { terms: ['*'], repo: 'vercel-labs/agent-skills', skills: ['vercel-react-best-practices', 'web-design-guidelines'] },
  { terms: ['node', 'typescript', 'react', 'next'], repo: 'vercel-labs/agent-skills', skills: ['vercel-composition-patterns'] },
  { terms: ['python'], repo: 'anthropics/skills', skills: ['python-best-practices'] },
  { terms: ['dotnet', '.net'], repo: 'microsoft/azure-skills', skills: ['microsoft-foundry'] },
  { terms: ['android', 'kotlin'], repo: 'anthropics/skills', skills: ['frontend-design'] },
  { terms: ['rust'], repo: 'anthropics/skills', skills: ['code-review'] },
];

// Core skills are the always-on baseline curated by cli-five.
// Stack-specific and discovered skills are suggestions and must be opted-in.
const CORE_CATALOG_SKILLS = new Set([
  'anthropics/skills@frontend-design',
  'anthropics/skills@skill-creator',
  'vercel-labs/agent-skills@vercel-react-best-practices',
  'vercel-labs/agent-skills@web-design-guidelines',
]);

// ── Environment detection ─────────────────────────────────────────────

function resolveSkillsBin() {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('skills/package.json');
    const bin = join(dirname(pkgPath), 'bin', 'cli.mjs');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

function whichVersion(cmd) {
  try {
    return execFileSync(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

/** Detect whether the target workspace itself uses pnpm. */
function projectUsesPnpm(cwd) {
  return existsSync(join(cwd, 'pnpm-lock.yaml')) || existsSync(join(cwd, 'pnpm-workspace.yaml'));
}

/**
 * Detect the runtime environment.
 * Returns { runner, label } where runner is a function (skillsArgs, cwd) → {cmd, args}.
 */
function detectEnv(cwd) {
  const bundledBin = resolveSkillsBin();
  const npmVer = whichVersion('npm');
  const pnpmVer = whichVersion('pnpm');
  const npxVer = whichVersion('npx');
  const projectPnpm = projectUsesPnpm(cwd);

  // ── Priority: bundled > pnpm (if project or system) > npx ─────────
  if (bundledBin) {
    return {
      label: 'bundled skills CLI',
      runner: (skillsArgs) => ({ cmd: process.execPath, args: [bundledBin, ...skillsArgs] }),
      npmVer,
      pnpmVer,
      npxVer,
      projectPnpm,
    };
  }
  if (pnpmVer) {
    return {
      label: 'pnpm dlx',
      runner: (skillsArgs) => ({ cmd: 'pnpm', args: ['dlx', 'skills', ...skillsArgs] }),
      npmVer,
      pnpmVer,
      npxVer,
      projectPnpm,
    };
  }
  if (npxVer) {
    return {
      label: 'npx',
      runner: (skillsArgs) => ({ cmd: 'npx', args: ['-y', 'skills', ...skillsArgs] }),
      npmVer,
      pnpmVer,
      npxVer,
      projectPnpm,
    };
  }
  return null;
}

// ── Main entry ────────────────────────────────────────────────────────

export async function skillDiscovery({ cwd, answers, args }) {
  if (!args.skills) {
    log.dim('Skipping skills discovery (--no-skills).');
    return;
  }
  if (args.yes) {
    log.dim('Non-interactive mode — skipping skills picker. Run `npx skills find` later.');
    return;
  }

  // ── Environment checks ──────────────────────────────────────────────
  let env = detectEnv(cwd);

  if (!env) {
    log.warn('Cannot run skills CLI: no bundled binary, pnpm, or npx found.');
    log.warn(`Install Node.js (includes npx) or pnpm, then re-run. ${PNPM_INSTALL_DOCS_URL}`);
    printBreadcrumbs();
    return;
  }

  if (env.pnpmVer) {
    log.ok(`pnpm detected (${env.pnpmVer}).`);
  } else {
    log.dim('Tip: pnpm is recommended for faster installs and stricter dependency resolution.');
  }

  // Offer pnpm if the user doesn't have it
  if (shouldOfferPnpmInstall(env)) {
    const { wantPnpm } = await prompts({
      type: 'confirm',
      name: 'wantPnpm',
      message: 'pnpm not found. Install it now? (recommended)',
      initial: true,
    });
    if (wantPnpm) {
      try {
        execFileSync('npm', ['install', '-g', 'pnpm'], { stdio: 'inherit' });
        log.ok('pnpm installed.');
        env = detectEnv(cwd) || env;
      } catch (err) {
        log.warn(`pnpm install failed: ${err.message}`);
        log.warn(`Install pnpm manually: ${PNPM_INSTALL_DOCS_URL}`);
      }
    }
  }

  log.ok(`Running skills via ${env.label}`);

  // ── 1. Auto-search all stack terms silently ─────────────────────────
  const terms = suggestSearches(answers);
  const searchResults = [];

  if (terms.length > 0) {
    log.raw('');
    log.info(`Searching skills.sh for: ${terms.map((t) => kleur.bold(t)).join(', ')} ...`);
    for (const term of terms) {
      const output = await runSkillsSilent(env, ['find', term], cwd);
      searchResults.push(...parseSkillRefs(output));
    }
    if (searchResults.length > 0) {
      log.ok(`Found ${searchResults.length} skill${searchResults.length > 1 ? 's' : ''} from search.`);
    } else {
      log.dim('No additional skills found via search.');
    }
  }

  // ── 2. Build static catalog recommendations ─────────────────────────
  const catalogRecs = buildRecommendations(answers);

  // ── 3. Categorize search results by source ──────────────────────────
  const awesomeResults = [];
  const otherResults = [];
  for (const r of searchResults) {
    const parsed = parseRef(r.ref);
    if (parsed && parsed.repo === AWESOME_COPILOT_REPO) {
      awesomeResults.push({ ...r, ...parsed });
    } else {
      otherResults.push(r);
    }
  }

  // ── 4. Display hero section ─────────────────────────────────────────
  displayHeroRecommendations(awesomeResults, catalogRecs, answers);

  // ── 5. Build unified picker ─────────────────────────────────────────
  const seen = new Set();
  const choices = [];

  // awesome-copilot results from search (dynamic, real names)
  for (const r of awesomeResults) {
    const key = r.ref;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      title: `${kleur.cyan('⬡')} ${r.skill} ${kleur.dim(`(${r.installs})`)} ${kleur.cyan('← awesome-copilot')}`,
      value: { source: 'awesome', repo: r.repo, skill: r.skill, ref: r.ref },
      selected: false,
    });
  }

  // Static catalog recs (verified repos)
  for (const r of catalogRecs) {
    const ref = `${r.repo}@${r.skill}`;
    const core = isCoreCatalogSkill(r.repo, r.skill);
    if (seen.has(ref)) continue;
    seen.add(ref);
    choices.push({
      title: `${kleur.yellow('◆')} ${r.skill} ${kleur.dim(`(${r.repo})`)} ${kleur.yellow(core ? '← core' : '← skills.sh (suggested)')}`,
      value: { source: 'catalog', ref, repo: r.repo, skill: r.skill },
      selected: core,
    });
  }

  // Other search results (non-awesome-copilot)
  for (const r of otherResults) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    const parsed = parseRef(r.ref);
    choices.push({
      title: `${kleur.yellow('◆')} ${parsed ? parsed.skill : r.ref} ${kleur.dim(`(${parsed ? parsed.repo : ''} — ${r.installs})`)} ${kleur.yellow('← skills.sh')}`,
      value: { source: 'search', ref: r.ref, repo: parsed?.repo, skill: parsed?.skill },
      selected: false,
    });
  }

  // ── 6. Prompt user to select skills ─────────────────────────────────
  const installResults = [];

  if (choices.length > 0) {
    log.raw('');
    log.dim('Suggested skills are not pre-selected. Press Space to install only what you need.');
    log.dim('Read every installed skill so you understand behavior and catch potential conflicts early.');
    const { toInstall } = await prompts({
      type: 'multiselect',
      name: 'toInstall',
      message: 'Select skills to install',
      choices,
      hint: 'Space to toggle, Enter to confirm',
    });

    if (toInstall && toInstall.length > 0) {
      log.raw('');

      // Group by repo for batch install
      const byRepo = new Map();
      const standalone = [];

      for (const item of toInstall) {
        if (item.repo && item.skill) {
          if (!byRepo.has(item.repo)) byRepo.set(item.repo, []);
          byRepo.get(item.repo).push(item.skill);
        } else if (item.ref) {
          standalone.push(item.ref);
        }
      }

      // Batch install per repo
      for (const [repo, skills] of byRepo) {
        const skillArgs = skills.flatMap((s) => ['--skill', s]);
        log.info(`Installing from ${kleur.bold(repo)}: ${skills.join(', ')}`);
        const result = await runSkillsTracked(env, ['add', repo, ...skillArgs, '-a', 'github-copilot', '--yes'], cwd);
        for (const s of skills) {
          installResults.push({ name: `${repo}@${s}`, ...result });
        }
      }

      // Standalone refs
      for (const ref of standalone) {
        log.info(`Installing ${ref}...`);
        const result = await runSkillsTracked(env, ['add', ref, '-a', 'github-copilot', '--yes'], cwd);
        installResults.push({ name: ref, ...result });
      }

      await relocateSkills(cwd);
    }
  }

  // ── 7. Install summary ──────────────────────────────────────────────
  if (installResults.length > 0) {
    printInstallSummary(installResults);
  }

  // Offer freeform catch-all
  const { freeform } = await prompts({
    type: 'confirm',
    name: 'freeform',
    message: 'Launch the full interactive skills browser?',
    initial: false,
  });
  if (freeform) {
    await runSkills(env, ['find'], cwd);
    await relocateSkills(cwd);
  }

  // ── Post-install breadcrumbs (THE HERO FINISH) ──────────────────────
  printBreadcrumbs();
}

// ── Hero display ──────────────────────────────────────────────────────

function displayHeroRecommendations(awesomeResults, catalogRecs, answers) {
  const stackLabel = [...(answers.stack || []), ...(answers.frameworks || [])].join(', ') || 'general';

  log.raw('');
  log.raw(kleur.bold().cyan('  ╔══════════════════════════════════════════════════════════════════╗'));
  log.raw(kleur.bold().cyan('  ║') + kleur.bold('  📦 RECOMMENDED FOR YOUR STACK: ') + kleur.bold().white(stackLabel) + pad('', Math.max(0, 30 - stackLabel.length)) + kleur.bold().cyan(' ║'));
  log.raw(kleur.bold().cyan('  ╚══════════════════════════════════════════════════════════════════╝'));

  if (awesomeResults.length > 0) {
    log.raw('');
    log.raw(kleur.cyan('  ⬡ Source: awesome-copilot') + kleur.dim('  (github/awesome-copilot · 30k+ ★)'));
    log.raw(kleur.dim('  ─────────────────────────────────────────────────────────'));
    for (const r of awesomeResults) {
      log.raw(`    ${kleur.green('✓')} ${pad(r.skill, 38)} ${kleur.dim(r.installs)}`);
    }
  }

  if (catalogRecs.length > 0) {
    log.raw('');
    log.raw(kleur.yellow('  ◆ Source: skills.sh') + kleur.dim('  (verified repos)'));
    log.raw(kleur.dim('  ─────────────────────────────────────────────────────────'));
    for (const r of catalogRecs) {
      log.raw(`    ${kleur.green('✓')} ${pad(r.skill, 38)} ${kleur.dim(r.repo)}`);
    }
  }

  log.raw('');
}

// ── Install summary ───────────────────────────────────────────────────

function printInstallSummary(results) {
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  log.raw('');
  if (succeeded.length > 0) {
    log.ok(`Installed ${succeeded.length} skill${succeeded.length > 1 ? 's' : ''} successfully.`);
  }

  if (failed.length > 0) {
    log.raw('');
    log.warn(`${failed.length} skill${failed.length > 1 ? 's' : ''} failed to install:`);
    for (const f of failed) {
      log.raw(`    ${kleur.red('✗')} ${f.name}`);
      if (f.reason) {
        log.raw(`      ${kleur.dim(f.reason)}`);
      }
    }
    log.raw('');
    log.dim('Install failed skills manually: npx skills add <owner/repo> --skill <name>');
  }
}

// ── Post-install breadcrumbs ──────────────────────────────────────────

function printBreadcrumbs() {
  log.raw('');
  for (const line of buildBreadcrumbBox()) {
    log.raw(line);
  }
  log.raw('');
}

// ── Runner ─────────────────────────────────────────────────────────────

/** Run skills CLI with stdio: inherit (visible to user). */
function runSkills(env, skillsArgs, cwd) {
  const { cmd, args } = env.runner(skillsArgs);
  return runInteractive(cmd, args, cwd);
}

/** Run skills CLI, capture output, track success/failure. Returns { ok, reason }. */
function runSkillsTracked(env, skillsArgs, cwd) {
  const { cmd, args } = env.runner(skillsArgs);
  return new Promise((resolve) => {
    // stdout/stderr piped and re-echoed so we can capture output for failure detection.
    // --yes is always passed so no interactive prompts will stall the pipe.
    let output = '';
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      output += text;
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      output += text;
    });
    proc.on('exit', (code) => {
      const clean = stripAnsi(output);
      if (code !== 0 || /failed to clone|installation failed|canceled/i.test(clean)) {
        const reason = extractFailureReason(clean);
        resolve({ ok: false, reason });
      } else {
        resolve({ ok: true, reason: null });
      }
    });
    proc.on('error', (err) => {
      resolve({ ok: false, reason: err.message });
    });
  });
}

/** Run skills CLI silently — capture stdout/stderr without echoing. */
function runSkillsSilent(env, skillsArgs, cwd) {
  const { cmd, args } = env.runner(skillsArgs);
  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.on('exit', () => resolve(output));
    proc.on('error', () => resolve(''));
  });
}

async function relocateSkills(cwd) {
  const src = join(cwd, '.agents', 'skills');
  const dest = join(cwd, '.github', 'skills');

  if (!existsSync(src)) return;

  const candidates = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(join(src, entry.name, 'SKILL.md'))) continue;
    if (existsSync(join(dest, entry.name))) continue;
    candidates.push(entry.name);
  }

  if (candidates.length === 0) return;

  log.raw('');
  log.info(`${candidates.length} skill${candidates.length > 1 ? 's' : ''} in .agents/skills/: ${candidates.join(', ')}`);
  log.info('cli-five prefers .github/skills/ (co-located with agents & instructions).');
  log.info('Both locations work — Copilot discovers either.');

  const { move } = await prompts({
    type: 'confirm',
    name: 'move',
    message: 'Move to .github/skills/?',
    initial: true,
  });

  if (!move) {
    log.dim('Keeping skills in .agents/skills/.');
    return;
  }

  let moved = 0;
  for (const name of candidates) {
    mkdirSync(dest, { recursive: true });
    renameSync(join(src, name), join(dest, name));
    moved++;
  }

  log.ok(`Moved ${moved} skill${moved > 1 ? 's' : ''} → .github/skills/`);

  // Clean up empty dirs
  try {
    if (readdirSync(src).length === 0) {
      rmSync(src, { recursive: true });
      const agentsDir = join(cwd, '.agents');
      if (existsSync(agentsDir) && readdirSync(agentsDir).length === 0) {
        rmSync(agentsDir, { recursive: true });
      }
    }
  } catch {
    /* best-effort */
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function buildRecommendations(a) {
  const stackLower = (a.stack || []).map((s) => s.toLowerCase());
  const fwLower = (a.frameworks || []).map((f) => f.toLowerCase());
  const all = [...stackLower, ...fwLower];
  const seen = new Set();
  const out = [];

  for (const entry of SKILL_CATALOG) {
    const matches = entry.terms.includes('*') || entry.terms.some((t) => all.some((s) => s.includes(t)));
    if (!matches) continue;
    for (const skill of entry.skills) {
      const key = `${entry.repo}/${skill}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ repo: entry.repo, skill });
    }
  }
  return out;
}

function isCoreCatalogSkill(repo, skill) {
  return CORE_CATALOG_SKILLS.has(`${repo}@${skill}`);
}

function suggestSearches(a) {
  const out = new Set();
  for (const s of a.stack || []) {
    const t = s.toLowerCase();
    if (t.includes('node') || t.includes('typescript')) out.add('typescript');
    if (t.includes('python')) out.add('python');
    if (t.includes('.net') || t.includes('dotnet')) out.add('dotnet');
    if (t.includes('kotlin') || t.includes('android')) out.add('android');
    if (t.includes('rust')) out.add('rust');
    if (t.includes('go')) out.add('go');
    if (t.includes('ruby')) out.add('ruby');
    if (t.includes('php')) out.add('php');
  }
  for (const f of a.frameworks || []) out.add(f.toLowerCase());
  if (out.size === 0) out.add('best-practices');
  return [...out];
}

/** Parse owner/repo@skill ref into { repo, skill }. */
function parseRef(ref) {
  const match = /^(.+?\/.+?)@(.+)$/.exec(ref);
  if (!match) return null;
  return { repo: match[1], skill: match[2] };
}

/** Extract a concise failure reason from skills CLI output. */
function extractFailureReason(output) {
  const cloneMatch = /Failed to clone[^:]*:\s*(.+)/i.exec(output);
  if (cloneMatch) return cloneMatch[1].trim();

  const errorMatch = /(?:error|failed)[:\s]+(.+)/im.exec(output);
  if (errorMatch) return errorMatch[1].trim();

  return 'Unknown error (check output above)';
}

function pad(s, n) {
  return (s || '').padEnd(n);
}

/**
 * Offer pnpm installation only for pnpm workspaces that are currently missing pnpm
 * and can bootstrap it via npm on PATH.
 */
function shouldOfferPnpmInstall(env) {
  return Boolean(env && !env.pnpmVer && env.npmVer);
}

function buildBreadcrumbBox() {
  const horizontalDivider = kleur.bold().green(`  ├${'─'.repeat(BREADCRUMB_BOX_WIDTH + 2)}┤`);
  const lines = [
    formatBoxLine(kleur.bold('  KEEP DISCOVERING -- paste into VS Code / Copilot Chat:'), BREADCRUMB_BOX_WIDTH),
    horizontalDivider,
    formatBoxLine('', BREADCRUMB_BOX_WIDTH),
    formatBoxLine('  Add awesome-copilot MCP for ongoing search:', BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.white('    Add to .vscode/mcp.json:'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.dim('      "awesome-copilot": {'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.dim('        "command": "npx",'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.dim('        "args": ["-y", "awesome-copilot-mcp"]'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.dim('      }'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine('', BREADCRUMB_BOX_WIDTH),
    formatBoxLine('  Browse skills anytime:', BREADCRUMB_BOX_WIDTH),
    formatBoxLine(kleur.white('    npx skills find'), BREADCRUMB_BOX_WIDTH),
    formatBoxLine('', BREADCRUMB_BOX_WIDTH),
  ];

  return [
    kleur.bold().green(`  ┌${'─'.repeat(BREADCRUMB_BOX_WIDTH + 2)}┐`),
    ...lines,
    kleur.bold().green(`  └${'─'.repeat(BREADCRUMB_BOX_WIDTH + 2)}┘`),
  ];
}

function formatBoxLine(content = '', width = BREADCRUMB_BOX_WIDTH) {
  const paddingNeeded = Math.max(0, width - stripAnsi(content).length);
  return `${kleur.bold().green('  │ ')}${content}${' '.repeat(paddingNeeded)}${kleur.bold().green(' │')}`;
}

function runInteractive(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });
    proc.on('exit', () => resolve());
    proc.on('error', (err) => {
      log.warn(`Could not launch \`${cmd} ${args.join(' ')}\`: ${err.message}`);
      log.dim('Install/run it manually later. See https://skills.sh');
      resolve();
    });
  });
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/** Extract owner/repo@skill refs from `skills find <term>` output. */
function parseSkillRefs(output) {
  const clean = stripAnsi(output);
  const regex = /^(\S+\/\S+@\S+)\s+(.+?installs)/gm;
  const results = [];
  let match;
  while ((match = regex.exec(clean))) {
    results.push({ ref: match[1], installs: match[2].trim() });
  }
  return results;
}

export const __testables = {
  buildBreadcrumbBox,
  detectEnv,
  formatBoxLine,
  isCoreCatalogSkill,
  shouldOfferPnpmInstall,
  stripAnsi,
};
