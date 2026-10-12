import test from 'node:test';
import assert from 'node:assert/strict';
import { run, __testables } from '../src/cli.mjs';

const { parse } = __testables;

function captureOutput() {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };
  return {
    restore() {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
      return { stdout, stderr };
    },
  };
}

// ── Missing values ───────────────────────────────────────────────────

for (const flag of ['--doc', '--cost-mode', '--target', '--provider', '--cwd']) {
  test(`parse rejects ${flag} with no value when followed by another flag`, () => {
    const args = parse(['init', flag, '--yes']);
    assert.ok(args.error, `${flag} must record a parse error`);
    assert.match(args.error, new RegExp(`${flag} requires a value`));
  });

  test(`parse rejects ${flag} as the final token`, () => {
    const args = parse(['init', flag]);
    assert.ok(args.error, `${flag} must record a parse error`);
    assert.match(args.error, new RegExp(`${flag} requires a value`));
  });
}

test('parse leaves an unset flag at its default when its value is missing', () => {
  const args = parse(['init', '--cost-mode', '--yes']);
  assert.equal(args.costMode, null);
});

// ── Enum validation ──────────────────────────────────────────────────

test('parse accepts valid values for every enum flag', () => {
  const args = parse(['init', '--cost-mode', 'mixed', '--target', 'opencode', '--provider', 'opencode-go']);
  assert.equal(args.error, null);
  assert.equal(args.costMode, 'mixed');
  assert.equal(args.target, 'opencode');
  assert.equal(args.provider, 'opencode-go');
});

test('parse rejects an unknown --cost-mode and lists the valid set', () => {
  const args = parse(['init', '--cost-mode', 'fastest', '--yes']);
  assert.match(args.error, /fastest/);
  assert.match(args.error, /premium/);
  assert.match(args.error, /cheap/);
  assert.match(args.error, /mixed/);
});

test('parse rejects an unknown --target and lists the valid set', () => {
  const args = parse(['init', '--target', 'nope']);
  assert.match(args.error, /--target "nope" is not supported/);
  assert.match(args.error, /copilot/);
  assert.match(args.error, /opencode/);
});

test('parse rejects an unknown --provider and lists the valid set', () => {
  const args = parse(['init', '--provider', 'claude']);
  assert.match(args.error, /--provider "claude" is not supported/);
  assert.match(args.error, /opencode-go/);
});

test('parse accepts the --provider aliases normalizeProvider understands', () => {
  for (const [input, stored] of [
    ['zen', 'zen'],
    ['go', 'go'],
    ['github-copilot', 'github-copilot'],
    ['OpenCode-Go', 'opencode-go'],
  ]) {
    const args = parse(['init', '--provider', input]);
    assert.equal(args.error, null, `--provider ${input} must be accepted`);
    assert.equal(args.provider, stored, `--provider ${input} must be stored lowercased`);
  }
});

test('parse accepts mixed-case --target values', () => {
  for (const input of ['OpenCode', 'Copilot']) {
    const args = parse(['init', '--target', input]);
    assert.equal(args.error, null, `--target ${input} must be accepted`);
    assert.equal(args.target, input.toLowerCase());
  }
});

test('parse accepts a mixed-case --cost-mode', () => {
  const args = parse(['init', '--cost-mode', 'Mixed']);
  assert.equal(args.error, null);
  assert.equal(args.costMode, 'mixed');
});

// ── Preserved behavior ───────────────────────────────────────────────

test('parse keeps --doc repeatable', () => {
  const args = parse(['init', '--doc', 'a.md', '--doc', 'b.md']);
  assert.equal(args.error, null);
  assert.deepEqual(args.docs, ['a.md', 'b.md']);
});

test('parse still ignores unknown flags that take no value', () => {
  const args = parse(['init', '--wat', '--yes']);
  assert.equal(args.error, null);
  assert.equal(args.yes, true);
  assert.ok(args._.includes('--wat'));
});

// ── run() exits 2 before dispatching ─────────────────────────────────

test('run prints a missing-value error and exits 2 without dispatching', async () => {
  const before = process.exitCode;
  const capture = captureOutput();
  await run(['init', '--doc', '--yes']);
  const { stdout, stderr } = capture.restore();

  assert.equal(process.exitCode, 2, 'a parse error exits 2');
  assert.match(stderr, /--doc requires a value/);
  assert.match(stdout, /Usage/, 'help is printed with the error');
  assert.ok(!/cli-five init/.test(stdout + stderr), 'init must not run');

  process.exitCode = before;
});

test('run prints an invalid-enum error and exits 2', async () => {
  const before = process.exitCode;
  const capture = captureOutput();
  await run(['init', '--target', 'nope', '--yes']);
  const { stderr } = capture.restore();

  assert.equal(process.exitCode, 2, 'an invalid value exits 2');
  assert.match(stderr, /--target "nope" is not supported/);
  assert.match(stderr, /copilot, opencode/);

  process.exitCode = before;
});
