import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __testables as pluginTestables } from '../templates/opencode/plugin/jev-tier-router/index.js';
import { runJev, JEVR_TOOL, JEVR_STATUS } from '../src/addons/jev.mjs';
import { mergeBlock } from '../src/util/merge.mjs';

const { classifyTask, CONFIDENCE_CUTOFF, FALLBACK_TIER } = pluginTestables;

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-jev-'));
}

// ── Classifier ────────────────────────────────────────────────────────

test('classifyTask routes a mechanical doc change to trivial', () => {
  const r = classifyTask('fix a typo in README');
  assert.equal(r.tier, 'trivial');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
  assert.equal(r.available, true);
  assert.equal(r.source, 'local_heuristic');
});

test('classifyTask routes a bounded local change to minor', () => {
  const r = classifyTask('add input validation to the login form');
  assert.equal(r.tier, 'minor');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
});

test('classifyTask routes an architectural change to major', () => {
  const r = classifyTask('redesign the saga retry architecture');
  assert.equal(r.tier, 'major');
  assert.ok(r.confidence >= CONFIDENCE_CUTOFF);
});

test('classifyTask fails toward the expensive tier when ambiguous', () => {
  const r = classifyTask('do the thing');
  if (r.confidence < CONFIDENCE_CUTOFF) {
    assert.equal(r.tier, FALLBACK_TIER);
  }
  assert.equal(FALLBACK_TIER, 'major');
});

test('classifyTask handles an empty description without throwing', () => {
  const r = classifyTask('');
  assert.equal(r.tier, 'major');
  assert.equal(r.available, true);
});

test('classifyTask tier is always one of the cli-five vocabulary', () => {
  for (const t of ['typo', 'small bug fix', 'rewrite the scheduler', '', 'xyzzy']) {
    assert.ok(['trivial', 'minor', 'major'].includes(classifyTask(t).tier), `bad tier for: ${t}`);
  }
});

// ── add jev (OpenCode target) ─────────────────────────────────────────

test('runJev scaffolds the plugin and wires opencode.json + AGENTS.md', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ $schema: 'x', model: 'keep-me' }, null, 2));
  writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\nKeep this.\n');

  await runJev({ cwd: dir, args: {} });

  // Plugin dir scaffolded with the confirmed convention
  const pluginDir = join(dir, '.opencode', 'plugin', 'jev-tier-router');
  assert.ok(existsSync(join(pluginDir, 'index.js')));
  assert.ok(existsSync(join(pluginDir, 'package.json')));
  const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['.'], './index.js');

  // opencode.json preserves existing keys and appends to plugins[]
  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.equal(cfg.model, 'keep-me');
  assert.ok(Array.isArray(cfg.plugins));
  assert.ok(cfg.plugins.includes('.opencode/plugin/jev-tier-router'));

  // AGENTS.md preserves prior content and gains the instruction
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('Keep this.'));
  assert.ok(agents.includes(JEVR_TOOL));
  assert.ok(agents.includes('<!-- JEV_TIER_ROUTING_START -->'));

  rmSync(dir, { recursive: true, force: true });
});

test('runJev is idempotent — re-running does not duplicate plugin entries', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({}, null, 2));

  await runJev({ cwd: dir, args: {} });
  await runJev({ cwd: dir, args: {} });

  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.equal(cfg.plugins.filter((p) => p.includes('jev-tier-router')).length, 1);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal((agents.match(/JEV_TIER_ROUTING_START/g) || []).length, 1);

  rmSync(dir, { recursive: true, force: true });
});

test('runJev preserves an existing plugins[] array (does not overwrite)', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ plugins: ['some/other-plugin'] }, null, 2));

  await runJev({ cwd: dir, args: {} });

  const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.ok(cfg.plugins.includes('some/other-plugin'));
  assert.ok(cfg.plugins.includes('.opencode/plugin/jev-tier-router'));

  rmSync(dir, { recursive: true, force: true });
});

// ── add jev (Copilot target) ──────────────────────────────────────────

test('runJev refuses cleanly on a Copilot target with no partial writes', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), '---\n---\n');
  const before = process.exitCode;

  await runJev({ cwd: dir, args: {} });

  assert.equal(process.exitCode, 1, 'refusal should set a non-zero exit code');
  assert.ok(!existsSync(join(dir, '.opencode')), 'no .opencode dir written');
  assert.ok(!existsSync(join(dir, 'opencode.json')), 'no opencode.json written');
  assert.ok(!existsSync(join(dir, 'AGENTS.md')), 'no AGENTS.md written');

  process.exitCode = before;
  rmSync(dir, { recursive: true, force: true });
});

// ── mergeBlock integration (same write path, no second merge approach) ──

test('jev writes go through mergeBlock and leave foreign JSON keys intact', () => {
  const dir = workspace();
  const file = join(dir, 'opencode.json');
  writeFileSync(file, JSON.stringify({ mcp: { codegraph: {} }, model: 'x' }, null, 2));

  mergeBlock(file, 'jev', { plugins: ['.opencode/plugin/jev-tier-router'] }, { track: true });

  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(cfg.mcp, { codegraph: {} });
  assert.equal(cfg.model, 'x');
  assert.deepEqual(cfg.$cliFive.blocks, ['jev']);

  rmSync(dir, { recursive: true, force: true });
});
