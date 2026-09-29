import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmOverwriteIfNeeded } from '../src/steps/confirm.mjs';
import { instructionGeneration } from '../src/steps/instructions.mjs';
import { readJsonFile } from '../src/util/fs.mjs';
import { scaffold } from '../src/steps/scaffold.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-hardening-'));
}

function answers(overrides = {}) {
  return {
    platform: 'opencode',
    projectName: 'demo',
    oneLiner: 'A demo.',
    stack: ['Node'],
    frameworks: [],
    goals: '',
    constraints: '',
    quickstart: '',
    costMode: 'mixed',
    docs: '',
    snark: false,
    provider: 'opencode',
    modelMap: {},
    customizedModels: false,
    codegraph: false,
    ...overrides,
  };
}

test('confirmOverwriteIfNeeded never prompts under --yes', async () => {
  const collisions = {
    hasAgents: true,
    hasCopilotInstructions: true,
    hasOpencodeAgents: true,
    hasOpencodeConfig: true,
  };

  assert.equal(await confirmOverwriteIfNeeded(collisions, { yes: true }), true);
  assert.equal(await confirmOverwriteIfNeeded(collisions, { yes: true, force: true }), true);
  assert.equal(await confirmOverwriteIfNeeded({}, { yes: false }), true, 'no collisions → proceed');
});

test('readJsonFile returns null for missing/invalid and parses valid JSON', () => {
  const dir = workspace();

  assert.equal(readJsonFile(join(dir, 'nope.json')), null);
  writeFileSync(join(dir, 'bad.json'), '{ nope');
  assert.equal(readJsonFile(join(dir, 'bad.json')), null);
  writeFileSync(join(dir, 'ok.json'), '{"a":1}');
  assert.deepEqual(readJsonFile(join(dir, 'ok.json')), { a: 1 });

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold under --yes keeps an existing managed file; --force overwrites', () => {
  const dir = workspace();
  const a = answers();
  const agent = join(dir, '.opencode', 'agents', 'orchestrator.md');

  scaffold({ cwd: dir, answers: a, args: {} });
  writeFileSync(agent, 'MINE');

  scaffold({ cwd: dir, answers: a, args: { yes: true } });
  assert.equal(readFileSync(agent, 'utf8'), 'MINE', '--yes must not clobber managed files');

  scaffold({ cwd: dir, answers: a, args: { yes: true, force: true } });
  assert.notEqual(readFileSync(agent, 'utf8'), 'MINE', '--force restores overwrite');

  rmSync(dir, { recursive: true, force: true });
});

test('instructionGeneration matches on stable stackIds when labels are absent', async () => {
  const dir = workspace();

  const written = await instructionGeneration({
    cwd: dir,
    answers: { stack: [], stackIds: ['node-ts'] },
    args: { yes: true },
  });

  assert.ok(written.some((w) => w.path.endsWith('typescript.instructions.md')));

  rmSync(dir, { recursive: true, force: true });
});

test('instructionGeneration links a skill installed under .opencode/skills', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'skills', 'frontend-design'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'skills', 'frontend-design', 'SKILL.md'), '# skill');

  const written = await instructionGeneration({
    cwd: dir,
    answers: { stack: [], stackIds: ['node-ts'] },
    args: { yes: true },
  });

  const ts = written.find((w) => w.path.endsWith('typescript.instructions.md'));
  assert.ok(ts, 'typescript instructions generated');
  assert.match(readFileSync(ts.path, 'utf8'), /frontend-design/);

  rmSync(dir, { recursive: true, force: true });
});

test('scaffold with CodeGraph skips a malformed opencode.json instead of crashing', () => {
  const dir = workspace();
  const cfgPath = join(dir, 'opencode.json');
  writeFileSync(cfgPath, '{ not valid json');

  const results = scaffold({ cwd: dir, answers: answers({ codegraph: true }), args: {} });

  assert.equal(readFileSync(cfgPath, 'utf8'), '{ not valid json', 'malformed config left untouched');
  assert.ok(existsSync(join(dir, '.opencode', 'agents', 'orchestrator.md')), 'agents still scaffolded');
  assert.ok(results.length > 0);

  rmSync(dir, { recursive: true, force: true });
});
