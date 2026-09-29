import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOpenSpec, openspecToolFor, OPENSPEC_STATUS } from '../src/addons/openspec.mjs';
import { runOpenSpec } from '../src/addons/openspec-command.mjs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../src/util/platforms.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-openspec-'));
}

/** A scaffold that makes detectPlatform() resolve to OpenCode. */
function opencodeScaffold() {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  return dir;
}

/** Injectable exec that records every call and returns a fixed result. */
function recordingExec(result = { status: 0, stdout: '', stderr: '' }) {
  const calls = [];
  const exec = (cmd, argv, opts) => {
    calls.push({ cmd, argv, opts });
    return typeof result === 'function' ? result(cmd, argv, opts) : result;
  };
  return { exec, calls };
}

afterEach(() => {
  process.exitCode = 0;
});

// ── Detection ─────────────────────────────────────────────────────────

test('detectOpenSpec finds openspec/ and the OpenCode command + skill surfaces', () => {
  const dir = workspace();
  mkdirSync(join(dir, 'openspec'), { recursive: true });
  mkdirSync(join(dir, '.opencode', 'commands'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'commands', 'opsx-archive.md'), '# archive');
  mkdirSync(join(dir, '.opencode', 'skills', 'openspec-archive-change'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'skills', 'openspec-archive-change', 'SKILL.md'), '# skill');

  const signals = detectOpenSpec(dir);
  assert.ok(signals.includes('openspec/'));
  assert.ok(signals.includes('.opencode/commands/opsx-archive.md'));
  assert.ok(signals.includes('.opencode/skills/openspec-*/SKILL.md'));

  rmSync(dir, { recursive: true, force: true });
});

test('detectOpenSpec returns an empty list when nothing is present', () => {
  const dir = workspace();
  assert.deepEqual(detectOpenSpec(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

// ── Tool map ──────────────────────────────────────────────────────────

test('openspecToolFor maps both platforms to their --tools id and null otherwise', () => {
  assert.equal(openspecToolFor(PLATFORM_OPENCODE), 'opencode');
  assert.equal(openspecToolFor(PLATFORM_COPILOT), 'github-copilot');
  assert.equal(openspecToolFor('unknown'), null);
  assert.equal(openspecToolFor(undefined), null);
});

test('OPENSPEC_STATUS is a real non-boolean string', () => {
  assert.equal(typeof OPENSPEC_STATUS, 'string');
  assert.ok(OPENSPEC_STATUS.length > 0);
});

// ── Runner flow ───────────────────────────────────────────────────────

test('runOpenSpec runs `openspec init --tools opencode` when openspec/ is absent', async () => {
  const dir = opencodeScaffold();
  const { exec, calls } = recordingExec();

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.equal(calls[0].cmd, 'openspec');
  assert.deepEqual(calls[0].argv, ['--version']);
  assert.deepEqual(calls[1].argv, ['init', '--tools', 'opencode']);
  assert.equal(process.exitCode, 0);

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec runs `openspec update --force` when openspec/ is present', async () => {
  const dir = opencodeScaffold();
  mkdirSync(join(dir, 'openspec'), { recursive: true });
  const { exec, calls } = recordingExec();

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.deepEqual(calls[1].argv, ['update', '--force']);
  assert.equal(process.exitCode, 0);

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec details the Copilot tool id on a Copilot scaffold', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), '---\n---\n');
  const { exec, calls } = recordingExec();

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.deepEqual(calls[1].argv, ['init', '--tools', 'github-copilot']);

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec with a missing CLI prints the install line and writes nothing', async () => {
  const dir = opencodeScaffold();
  const { exec, calls } = recordingExec({ status: 127, stdout: '', stderr: 'spawnSync openspec ENOENT' });

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.equal(process.exitCode, 1);
  // Only the availability probe ran — no init/update mutation.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['--version']);
  assert.ok(!existsSync(join(dir, 'openspec')));

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec refuses a repo with no cli-five scaffold', async () => {
  const dir = workspace();
  const { exec, calls } = recordingExec();

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.equal(process.exitCode, 1);
  assert.equal(calls.length, 0, 'no exec at all when the platform is unknown');

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec dryRun prints the command without executing anything', async () => {
  const dir = opencodeScaffold();
  const { exec, calls } = recordingExec();

  await runOpenSpec({ cwd: dir, args: { dryRun: true }, exec });

  assert.equal(calls.length, 0, 'dryRun must not exec at all');
  assert.ok(!existsSync(join(dir, 'openspec')));

  rmSync(dir, { recursive: true, force: true });
});

test('runOpenSpec surfaces a non-zero init/update exit as failure', async () => {
  const dir = opencodeScaffold();
  const { exec } = recordingExec((_cmd, argv) =>
    argv[0] === '--version'
      ? { status: 0, stdout: '1.13.1', stderr: '' }
      : { status: 1, stdout: '', stderr: 'boom' }
  );

  await runOpenSpec({ cwd: dir, args: {}, exec });

  assert.equal(process.exitCode, 1);

  rmSync(dir, { recursive: true, force: true });
});
