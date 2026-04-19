import prompts from 'prompts';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { log } from '../util/log.mjs';

// Well-known skill repos matched by stack term → repo + suggested skill names
const SKILL_CATALOG = [
  { terms: ['*'], repo: 'anthropics/skills', skills: ['frontend-design', 'skill-creator'] },
  { terms: ['*'], repo: 'vercel-labs/agent-skills', skills: ['vercel-react-best-practices', 'web-design-guidelines'] },
  { terms: ['node', 'typescript', 'react', 'next'], repo: 'vercel-labs/agent-skills', skills: ['vercel-composition-patterns'] },
  { terms: ['python'], repo: 'anthropics/skills', skills: ['python-best-practices'] },
  { terms: ['dotnet', '.net'], repo: 'microsoft/azure-skills', skills: ['microsoft-foundry'] },
  { terms: ['android', 'kotlin'], repo: 'anthropics/skills', skills: ['frontend-design'] },
  { terms: ['rust'], repo: 'anthropics/skills', skills: ['code-review'] },
];

/**
 * Resolve the bundled `skills` CLI binary from cli-five's own node_modules.
 * Falls back to system npx/pnpx if resolution fails.
 */
function resolveSkillsBin() {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('skills/package.json');
    return { bin: join(dirname(pkgPath), 'bin', 'cli.mjs'), mode: 'bundled' };
  } catch {
    return null;
  }
}

/**
 * Detect whether pnpm is available in the user's environment.
 */
