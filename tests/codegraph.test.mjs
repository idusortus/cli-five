import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCodegraphTo, mcpTargetFor, CODEGRAPH_BLOCK } from '../src/addons/codegraph.mjs';
import { runCodegraph } from '../src/addons/codegraph-command.mjs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../src/util/platforms.mjs';

function workspace() {
  return mkdtempSync(join(tmpdir(), 'cli-five-codegraph-'));
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── OpenCode target ───────────────────────────────────────────────────

test('add codegraph on OpenCode writes mcp.codegraph + AGENTS.md block', () => {
  const dir = workspace();
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ model: 'keep-me', plugins: ['x'] }, null, 2));

  addCodegraphTo({ cwd: dir, platform: PLATFORM_OPENCODE });

  const cfg = readJson(join(dir, 'opencode.json'));
  assert.equal(cfg.model, 'keep-me', 'existing keys preserved');
  assert.deepEqual(cfg.plugins, ['x'], 'existing plugins[] preserved');
  assert.deepEqual(cfg.mcp.codegraph, {
    type: 'local',
    command: ['codegraph', 'serve', '--mcp'],
    enabled: true,
  });

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('<!-- CODEGRAPH_START -->'));
  assert.ok(agents.includes('codegraph explore'));
  assert.ok(agents.includes('<!-- CODEGRAPH_END -->'));

  rmSync(dir, { recursive: true, force: true });
});

test('add codegraph on OpenCode does not write .vscode/mcp.json', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_OPENCODE });
  assert.ok(!existsSync(join(dir, '.vscode', 'mcp.json')));
  rmSync(dir, { recursive: true, force: true });
});

// ── Copilot target ────────────────────────────────────────────────────

test('add codegraph on Copilot writes .vscode/mcp.json + AGENTS.md block', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_COPILOT });

  const mcp = readJson(join(dir, '.vscode', 'mcp.json'));
  assert.deepEqual(mcp.inputs, []);
  assert.deepEqual(mcp.servers.codegraph, { command: 'codegraph', args: ['serve', '--mcp'] });

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('<!-- CODEGRAPH_START -->'));
  assert.ok(agents.includes(CODEGRAPH_BLOCK.split('\n')[0]));

  rmSync(dir, { recursive: true, force: true });
});

test('add codegraph on Copilot does not write opencode.json', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_COPILOT });
  assert.ok(!existsSync(join(dir, 'opencode.json')));
  rmSync(dir, { recursive: true, force: true });
});

// ── Idempotency ───────────────────────────────────────────────────────

test('re-running add codegraph does not duplicate MCP entries or AGENTS.md sections', () => {
  for (const platform of [PLATFORM_OPENCODE, PLATFORM_COPILOT]) {
    const dir = workspace();
    addCodegraphTo({ cwd: dir, platform });
    addCodegraphTo({ cwd: dir, platform });
    addCodegraphTo({ cwd: dir, platform });

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.equal((agents.match(/CODEGRAPH_START/g) || []).length, 1, `${platform}: one fence pair`);

    const mcpPath = join(dir, mcpTargetFor(platform));
    const cfg = readJson(mcpPath);
    const servers = platform === PLATFORM_OPENCODE ? cfg.mcp : cfg.servers;
    assert.equal(Object.keys(servers).filter((k) => k === 'codegraph').length, 1, `${platform}: one entry`);

    rmSync(dir, { recursive: true, force: true });
  }
});

test('add codegraph preserves a jev-registered plugins[] on OpenCode', () => {
  const dir = workspace();
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify({ plugins: ['.opencode/plugin/jev-tier-router'] }, null, 2),
  );

  addCodegraphTo({ cwd: dir, platform: PLATFORM_OPENCODE });

  const cfg = readJson(join(dir, 'opencode.json'));
  assert.deepEqual(cfg.plugins, ['.opencode/plugin/jev-tier-router']);
  assert.ok(cfg.mcp.codegraph);

  rmSync(dir, { recursive: true, force: true });
});

// ── Output equivalence with the old inline implementation ─────────────

test('OpenCode MCP entry matches the pre-migration inline shape exactly', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_OPENCODE });
  const cfg = readJson(join(dir, 'opencode.json'));
  // Exact shape the old buildOpencodeConfig() produced:
  assert.deepEqual(cfg.mcp, {
    codegraph: { type: 'local', command: ['codegraph', 'serve', '--mcp'], enabled: true },
  });
  rmSync(dir, { recursive: true, force: true });
});

test('Copilot MCP file matches the pre-migration inline shape exactly', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_COPILOT });
  const mcp = readJson(join(dir, '.vscode', 'mcp.json'));
  assert.deepEqual(mcp, {
    inputs: [],
    servers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } },
  });
  rmSync(dir, { recursive: true, force: true });
});

test('AGENTS.md block content is byte-identical to the old inline constant', () => {
  const dir = workspace();
  addCodegraphTo({ cwd: dir, platform: PLATFORM_COPILOT });
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(CODEGRAPH_BLOCK));
  rmSync(dir, { recursive: true, force: true });
});

// ── Command surface ───────────────────────────────────────────────────

test('runCodegraph refuses a repo with no cli-five scaffold', async () => {
  const dir = workspace();
  const before = process.exitCode;
  const touched = await runCodegraph({ cwd: dir, args: {} });
  assert.deepEqual(touched, []);
  assert.equal(process.exitCode, 1);
  assert.ok(!existsSync(join(dir, 'AGENTS.md')));
  process.exitCode = before;
  rmSync(dir, { recursive: true, force: true });
});

test('runCodegraph works on a Copilot scaffold', async () => {
  const dir = workspace();
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), '---\n---\n');
  const touched = await runCodegraph({ cwd: dir, args: {} });
  assert.ok(touched.length >= 2);
  assert.ok(existsSync(join(dir, '.vscode', 'mcp.json')));
  rmSync(dir, { recursive: true, force: true });
});

test('dryRun computes without writing', () => {
  const dir = workspace();
  const touched = addCodegraphTo({ cwd: dir, platform: PLATFORM_OPENCODE, dryRun: true });
  assert.ok(touched.length > 0);
  assert.ok(!existsSync(join(dir, 'opencode.json')));
  assert.ok(!existsSync(join(dir, 'AGENTS.md')));
  rmSync(dir, { recursive: true, force: true });
});
