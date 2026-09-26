import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __testables, preferredProviderForAuth } from '../src/util/auth.mjs';
import { PROVIDER_ZEN, PROVIDER_GO } from '../src/util/models.mjs';

const { authFromFile, AUTH_ID_TO_PROVIDER } = __testables;

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-auth-'));
}

test('auth provider id map covers Zen and Go', () => {
  assert.equal(AUTH_ID_TO_PROVIDER.opencode, PROVIDER_ZEN);
  assert.equal(AUTH_ID_TO_PROVIDER['opencode-go'], PROVIDER_GO);
});

test('authFromFile reads providers from an auth.json', () => {
  const dir = workspace();
  const authFile = join(dir, 'auth.json');
  writeFileSync(authFile, JSON.stringify({ 'opencode-go': { type: 'api', key: 'x' } }));

  const prev = process.env.OPENCODE_AUTH_FILE;
  process.env.OPENCODE_AUTH_FILE = authFile;
  try {
    assert.deepEqual(authFromFile(), [PROVIDER_GO]);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_AUTH_FILE;
    else process.env.OPENCODE_AUTH_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authFromFile ignores unknown provider ids', () => {
  const dir = workspace();
  const authFile = join(dir, 'auth.json');
  writeFileSync(authFile, JSON.stringify({ someother: {}, 'opencode-go': {} }));

  const prev = process.env.OPENCODE_AUTH_FILE;
  process.env.OPENCODE_AUTH_FILE = authFile;
  try {
    assert.deepEqual(authFromFile(), [PROVIDER_GO]);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_AUTH_FILE;
    else process.env.OPENCODE_AUTH_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authFromFile falls through a malformed file rather than throwing', () => {
  const dir = workspace();
  const authFile = join(dir, 'auth.json');
  writeFileSync(authFile, '{ not json');

  const prev = process.env.OPENCODE_AUTH_FILE;
  process.env.OPENCODE_AUTH_FILE = authFile;
  try {
    // Must not throw. It either falls through to another auth source or null.
    const result = authFromFile();
    assert.ok(result === null || Array.isArray(result));
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_AUTH_FILE;
    else process.env.OPENCODE_AUTH_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preferredProviderForAuth returns null for non-opencode platforms', () => {
  assert.equal(preferredProviderForAuth('copilot'), null);
});
