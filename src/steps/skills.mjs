import prompts from 'prompts';
import { spawn, execFileSync } from 'node:child_process';
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

export async function skillDiscovery({ cwd, answers, args }) {
  if (!args.skills) {
    log.dim('Skipping skills discovery (--no-skills).');
    return;
  }
  if (args.yes) {
    log.dim('Non-interactive mode — skipping skills picker. Run `npx skills find` later.');
    return;
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
      await runInteractive('npx', ['-y', 'skills', 'find', term], cwd);
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
        await runInteractive(
          'npx',
          ['-y', 'skills', 'add', repo, ...skillArgs, '-a', 'github-copilot'],
          cwd,
        );
      }
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
    await runInteractive('npx', ['-y', 'skills', 'find'], cwd);
  }

  log.dim('Done. Run `npx skills find` anytime to discover more.');
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
