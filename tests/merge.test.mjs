import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeBlock } from '../src/util/merge.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-merge-'));
}

test('mergeBlock appends a fenced markdown block and preserves the rest', () => {
  const dir = workspace();
  const file = join(dir, 'AGENTS.md');
  writeFileSync(file, '# AGENTS\n\nExisting content.\n');

  const result = mergeBlock(file, 'codegraph', '## CodeGraph\n\nUse `codegraph explore`.');
  assert.equal(result.action, 'updated');

  const out = readFileSync(file, 'utf8');
  assert.ok(out.includes('# AGENTS'));
  assert.ok(out.includes('Existing content.'));
  assert.ok(out.includes('<!-- CODEGRAPH_START -->'));
  assert.ok(out.includes('## CodeGraph'));
  assert.ok(out.includes('<!-- CODEGRAPH_END -->'));

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock replaces an existing fenced block in place and is idempotent', () => {
  const dir = workspace();
  const file = join(dir, 'AGENTS.md');
  writeFileSync(file, '# AGENTS\n\nKeep me.\n');

  mergeBlock(file, 'codegraph', 'version one');
  const updated = mergeBlock(file, 'codegraph', 'version two');
  assert.equal(updated.action, 'updated');

  const out = readFileSync(file, 'utf8');
  assert.equal((out.match(/CODEGRAPH_START/g) || []).length, 1, 'block must not duplicate');
  assert.ok(out.includes('version two'));
  assert.ok(!out.includes('version one'));
  assert.ok(out.includes('Keep me.'));

  const unchanged = mergeBlock(file, 'codegraph', 'version two');
  assert.equal(unchanged.action, 'unchanged');

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock creates a missing markdown file', () => {
  const dir = workspace();
  const file = join(dir, 'nested', 'NOTES.md');

  const result = mergeBlock(file, 'jev', 'Jev notes.');
  assert.equal(result.action, 'created');
  assert.equal(readFileSync(file, 'utf8'), '<!-- JEV_START -->\nJev notes.\n<!-- JEV_END -->\n');

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock honours explicit fence markers', () => {
  const dir = workspace();
  const file = join(dir, 'NOTES.md');
  writeFileSync(file, 'head\n');

  mergeBlock(file, { name: 'x', start: '<<START>>', end: '<<END>>' }, 'body');
  const out = readFileSync(file, 'utf8');
  assert.ok(out.includes('<<START>>'));
  assert.ok(out.includes('<<END>>'));

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock deep-merges JSON and preserves existing keys', () => {
  const dir = workspace();
  const file = join(dir, 'opencode.json');
  writeFileSync(file, JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'x' }, null, 2));

  const result = mergeBlock(file, 'codegraph', {
    mcp: { codegraph: { type: 'local', command: ['codegraph', 'serve', '--mcp'], enabled: true } },
  });
  assert.equal(result.action, 'updated');

  const out = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(out.$schema, 'https://opencode.ai/config.json');
  assert.equal(out.model, 'x');
  assert.equal(out.mcp.codegraph.type, 'local');
  assert.deepEqual(out.mcp.codegraph.command, ['codegraph', 'serve', '--mcp']);

  const again = mergeBlock(file, 'codegraph', {
    mcp: { codegraph: { type: 'local', command: ['codegraph', 'serve', '--mcp'], enabled: true } },
  });
  assert.equal(again.action, 'unchanged');

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock nests JSON under fenceKey', () => {
  const dir = workspace();
  const file = join(dir, '.vscode', 'mcp.json');
  mkdirSync(join(dir, '.vscode'), { recursive: true });
  writeFileSync(file, JSON.stringify({ servers: { other: { command: 'x' } } }, null, 2));

  mergeBlock(file, 'codegraph', { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } }, { fenceKey: 'servers' });

  const out = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(out.servers.other.command, 'x');
  assert.equal(out.servers.codegraph.command, 'codegraph');

  rmSync(dir, { recursive: true, force: true });
});

test('mergeBlock rejects invalid JSON input', () => {
  const dir = workspace();
  const file = join(dir, 'opencode.json');
  writeFileSync(file, '{ not json');

  assert.throws(() => mergeBlock(file, 'codegraph', { a: 1 }), /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});
