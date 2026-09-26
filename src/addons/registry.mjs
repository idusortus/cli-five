import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    available: false,
    note: 'Currently installed by init (on by default). `add` migration is a future commit.',
    detect: detectCodeGraph,
    run: null,
  },
  jev: {
    name: 'jev',
    label: 'Jev',
    description: 'Optional Jev integration (purpose to be defined in a future commit).',
    available: false,
    note: 'Reserved target. No integration wired in this release.',
    detect: () => [],
    run: null,
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
