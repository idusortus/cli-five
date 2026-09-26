import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoProjectInfo, extractReadmeHints } from '../src/util/project.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-project-'));
}

test('extractReadmeHints pulls the first H1 and first prose line', () => {
  const hints = extractReadmeHints('# My App\n\n> A tagged line.\n\nBuilds cool things.\n\n## Usage\n');
  assert.equal(hints.name, 'My App');
  assert.equal(hints.oneLiner, 'Builds cool things.');
});

test('extractReadmeHints ignores badges and images before prose', () => {
  const hints = extractReadmeHints('# Widget\n\n[![build](x)](y)\n\nActual description.\n');
  assert.equal(hints.name, 'Widget');
  assert.equal(hints.oneLiner, 'Actual description.');
});

test('autoProjectInfo reads name and description from package.json', () => {
  const dir = workspace();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-lib', description: 'Does a thing.' }));

  const info = autoProjectInfo(dir);
  assert.equal(info.name.value, 'my-lib');
  assert.equal(info.name.ambiguous, false);
  assert.equal(info.oneLiner.value, 'Does a thing.');

  rmSync(dir, { recursive: true, force: true });
});

test('autoProjectInfo flags ambiguity when package.json and README disagree', () => {
  const dir = workspace();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@scope/widget' }));
  writeFileSync(join(dir, 'README.md'), '# Widget\n\n');

  const info = autoProjectInfo(dir);
  assert.equal(info.name.value, '@scope/widget');
  assert.equal(info.name.ambiguous, true);

  rmSync(dir, { recursive: true, force: true });
});

test('autoProjectInfo returns empty results for an empty workspace', () => {
  const dir = workspace();
  const info = autoProjectInfo(dir);
  assert.equal(info.name.value, '');
  assert.equal(info.oneLiner.value, '');
  assert.equal(info.name.ambiguous, false);
  rmSync(dir, { recursive: true, force: true });
});
