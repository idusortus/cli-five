import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { writeFile, listFilesRecursive } from '../src/util/fs.mjs';
import { mergeDefaults } from '../src/util/merge.mjs';
import { scaffold } from '../src/steps/scaffold.mjs';
import { instructionGeneration } from '../src/steps/instructions.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-idempotency-'));
}

/** Minimal answers for an OpenCode scaffold. */
function answers(overrides = {}) {
  return {
    platform: 'opencode',
    projectName: 'demo',
    oneLiner: 'A demo project.',
    stack: ['Node'],
    frameworks: [],
    goals: 'Ship it.',
    constraints: 'None.',
    quickstart: 'npm test',
    costMode: 'mixed',
    docs: '',
    snark: false,
    provider: 'opencode',
    modelMap: { Orchestrator: 'opencode/gpt-5.3-codex' },
    customizedModels: true,
    codegraph: false,
    ...overrides,
  };
}

/** Read every file under root into a { relPath: contents } map. */
function snapshot(root) {
  const out = {};
  for (const file of listFilesRecursive(root)) {
    out[relative(root, file)] = readFileSync(file, 'utf8');
  }
  return out;
}

// ── writeFile policy ──────────────────────────────────────────────────

test('writeFile is idempotent and action-aware', () => {
  const dir = workspace();
  const p = join(dir, 'x.txt');

  assert.equal(writeFile(p, 'a').action, 'created');
  assert.equal(writeFile(p, 'a').action, 'unchanged');
  assert.equal(writeFile(p, 'b').action, 'updated');

  const q = join(dir, 'y.txt');
  writeFile(q, 'keep');
  assert.equal(writeFile(q, 'clobber', { policy: 'create' }).action, 'skipped');
  assert.equal(readFileSync(q, 'utf8'), 'keep');

  rmSync(dir, { recursive: true, force: true });
});

test('writeFile dryRun reports the action without writing', () => {
  const dir = workspace();
  const p = join(dir, 'x.txt');

  const r = writeFile(p, 'a', { dryRun: true });
  assert.equal(r.action, 'created');
  assert.equal(r.written, false);
  assert.equal(existsSync(p), false);

  rmSync(dir, { recursive: true, force: true });
});

// ── mergeDefaults ─────────────────────────────────────────────────────

test('mergeDefaults fills missing keys, preserves existing, and is idempotent', () => {
  const dir = workspace();
  const p = join(dir, 'opencode.json');
  writeFileSync(p, JSON.stringify({ model: 'keep-me', mcp: { mine: { type: 'local' } } }, null, 2));

  const defaults = { model: 'default', small_model: 'x', mcp: { codegraph: {} }, subagent_depth: 2 };
  assert.equal(mergeDefaults(p, defaults).action, 'updated');

  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(cfg.model, 'keep-me', 'existing scalar preserved');
  assert.deepEqual(cfg.mcp.mine, { type: 'local' }, 'existing nested key preserved');
  assert.equal(cfg.small_model, 'x', 'missing scalar seeded');
  assert.ok(cfg.mcp.codegraph !== undefined, 'missing nested key seeded');

  assert.equal(mergeDefaults(p, defaults).action, 'unchanged', 'second run is a no-op');

  rmSync(dir, { recursive: true, force: true });
});

// ── scaffold-level idempotency ────────────────────────────────────────

test('scaffold is idempotent: a second run changes no bytes', () => {
  const dir = workspace();
  scaffold({ cwd: dir, answers: answers(), args: {} });
  const before = snapshot(dir);

  const results = scaffold({ cwd: dir, answers: answers(), args: {} });
  const after = snapshot(dir);

  assert.deepEqual(after, before, 'second scaffold must not change any file');

  const changed = results.filter((r) => r.action !== 'unchanged' && r.action !== 'skipped');
  assert.equal(changed.length, 0, `expected all no-ops, got ${JSON.stringify(changed.map((r) => [r.path, r.action]))}`);
  assert.equal(results.filter((r) => r.written).length, 0, 'nothing should be written on re-run');

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold preserves user edits to memory files and config on re-run', () => {
  const dir = workspace();
  scaffold({ cwd: dir, answers: answers(), args: {} });

  writeFileSync(join(dir, 'STATE.md'), '# my state\n\nMINE\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS\n\nMINE\n');
  const cfgPath = join(dir, 'opencode.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.mcp = { codegraph: { type: 'local' } };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  scaffold({ cwd: dir, answers: answers(), args: {} });

  assert.equal(readFileSync(join(dir, 'STATE.md'), 'utf8'), '# my state\n\nMINE\n');
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), '# AGENTS\n\nMINE\n');
  assert.ok(JSON.parse(readFileSync(cfgPath, 'utf8')).mcp.codegraph, 'user MCP entry survives');

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold --force restores destructive overwrite for a deliberate reset', () => {
  const dir = workspace();
  scaffold({ cwd: dir, answers: answers(), args: {} });
  writeFileSync(join(dir, 'STATE.md'), 'MINE');

  scaffold({ cwd: dir, answers: answers(), args: { force: true } });

  assert.notEqual(readFileSync(join(dir, 'STATE.md'), 'utf8'), 'MINE');
  rmSync(dir, { recursive: true, force: true });
});

