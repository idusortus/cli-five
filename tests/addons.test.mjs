import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-addons-'));
}

test('registry lists codegraph and jev as available with status objects', () => {
  assert.deepEqual(ADDON_NAMES.sort(), ['codegraph', 'jev']);

  const codegraph = getAddon('codegraph');
  assert.equal(typeof codegraph.run, 'function', 'codegraph has a real runner');
  assert.equal(codegraph.available, true);
  assert.equal(codegraph.capability, 'MCP registration + AGENTS.md instructions');
  assert.ok(codegraph.status, 'codegraph must carry a status string, not a bare boolean');

  const jev = getAddon('jev');
  assert.equal(typeof jev.run, 'function', 'jev has a real runner');
  assert.equal(jev.available, true);
  // Must not be a bare boolean status — capability must be explicit.
  assert.equal(jev.capability, 'tier-routing only');
  assert.ok(/test-gate parked/.test(jev.status), 'jev status must mention the parked test-gate');
  assert.ok(/2026-09-26/.test(jev.status), 'jev status must be dated');

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
