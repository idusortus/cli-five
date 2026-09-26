import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runJev, JEVR_STATUS, TEST_GATE_ISSUE } from './jev.mjs';
import { runCodegraph } from './codegraph-command.mjs';
import { CODEGRAPH_STATUS } from './codegraph.mjs';

/**
 * Add-on registry for `cli-five add <name>`.
 *
 * An add-on describes an optional integration that can be layered onto an
 * already-scaffolded repo. Entries without a `run` function are reserved
 * (dispatcher/stub) targets — the mechanism is live, the integration is not.
 *
 * To wire a real target later: give it a `run({ cwd, args })` function (the
 * `add` command will invoke it) and update `available`/`note` accordingly.
 */
export const ADDONS = {
  codegraph: {
    name: 'codegraph',
    label: 'CodeGraph',
    description: 'Graph-backed codebase context MCP server and agent instructions.',
    // Matches jev's status-object pattern: explicit capability + status string,
    // not a bare boolean.
    available: true,
    capability: 'MCP registration + AGENTS.md instructions',
    status: CODEGRAPH_STATUS,
    platforms: ['copilot', 'opencode'],
    detect: detectCodeGraph,
    run: runCodegraph,
  },
  jev: {
    name: 'jev',
    label: 'Jev',
    description: 'Tier-routing tool for the Planner (local heuristic; test-gate parked).',
    // Not a bare boolean: jev ships tier-routing ONLY. The test-gate half is
    // parked because OpenCode plugin hooks don't fire under OpenChamber routing.
    available: true,
    capability: 'tier-routing only',
    status: `${JEVR_STATUS}; test-gate parked — ${TEST_GATE_ISSUE}`,
    platforms: ['opencode'],
    detect: detectJev,
    run: runJev,
  },
};

export const ADDON_NAMES = Object.keys(ADDONS);

export function listAddons() {
  return Object.values(ADDONS);
}

export function getAddon(name) {
  if (!name) return undefined;
  return ADDONS[String(name).toLowerCase()];
}

/**
 * Inspect a workspace for evidence that an add-on is already present.
 * Returns a list of human-readable signals (empty when not detected).
 */
export function detectAddon(addon, cwd) {
  if (!addon || typeof addon.detect !== 'function') return [];
  try {
    return addon.detect(cwd) || [];
  } catch {
    return [];
  }
}

// ── Detectors ─────────────────────────────────────────────────────────

/**
 * Detect CodeGraph artifacts written by init today. Read-only: this inspects
 * existing registration without modifying it.
 */
export function detectCodeGraph(cwd) {
  const signals = [];

  const opencodePath = join(cwd, 'opencode.json');
  const opencodeCfg = readJson(opencodePath);
  if (opencodeCfg?.mcp?.codegraph) signals.push('opencode.json mcp.codegraph');

  const mcpPath = join(cwd, '.vscode', 'mcp.json');
  const mcpCfg = readJson(mcpPath);
  if (mcpCfg?.servers?.codegraph) signals.push('.vscode/mcp.json servers.codegraph');

  const agentsPath = join(cwd, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    try {
      const body = readFileSync(agentsPath, 'utf8');
      if (body.includes('<!-- CODEGRAPH_START -->')) signals.push('AGENTS.md CodeGraph section');
    } catch {
      /* ignore */
    }
  }

  return signals;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Detect the jev tier-router plugin: its directory on disk and/or its entry in
 * opencode.json's `plugins` array. Read-only.
 */
export function detectJev(cwd) {
  const signals = [];

  if (existsSync(join(cwd, '.opencode', 'plugin', 'jev-tier-router', 'index.js'))) {
    signals.push('.opencode/plugin/jev-tier-router');
  }

  const cfg = readJson(join(cwd, 'opencode.json'));
  if (Array.isArray(cfg?.plugins) && cfg.plugins.some((p) => String(p).includes('jev-tier-router'))) {
    signals.push('opencode.json plugins[]');
  }

  return signals;
}