test('scaffold --dry-run writes no files', () => {
  const dir = workspace();
  const results = scaffold({ cwd: dir, answers: answers(), args: { dryRun: true } });

  assert.ok(results.length > 0, 'plan is non-empty');
  assert.deepEqual(snapshot(dir), {});
  assert.ok(results.every((r) => r.written === false));

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold with CodeGraph merges the AGENTS.md block exactly once across runs', () => {
  const dir = workspace();
  const a = answers({ codegraph: true });

  scaffold({ cwd: dir, answers: a, args: {} });
  const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

  scaffold({ cwd: dir, answers: a, args: {} });
  const second = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

  assert.equal(second, first, 're-run must not duplicate or alter the block');
  assert.equal((first.match(/CODEGRAPH_START/g) || []).length, 1, 'exactly one CodeGraph block');

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold is byte-stable across re-runs with CodeGraph enabled', () => {
  const dir = workspace();
  const a = answers({ codegraph: true });

  scaffold({ cwd: dir, answers: a, args: {} });
  const before = snapshot(dir);
  scaffold({ cwd: dir, answers: a, args: {} });

  assert.deepEqual(snapshot(dir), before);

  rmSync(dir, { recursive: true, force: true });
});

test('mergeDefaults rejects malformed or non-object JSON and seeds whitespace-only files', () => {
  const dir = workspace();

  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.throws(() => mergeDefaults(bad, { a: 1 }), /not valid JSON/);

  const arr = join(dir, 'arr.json');
  writeFileSync(arr, '[]');
  assert.throws(() => mergeDefaults(arr, { a: 1 }), /must contain a JSON object/);

  const blank = join(dir, 'blank.json');
  writeFileSync(blank, '   \n');
  assert.equal(mergeDefaults(blank, { a: 1 }).action, 'updated');
  assert.deepEqual(JSON.parse(readFileSync(blank, 'utf8')), { a: 1 });

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold leaves a malformed opencode.json untouched instead of crashing', () => {
  const dir = workspace();
  const cfgPath = join(dir, 'opencode.json');
  writeFileSync(cfgPath, '{ not valid json');

  const results = scaffold({ cwd: dir, answers: answers(), args: {} });

  assert.equal(readFileSync(cfgPath, 'utf8'), '{ not valid json', 'malformed config is not clobbered');
  const cfg = results.find((r) => r.path === cfgPath);
  assert.equal(cfg.action, 'skipped');

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold --force replaces opencode.json and user-owned files', () => {
  const dir = workspace();
  scaffold({ cwd: dir, answers: answers(), args: {} });

  writeFileSync(join(dir, 'AGENTS.md'), 'MINE');
  const cfgPath = join(dir, 'opencode.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.model = 'USER-MODEL';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  scaffold({ cwd: dir, answers: answers(), args: { force: true } });

  assert.notEqual(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'MINE');
  assert.notEqual(JSON.parse(readFileSync(cfgPath, 'utf8')).model, 'USER-MODEL');

  rmSync(dir, { recursive: true, force: true });
});

test('generated instruction files are create-once (reset with --force)', async () => {
  const dir = workspace();
  const a = answers({ stack: ['Node + TypeScript'] });

  const first = await instructionGeneration({ cwd: dir, answers: a, args: { yes: true } });
  assert.ok(first.some((w) => w.action === 'created'), 'first run creates instructions');

  const second = await instructionGeneration({ cwd: dir, answers: a, args: { yes: true } });
  assert.ok(second.length > 0);
  assert.ok(second.every((w) => w.action === 'skipped'), 're-run skips existing instructions');

  const forced = await instructionGeneration({ cwd: dir, answers: a, args: { yes: true, force: true } });
  assert.ok(forced.every((w) => w.action !== 'skipped'), '--force stops skipping');

  rmSync(dir, { recursive: true, force: true });
});
