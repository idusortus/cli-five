import prompts from 'prompts';
import kleur from 'kleur';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { log } from '../util/log.mjs';

// ── Awesome-copilot catalog (github/awesome-copilot) ──────────────────
// Curated subset mapped by stack term → { name, description, type }
const AWESOME_CATALOG = [
  // Universal
  { terms: ['*'], name: 'frontend-design', desc: 'Production-grade UI design', type: 'skill', source: 'awesome-copilot' },
  { terms: ['*'], name: 'conventional-commit', desc: 'Commit message standards', type: 'skill', source: 'awesome-copilot' },
  { terms: ['*'], name: 'documentation-writer', desc: 'Generate project docs', type: 'skill', source: 'awesome-copilot' },
  { terms: ['*'], name: 'mermaid-diagrams', desc: 'Create software diagrams', type: 'skill', source: 'awesome-copilot' },
  // JavaScript / TypeScript / React / Next
  { terms: ['node', 'typescript', 'javascript'], name: 'typescript', desc: 'TypeScript best practices', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['react', 'next'], name: 'reactjs', desc: 'React patterns & conventions', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['next'], name: 'nextjs', desc: 'Next.js patterns', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['node', 'typescript', 'react', 'next'], name: 'playwright-tester', desc: 'E2E testing with Playwright', type: 'skill', source: 'awesome-copilot' },
  // Python
  { terms: ['python', 'django', 'flask', 'fastapi'], name: 'python', desc: 'Python best practices', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['django'], name: 'django', desc: 'Django conventions', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['fastapi'], name: 'fastapi', desc: 'FastAPI patterns', type: 'instruction', source: 'awesome-copilot' },
  // .NET
  { terms: ['dotnet', '.net', 'csharp', 'c#'], name: 'dotnet', desc: '.NET conventions', type: 'instruction', source: 'awesome-copilot' },
  // Rust
  { terms: ['rust'], name: 'rust', desc: 'Rust best practices', type: 'instruction', source: 'awesome-copilot' },
  // Go
  { terms: ['go', 'golang'], name: 'go', desc: 'Go conventions', type: 'instruction', source: 'awesome-copilot' },
  // Mobile
  { terms: ['swift', 'ios'], name: 'swift', desc: 'Swift/iOS patterns', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['kotlin', 'android'], name: 'kotlin', desc: 'Kotlin/Android patterns', type: 'instruction', source: 'awesome-copilot' },
  // DevOps / Infra
  { terms: ['docker', 'kubernetes', 'devops'], name: 'docker', desc: 'Docker best practices', type: 'instruction', source: 'awesome-copilot' },
  { terms: ['terraform'], name: 'terraform', desc: 'Terraform conventions', type: 'instruction', source: 'awesome-copilot' },
];

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
    // Still show awesome-copilot recs (they don't need skills CLI)
    await showAwesomeCopilotOnly(answers);
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

  // ── Build recommendations from BOTH sources ─────────────────────────
  const awesomeRecs = buildAwesomeRecommendations(answers);
  const skillsShRecs = buildRecommendations(answers);

  // ── Display hero section ────────────────────────────────────────────
  displayHeroRecommendations(awesomeRecs, skillsShRecs, answers);

  // ── Combined picker ─────────────────────────────────────────────────
  const terms = suggestSearches(answers);

  // Search skills.sh for additional results
  const allFound = [];
  if (terms.length > 0) {
    log.dim(`Suggested searches: ${terms.map((t) => `"${t}"`).join(', ')}`);
    log.raw('');

    for (const term of terms) {
      const { go } = await prompts({
        type: 'confirm',
        name: 'go',
        message: `Search skills.sh for "${term}"?`,
        initial: true,
      });
      if (go) {
        const output = await runSkillsCapture(env, ['find', term], cwd);
        allFound.push(...parseSkillRefs(output));
      }
    }
  }

  // Build combined skill picker — awesome recs + catalog recs + search results
  const seen = new Set();
  const choices = [];

  // Awesome-copilot recs first (hero placement)
  for (const r of awesomeRecs) {
    const key = `awesome:${r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      title: `${kleur.cyan('⬡')} ${r.name} ${kleur.dim(`(${r.desc})`)} ${kleur.cyan('← awesome-copilot')}`,
      value: { source: 'awesome', name: r.name, type: r.type },
      selected: true,
    });
  }

  // skills.sh catalog recs
  for (const r of skillsShRecs) {
    const ref = `${r.repo}@${r.skill}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    choices.push({
      title: `${kleur.yellow('◆')} ${r.skill} ${kleur.dim(`(${r.repo})`)} ${kleur.yellow('← skills.sh')}`,
      value: { source: 'skillssh', ref, repo: r.repo, skill: r.skill },
      selected: true,
    });
  }

  // skills.sh search results
  for (const r of allFound) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    choices.push({
      title: `${kleur.yellow('◆')} ${r.ref} ${kleur.dim(`— ${r.installs}`)} ${kleur.yellow('← skills.sh')}`,
      value: { source: 'skillssh', ref: r.ref },
      selected: false,
    });
  }

  if (choices.length > 0) {
    log.raw('');
    const { toInstall } = await prompts({
      type: 'multiselect',
      name: 'toInstall',
      message: 'Select skills to install',
      choices,
      hint: 'Space to toggle, Enter to confirm',
    });

    if (toInstall && toInstall.length > 0) {
      // Separate awesome-copilot entries from skills.sh entries
      const awesomeItems = toInstall.filter((i) => i.source === 'awesome');
      const skillsShItems = toInstall.filter((i) => i.source === 'skillssh');

      // Install awesome-copilot skills/instructions via npx skills (they're in the registry too)
      if (awesomeItems.length > 0) {
        log.raw('');
        log.info(`${kleur.cyan('awesome-copilot')} resources selected: ${awesomeItems.map((i) => i.name).join(', ')}`);
        log.dim('These will be installed via skills CLI from the awesome-copilot registry.');
        for (const item of awesomeItems) {
          log.info(`Installing ${item.name} (${item.type})...`);
          await runSkills(env, ['add', `awesome-copilot@${item.name}`, '-a', 'github-copilot'], cwd);
        }
      }

      // Install skills.sh entries
      if (skillsShItems.length > 0) {
        const byRepo = new Map();
        const standalone = [];

        for (const item of skillsShItems) {
          if (item.repo) {
            if (!byRepo.has(item.repo)) byRepo.set(item.repo, []);
            byRepo.get(item.repo).push(item.skill);
          } else {
            standalone.push(item.ref);
          }
        }

        for (const [repo, skills] of byRepo) {
          const skillArgs = skills.flatMap((s) => ['--skill', s]);
          log.info(`Installing from ${repo}: ${skills.join(', ')}`);
          await runSkills(env, ['add', repo, ...skillArgs, '-a', 'github-copilot'], cwd);
        }

        for (const ref of standalone) {
          log.info(`Installing ${ref}...`);
          await runSkills(env, ['add', ref, '-a', 'github-copilot'], cwd);
        }
      }

      await relocateSkills(cwd);
    }
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

function displayHeroRecommendations(awesomeRecs, skillsShRecs, answers) {
  const stackLabel = [...(answers.stack || []), ...(answers.frameworks || [])].join(', ') || 'general';

  log.raw('');
  log.raw(kleur.bold().cyan('  ╔══════════════════════════════════════════════════════════════════╗'));
  log.raw(kleur.bold().cyan('  ║') + kleur.bold('  📦 RECOMMENDED FOR YOUR STACK: ') + kleur.bold().white(stackLabel) + pad('', Math.max(0, 30 - stackLabel.length)) + kleur.bold().cyan(' ║'));
  log.raw(kleur.bold().cyan('  ╚══════════════════════════════════════════════════════════════════╝'));

  if (awesomeRecs.length > 0) {
    log.raw('');
    log.raw(kleur.cyan('  ⬡ Source: awesome-copilot') + kleur.dim('  (github/awesome-copilot · 30k+ ★)'));
    log.raw(kleur.dim('  ─────────────────────────────────────────────────────────'));
    for (const r of awesomeRecs) {
      const typeTag = kleur.dim(`[${r.type}]`);
      log.raw(`    ${kleur.green('✓')} ${pad(r.name, 28)} ${pad(r.desc, 32)} ${typeTag}`);
    }
  }

  if (skillsShRecs.length > 0) {
    log.raw('');
    log.raw(kleur.yellow('  ◆ Source: skills.sh') + kleur.dim('  (skills.sh registry)'));
    log.raw(kleur.dim('  ─────────────────────────────────────────────────────────'));
    for (const r of skillsShRecs) {
      log.raw(`    ${kleur.green('✓')} ${pad(r.skill, 28)} ${kleur.dim(r.repo)}`);
    }
  }

  log.raw('');
}

/** Fallback when skills CLI is unavailable — show awesome-copilot recs as copy-paste commands */
async function showAwesomeCopilotOnly(answers) {
  const recs = buildAwesomeRecommendations(answers);
  if (recs.length === 0) return;

  log.raw('');
  log.info('Cannot install skills automatically, but here are recommendations:');
  displayHeroRecommendations(recs, [], answers);
  log.raw(kleur.dim('  Install manually in VS Code Chat:'));
  for (const r of recs) {
    log.raw(`    ${kleur.white(`copilot plugin install awesome-copilot@${r.name}`)}`);
  }
  log.raw('');
  printBreadcrumbs();
}

// ── Post-install breadcrumbs ──────────────────────────────────────────

function printBreadcrumbs() {
  log.raw('');
  log.raw(kleur.bold().green('  ┌──────────────────────────────────────────────────────────────────┐'));
  log.raw(kleur.bold().green('  │') + kleur.bold('  🎯 KEEP DISCOVERING — paste into VS Code / Copilot Chat:       ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  ├──────────────────────────────────────────────────────────────────┤'));
  log.raw(kleur.bold().green('  │') + '                                                                  ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '  Install the awesome-copilot suggestion skill:                   ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.white('    copilot plugin install awesome-copilot@suggest              ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '                                                                  ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '  Add awesome-copilot MCP for ongoing search:                     ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.white('    Add to .vscode/mcp.json:                                   ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.dim('      "awesome-copilot": {                                     ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.dim('        "command": "npx",                                      ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.dim('        "args": ["-y", "awesome-copilot-mcp"]                  ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.dim('      }                                                        ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '                                                                  ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '  Browse skills anytime:                                          ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + kleur.white('    npx skills find                                            ') + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  │') + '                                                                  ' + kleur.bold().green('│'));
  log.raw(kleur.bold().green('  └──────────────────────────────────────────────────────────────────┘'));
  log.raw('');
}

// ── Awesome-copilot recommendation builder ────────────────────────────

function buildAwesomeRecommendations(a) {
  const stackLower = (a.stack || []).map((s) => s.toLowerCase());
  const fwLower = (a.frameworks || []).map((f) => f.toLowerCase());
  const all = [...stackLower, ...fwLower];
  const seen = new Set();
  const out = [];

  for (const entry of AWESOME_CATALOG) {
    const matches = entry.terms.includes('*') || entry.terms.some((t) => all.some((s) => s.includes(t)));
    if (!matches) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push({ name: entry.name, desc: entry.desc, type: entry.type, source: entry.source });
  }
  return out;
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

/** Run skills CLI, capture stdout/stderr while echoing to the terminal. */
function runSkillsCapture(env, skillsArgs, cwd) {
  const { cmd, args } = env.runner(skillsArgs);
  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(cmd, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
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
    proc.on('exit', () => resolve(output));
    proc.on('error', (err) => {
      log.warn(`Could not launch \`${cmd} ${args.join(' ')}\`: ${err.message}`);
      resolve('');
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
