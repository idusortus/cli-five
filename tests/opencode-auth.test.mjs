import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { resolveOpencodeAuthCandidates, extractOpencodeStoreKey, opencodeStoreProviderIds } from '../src/util/opencode-auth.mjs';
import { resolveJevCredential } from '../templates/opencode/plugin/jev-tier-router/index.js';
import * as vendored from '../templates/opencode/plugin/jev-tier-router/auth.mjs';
import { __testables as authTestables } from '../src/util/auth.mjs';

const HOME_FALLBACK = join('/home/tester', '.local', 'share', 'opencode', 'auth.json');

test('resolveOpencodeAuthCandidates prefers an absolute OPENCODE_AUTH_FILE', () => {
  const explicit = join('/tmp', 'explicit-auth.json');
  const candidates = resolveOpencodeAuthCandidates({ env: { OPENCODE_AUTH_FILE: explicit }, homeDir: '/home/tester' });
  assert.equal(candidates[0], explicit);
  assert.ok(candidates.every(isAbsolute), 'every candidate must be absolute');
});

test('resolveOpencodeAuthCandidates ignores a relative OPENCODE_AUTH_FILE', () => {
  const candidates = resolveOpencodeAuthCandidates({
    env: { OPENCODE_AUTH_FILE: './opencode/auth.json' },
    homeDir: '/home/tester',
  });
  assert.ok(!candidates.includes('./opencode/auth.json'));
  assert.ok(candidates.every(isAbsolute));
  assert.ok(candidates.includes(HOME_FALLBACK));
});

test('resolveOpencodeAuthCandidates uses an absolute XDG_DATA_HOME', () => {
  const candidates = resolveOpencodeAuthCandidates({ env: { XDG_DATA_HOME: '/xdg-data' }, homeDir: '/h' });
  assert.equal(candidates[0], join('/xdg-data', 'opencode', 'auth.json'));
});

test('resolveOpencodeAuthCandidates ignores a relative XDG_DATA_HOME and falls back home', () => {
  const candidates = resolveOpencodeAuthCandidates({ env: { XDG_DATA_HOME: 'relative/xdg' }, homeDir: '/h' });
  assert.deepEqual(candidates, [join('/h', '.local', 'share', 'opencode', 'auth.json')]);
  assert.ok(candidates.every(isAbsolute));
});

test('resolveOpencodeAuthCandidates with no env yields only the absolute home fallback', () => {
  const candidates = resolveOpencodeAuthCandidates({ env: {}, homeDir: '/h' });
  assert.deepEqual(candidates, [join('/h', '.local', 'share', 'opencode', 'auth.json')]);
});

test('extractOpencodeStoreKey reads both shapes and rejects junk', () => {
  assert.equal(extractOpencodeStoreKey({ 'opencode-go': { key: 'top' } }), 'top');
  assert.equal(extractOpencodeStoreKey({ providers: { 'opencode-go': { key: 'nested' } } }), 'nested');
  assert.equal(
    extractOpencodeStoreKey({ 'opencode-go': { label: 'no key' }, providers: { 'opencode-go': { key: 'from-providers' } } }),
    'from-providers',
  );
  assert.equal(extractOpencodeStoreKey({ 'opencode-go': {} }), null);
  assert.equal(extractOpencodeStoreKey({ 'opencode-go': { key: '   ' } }), null);
  assert.equal(extractOpencodeStoreKey({ opencode: { key: 'zen' } }), null);
  assert.equal(extractOpencodeStoreKey(null), null);
  assert.equal(extractOpencodeStoreKey('nope'), null);
  assert.equal(extractOpencodeStoreKey(undefined), null);
});

test('opencodeStoreProviderIds reports provider presence from both store shapes', () => {
  assert.deepEqual(opencodeStoreProviderIds({ 'opencode-go': { key: 'k' } }), ['opencode-go']);
  assert.deepEqual(opencodeStoreProviderIds({ providers: { opencode: {}, 'opencode-go': { key: 'k' } } }), [
    'opencode',
    'opencode-go',
  ]);
  assert.deepEqual(opencodeStoreProviderIds({ 'opencode-go': {} }), ['opencode-go'], 'presence counts even without a key');
  assert.deepEqual(opencodeStoreProviderIds({ providers: { other: {} } }), ['other']);
  assert.deepEqual(opencodeStoreProviderIds(null), []);
  assert.deepEqual(opencodeStoreProviderIds('junk'), []);
});

test('the vendored plugin copy matches the canonical reader for the same inputs', () => {
  const optionSets = [
    { env: {}, homeDir: '/h' },
    { env: { XDG_DATA_HOME: '/x' }, homeDir: '/h' },
    { env: { OPENCODE_AUTH_FILE: '/a/b.json', XDG_DATA_HOME: 'rel' }, homeDir: '/h' },
    { env: { OPENCODE_AUTH_FILE: './rel.json' }, homeDir: '/h' },
  ];
  for (const opts of optionSets) {
    assert.deepEqual(vendored.resolveOpencodeAuthCandidates(opts), resolveOpencodeAuthCandidates(opts));
  }

  const stores = [
    { 'opencode-go': { key: 'k' } },
    { providers: { 'opencode-go': { key: 'p' } } },
    { 'opencode-go': {} },
    {},
    null,
    'junk',
  ];
  for (const store of stores) {
    assert.equal(vendored.extractOpencodeStoreKey(store), extractOpencodeStoreKey(store));
    assert.deepEqual(
      vendored.opencodeStoreProviderIds(store),
      opencodeStoreProviderIds(store),
      'the vendored provider-presence parse must match the canonical reader',
    );
  }
});

test('cli-five detection and the Jev plugin resolve the same absolute credential', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-five-auth-shared-'));
  const file = join(dir, 'auth.json');
  writeFileSync(file, JSON.stringify({ providers: { 'opencode-go': { key: 'shared-key' } } }));

  const prev = process.env.OPENCODE_AUTH_FILE;
  process.env.OPENCODE_AUTH_FILE = file;
  try {
    assert.deepEqual(authTestables.authFromFile(), ['opencode-go'], 'cli-five detects Go by presence');
    const cred = resolveJevCredential({ env: { OPENCODE_AUTH_FILE: file } });
    assert.equal(cred.provider, 'opencode');
    assert.equal(cred.key, 'shared-key', 'the plugin reads the same key from the same file');
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_AUTH_FILE;
    else process.env.OPENCODE_AUTH_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
