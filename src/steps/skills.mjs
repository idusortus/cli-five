import prompts from 'prompts';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
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
  const pnpmVer = whichVersion('pnpm');
  const npxVer = whichVersion('npx');
  const projectPnpm = projectUsesPnpm(cwd);

  // ── Terse status lines ────────────────────────────────────────────
  log.info(`skills CLI (bundled) ${bundledBin ? '✓' : '✗ not resolved'}`);
  log.info(`pnpm                 ${pnpmVer ? `✓ ${pnpmVer}` : '✗ not found'}${projectPnpm ? '  (project uses pnpm)' : ''}`);
  log.info(`npx                  ${npxVer ? `✓ ${npxVer}` : '✗ not found'}`);

  // ── Priority: bundled > pnpm (if project or system) > npx ─────────
  if (bundledBin) {
    return {
      label: 'bundled skills CLI',
      runner: (skillsArgs) => ({ cmd: process.execPath, args: [bundledBin, ...skillsArgs] }),
      pnpmVer,
      npxVer,
      projectPnpm,
    };
  }
  if (pnpmVer) {
    return {
      label: 'pnpm dlx',
      runner: (skillsArgs) => ({ cmd: 'pnpm', args: ['dlx', 'skills', ...skillsArgs] }),
      pnpmVer,
      npxVer,
      projectPnpm,
    };
  }
  if (npxVer) {
    return {
      label: 'npx',
      runner: (skillsArgs) => ({ cmd: 'npx', args: ['-y', 'skills', ...skillsArgs] }),
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
  const env = detectEnv(cwd);

  if (!env) {
    log.warn('Cannot run skills CLI: no bundled binary, pnpm, or npx found.');
    log.warn('Install Node.js (includes npx) or pnpm, then re-run.');
    return;
  }

  // Offer pnpm if the user doesn't have it
  if (!env.pnpmVer) {
    const { wantPnpm } = await prompts({
      type: 'confirm',
      name: 'wantPnpm',
      message: 'pnpm not found. Install it? (faster, stricter deps, saves disk)',
      initial: false,
    });
    if (wantPnpm) {
      try {
        execFileSync('npm', ['install', '-g', 'pnpm'], { stdio: 'inherit' });
        log.ok('pnpm installed.');
      } catch (err) {
        log.warn(`pnpm install failed: ${err.message}`);
      }
    }
  }

  log.ok(`Running skills via ${env.label}`);
  log.raw('');

  // ── Skill discovery ─────────────────────────────────────────────────

  // 1. Build recommendations from catalog based on stack
  const recs = buildRecommendations(answers);
  if (recs.length === 0) {
    log.dim('No stack-specific recommendations found.');
  } else {
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

  for (const term of terms) {
    const { go } = await prompts({
      type: 'confirm',
      name: 'go',
      message: `Search skills.sh for "${term}"?`,
      initial: true,
    });
    if (go) {
      await runSkills(env, ['find', term], cwd);
    }
  }

  // 3. Offer to install from well-known repos
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
      const byRepo = new Map();
      for (const r of install) {
        if (!byRepo.has(r.repo)) byRepo.set(r.repo, []);
        byRepo.get(r.repo).push(r.skill);
      }
      for (const [repo, skills] of byRepo) {
        const skillArgs = skills.flatMap((s) => ['--skill', s]);
        log.info(`Installing from ${repo}: ${skills.join(', ')}`);
        await runSkills(env, ['add', repo, ...skillArgs, '-a', 'github-copilot'], cwd);
      }

      await relocateSkills(cwd);
    }
  }

  // 4. Offer freeform catch-all
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

  log.dim('Done. Run `npx skills find` anytime to discover more.');
}

// ── Relocation ─────────────────────────────────────────────────────────

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

// ── Runner ─────────────────────────────────────────────────────────────

function runSkills(env, skillsArgs, cwd) {
  const { cmd, args } = env.runner(skillsArgs);
  return runInteractive(cmd, args, cwd);
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