function hasPnpm() {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether npx is available.
 */
function hasNpx() {
  try {
    execFileSync('npx', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the command + args to run a skills CLI command.
 * Priority: bundled binary > pnpm dlx > npx
 */
function buildSkillsCmd(skillsArgs, env) {
  const bundled = resolveSkillsBin();
  if (bundled) {
    return { cmd: process.execPath, args: [bundled.bin, ...skillsArgs] };
  }
  if (env.pnpm) {
    return { cmd: 'pnpm', args: ['dlx', 'skills', ...skillsArgs] };
  }
  if (env.npx) {
    return { cmd: 'npx', args: ['-y', 'skills', ...skillsArgs] };
  }
  return null;
}

export async function skillDiscovery({ cwd, answers, args }) {
  if (!args.skills) {
    log.dim('Skipping skills discovery (--no-skills).');
    return;
  }
  if (args.yes) {
    log.dim('Non-interactive mode — skipping skills picker. Run `npx skills find` later.');
    return;
  }

  // Detect environment
  const env = { pnpm: hasPnpm(), npx: hasNpx() };
  const bundled = resolveSkillsBin();

  // Verify we can run skills at all
  if (!bundled && !env.pnpm && !env.npx) {
    log.warn('Cannot run skills CLI: no bundled binary, npx, or pnpm found.');
    log.dim('Install Node.js with npm, or install pnpm, then re-run.');
    return;
  }

  // Suggest pnpm if not present (non-blocking, one-time)
  if (!env.pnpm && !args.yes) {
    const { wantPnpm } = await prompts({
      type: 'confirm',
      name: 'wantPnpm',
      message: 'pnpm not detected. Install pnpm? (faster installs, stricter deps, saves disk space)',
      initial: false,
    });
    if (wantPnpm) {
      log.info('Installing pnpm globally...');
      try {
        execFileSync('npm', ['install', '-g', 'pnpm'], { stdio: 'inherit' });
        env.pnpm = true;
        log.ok('pnpm installed.');
      } catch (err) {
        log.warn(`pnpm install failed: ${err.message}. Continuing with npm.`);
      }
    }
  }

  if (bundled) {
    log.dim('Using bundled skills CLI.');
  } else if (env.pnpm) {
    log.dim('Using pnpm to run skills CLI.');
  } else {
    log.dim('Using npx to run skills CLI.');
  }

  log.raw('');
  log.raw('Skill discovery powered by skills.sh (Vercel)');

  // 1. Build recommendations from catalog based on stack
  const recs = buildRecommendations(answers);
  if (recs.length === 0) {
    log.dim('No stack-specific recommendations found.');
  } else {
    log.raw('');
    log.raw(`  ${pad('Skill', 36)} ${pad('Repo', 36)}`);
    log.raw(`  ${'─'.repeat(36)} ${'─'.repeat(36)}`);
    for (const r of recs) {
      log.raw(`  ${pad(r.skill, 36)} ${pad(r.repo, 36)}`);
    }
    log.raw('');
  }

  // 2. Offer interactive search per stack term
  const terms = suggestSearches(answers);
  if (terms.length > 0) {
    log.dim(`Suggested searches: ${terms.map((t) => `"${t}"`).join(', ')}`);
    log.raw('');
  }

  // 3. Offer to launch interactive find for each term
  for (const term of terms) {
    const { go } = await prompts({
      type: 'confirm',
      name: 'go',
      message: `Search skills.sh for "${term}"?`,
      initial: true,
    });
    if (go) {
      await runSkills(['find', term], cwd, env);
    }
  }

  // 4. Offer to install from well-known repos
  if (recs.length > 0) {
    const { install } = await prompts({
      type: 'multiselect',
      name: 'install',
      message: 'Install recommended skills?',
      choices: recs.map((r) => ({
        title: `${r.skill} (${r.repo})`,
        value: r,
        selected: false,
      })),
      hint: 'Space to select, Enter to confirm',
    });

    if (install && install.length > 0) {
      // Group by repo
      const byRepo = new Map();
      for (const r of install) {
        if (!byRepo.has(r.repo)) byRepo.set(r.repo, []);
        byRepo.get(r.repo).push(r.skill);
      }
      for (const [repo, skills] of byRepo) {
        const skillArgs = skills.flatMap((s) => ['--skill', s]);
        log.info(`Installing from ${repo}: ${skills.join(', ')}`);
        await runSkills(['add', repo, ...skillArgs, '-a', 'github-copilot'], cwd, env);
      }

      // Offer to relocate from .agents/skills/ → .github/skills/
      await relocateSkills(cwd);
    }
  }

  // 5. Offer freeform catch-all
  const { freeform } = await prompts({
    type: 'confirm',
    name: 'freeform',
    message: 'Launch the full interactive skills browser?',
    initial: false,
  });
  if (freeform) {
    await runSkills(['find'], cwd, env);

    // The user may have installed skills via the browser — relocate again
    await relocateSkills(cwd);
  }

  log.dim('Done. Run `npx skills find` anytime to discover more.');
}

/**
 * Offer to move skills from .agents/skills/ to .github/skills/.
 * The skills CLI hardcodes .agents/skills/ for github-copilot.
 * VS Code Copilot discovers skills from both locations, but
 * .github/skills/ keeps everything co-located with the rest of
 * the Copilot customisation files.
 */
async function relocateSkills(cwd) {
  const src = join(cwd, '.agents', 'skills');
  const dest = join(cwd, '.github', 'skills');

  if (!existsSync(src)) return;

  // Collect candidates
  const candidates = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(join(src, entry.name, 'SKILL.md'))) continue;
    if (existsSync(join(dest, entry.name))) continue; // already there
    candidates.push(entry.name);
  }

  if (candidates.length === 0) return;

  log.raw('');
  log.raw(`  Skills were installed to .agents/skills/ (skills.sh default for Copilot).`);
  log.raw(`  cli-five prefers .github/skills/ to keep everything under .github/.`);
  log.raw(`  Both locations work — Copilot discovers either.`);
  log.raw('');
  log.raw(`  Skills to move: ${candidates.join(', ')}`);
  log.raw('');

  const { move } = await prompts({
    type: 'confirm',
    name: 'move',
    message: 'Move installed skills from .agents/skills/ → .github/skills/?',
    initial: true,
  });

  if (!move) {
    log.dim('Keeping skills in .agents/skills/. Both locations work fine.');
    return;
  }

  let moved = 0;
  for (const name of candidates) {
    const target = join(dest, name);
    mkdirSync(dest, { recursive: true });
    renameSync(join(src, name), target);
    moved++;
  }

  if (moved > 0) {
    log.ok(`Relocated ${moved} skill${moved > 1 ? 's' : ''} → .github/skills/`);

    // Clean up empty .agents/skills/ and .agents/ if empty
    try {
      const remaining = readdirSync(src);
      if (remaining.length === 0) {
        rmSync(src, { recursive: true });
        const agentsDir = join(cwd, '.agents');
        if (existsSync(agentsDir) && readdirSync(agentsDir).length === 0) {
          rmSync(agentsDir, { recursive: true });
        }
      }
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Run a skills CLI command interactively.
 */
function runSkills(skillsArgs, cwd, env) {
  const resolved = buildSkillsCmd(skillsArgs, env);
  if (!resolved) {
    log.warn('skills CLI not available. Install npm/pnpm and retry.');
    return Promise.resolve();
  }
  return runInteractive(resolved.cmd, resolved.args, cwd);
}

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

function pad(s, n) {
  return (s || '').padEnd(n);
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
