import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile } from '../util/fs.mjs';
import { runJev, JEVR_STATUS, TEST_GATE_ISSUE } from './jev.mjs';
import { runCodegraph } from './codegraph-command.mjs';
import { CODEGRAPH_STATUS } from './codegraph.mjs';
import { runOpenSpec } from './openspec-command.mjs';
import { OPENSPEC_STATUS, detectOpenSpec } from './openspec.mjs';

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
    description:
      'Tier routing for the Planner (real Jev when a credential resolves; local heuristic otherwise), plus an opt-in Jev-gated Reviewer-spawn gate that is off by default; the original tool-interception test-gate stays parked.',
    // Not a bare boolean: jev ships tier routing plus an OPT-IN spawn gate. The
    // gate is off by default, switchable at runtime via `.opencode/jev.json`
    // (env `CLI_FIVE_JEVR_SPAWN_GATE` overrides it for standalone/CI). The
    // original test-gate (tool-interception hooks) remains parked.
    available: true,
    capability: 'tier routing + opt-in spawn gate',
    status: `${JEVR_STATUS}; opt-in spawn gate off by default (enable via .opencode/jev.json or CLI_FIVE_JEVR_SPAWN_GATE); test-gate parked — ${TEST_GATE_ISSUE}`,
    platforms: ['opencode'],
    detect: detectJev,
    run: runJev,
  },
  openspec: {
    name: 'openspec',
    label: 'OpenSpec',
    description: 'Spec-driven change workflow — drives the OpenSpec CLI to install its commands + skills.',
    // Not a bare boolean: status names the CLI-driven shape explicitly.
    available: true,
    capability: 'openspec/ + commands + skills',
    status: OPENSPEC_STATUS,
    platforms: ['copilot', 'opencode'],
    detect: detectOpenSpec,
    run: runOpenSpec,
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
  const opencodeCfg = readJsonFile(opencodePath);
  if (opencodeCfg?.mcp?.codegraph) signals.push('opencode.json mcp.codegraph');

  const mcpPath = join(cwd, '.vscode', 'mcp.json');
  const mcpCfg = readJsonFile(mcpPath);
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

/**
 * Detect the jev tier-router plugin: its directory on disk and/or its entry in
 * opencode.json's `plugins` array. Read-only.
 */
export function detectJev(cwd) {
  const signals = [];

  if (existsSync(join(cwd, '.opencode', 'plugin', 'jev-tier-router', 'index.js'))) {
    signals.push('.opencode/plugin/jev-tier-router');
  }

  const cfg = readJsonFile(join(cwd, 'opencode.json'));
  if (Array.isArray(cfg?.plugins) && cfg.plugins.some((p) => String(p).includes('jev-tier-router'))) {
    signals.push('opencode.json plugins[]');
  }

  return signals;
}
