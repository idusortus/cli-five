import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADDON_NAMES,
  detectAddon,
  detectCodeGraph,
  detectJev,
  getAddon,
  listAddons,
} from '../src/addons/registry.mjs';
import { runCodegraph } from '../src/addons/codegraph-command.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-addons-'));
}

function captureStdout() {
  const original = process.stdout.write;
  let buffer = '';
  process.stdout.write = (chunk) => {
    buffer += String(chunk);
    return true;
  };
  return {
    restore() {
      process.stdout.write = original;
      return buffer;
    },
  };
}

test('registry lists codegraph, jev, and openspec as available with status objects', () => {
  assert.deepEqual(ADDON_NAMES.sort(), ['codegraph', 'jev', 'openspec']);

  const codegraph = getAddon('codegraph');
  assert.equal(typeof codegraph.run, 'function', 'codegraph has a real runner');
  assert.equal(codegraph.available, true);
  assert.equal(codegraph.capability, 'MCP registration + AGENTS.md instructions');
  assert.ok(codegraph.status, 'codegraph must carry a status string, not a bare boolean');

  const jev = getAddon('jev');
  assert.equal(typeof jev.run, 'function', 'jev has a real runner');
  assert.equal(jev.available, true);
  // Must not be a bare boolean status — capability must be explicit.
  assert.equal(jev.capability, 'tier routing + opt-in spawn gate');
  assert.ok(/test-gate parked/.test(jev.status), 'jev status must mention the parked test-gate');
  assert.ok(/real Jev/.test(jev.status), 'jev status must describe the real-Jev path');
  assert.ok(/local heuristic/.test(jev.status), 'jev status must describe the local fallback');
  assert.ok(/https?:\/\//.test(jev.status), 'jev status must link the tracked test-gate issue');
  assert.ok(!/jev-harness/.test(jev.status), 'obsolete jev-harness rationale must be gone');
  assert.ok(/off by default/.test(jev.status), 'jev status must say the spawn gate is off by default');
  assert.ok(/hooks off by default/.test(jev.status), 'jev status must say session hooks are off by default');
  assert.ok(
    /jev\.json|CLI_FIVE_JEVR_SPAWN_GATE/.test(jev.status),
    'jev status must name the runtime spawn-gate switch',
  );
  assert.match(jev.description, /spawn gate/i, 'jev description must mention the spawn gate');
  assert.ok(!/hooks don't fire/.test(jev.description), 'the stale "hooks do not fire" rationale must be gone');

  const openspec = getAddon('openspec');
  assert.equal(typeof openspec.run, 'function', 'openspec has a real runner');
  assert.equal(openspec.available, true);
  assert.equal(typeof openspec.status, 'string', 'openspec status must not be a bare boolean');
  assert.ok(openspec.status.length > 0);
  assert.deepEqual(openspec.platforms, ['copilot', 'opencode']);

  for (const addon of listAddons()) {
    assert.ok(addon.label);
    assert.ok(addon.description);
  }
});

test('getAddon is case-insensitive and returns undefined for unknown names', () => {
  assert.equal(getAddon('CodeGraph').name, 'codegraph');
  assert.equal(getAddon('JEV').name, 'jev');
  assert.equal(getAddon('nope'), undefined);
});

test('detectCodeGraph finds opencode.json MCP registration', () => {
  const dir = workspace();
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { codegraph: { type: 'local' } } }));

  const signals = detectCodeGraph(dir);
  assert.ok(signals.some((s) => s.includes('opencode.json')));

  rmSync(dir, { recursive: true, force: true });
});

test('detectCodeGraph finds .vscode/mcp.json and AGENTS.md markers', () => {
  const dir = workspace();
  mkdirSync(join(dir, '.vscode'), { recursive: true });
  writeFileSync(join(dir, '.vscode', 'mcp.json'), JSON.stringify({ servers: { codegraph: { command: 'codegraph' } } }));
  writeFileSync(join(dir, 'AGENTS.md'), 'before\n<!-- CODEGRAPH_START -->\nafter\n');

  const signals = detectCodeGraph(dir);
  assert.ok(signals.some((s) => s.includes('.vscode/mcp.json')));
  assert.ok(signals.some((s) => s.includes('AGENTS.md')));

  rmSync(dir, { recursive: true, force: true });
});

test('detectAddon returns an empty list when nothing is present', () => {
  const dir = workspace();
  assert.deepEqual(detectAddon(getAddon('codegraph'), dir), []);
  assert.deepEqual(detectAddon(getAddon('jev'), dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test('detectJev finds the plugin dir and opencode.json plugins[] entry', () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'plugin', 'jev-tier-router'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'plugin', 'jev-tier-router', 'index.js'), '// plugin');
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ plugins: ['.opencode/plugin/jev-tier-router'] }));

  const signals = detectJev(dir);
  assert.ok(signals.some((s) => s.includes('jev-tier-router')));
  assert.ok(signals.some((s) => s.includes('opencode.json')));

  rmSync(dir, { recursive: true, force: true });
});

// ── runCodegraph: README plan symbols + fail-open ─────────────────────

test('add codegraph prints the README plan symbols (+, =)', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });

  const first = captureStdout();
  await runCodegraph({ cwd: dir, args: {} });
  const created = first.restore();
  assert.match(created, /\+\s+opencode\.json/, 'a created file uses +');
  assert.match(created, /\+\s+AGENTS\.md/, 'a created file uses +');

  const second = captureStdout();
  await runCodegraph({ cwd: dir, args: {} });
  const unchanged = second.restore();
  assert.match(unchanged, /=\s+opencode\.json/, 'an unchanged file uses =');
  assert.match(unchanged, /=\s+AGENTS\.md/, 'an unchanged file uses =');

  rmSync(dir, { recursive: true, force: true });
});

test('runCodegraph warns and exits non-zero on a malformed opencode.json', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.opencode', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), '{ not valid json');
  const before = process.exitCode;

  const capture = captureStdout();
  const touched = await runCodegraph({ cwd: dir, args: {} });
  const printed = capture.restore();

  assert.deepEqual(touched, [], 'no files are reported as touched');
  assert.equal(process.exitCode, 1, 'a malformed target sets a non-zero exit code');
  assert.match(printed, /Skipped CodeGraph registration/);
  assert.equal(readFileSync(join(dir, 'opencode.json'), 'utf8'), '{ not valid json', 'malformed file untouched');
  assert.ok(!existsSync(join(dir, 'AGENTS.md')), 'no other files are written after the failure');

  process.exitCode = before;
  rmSync(dir, { recursive: true, force: true });
});
