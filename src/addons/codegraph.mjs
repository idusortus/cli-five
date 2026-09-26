import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mergeBlock } from '../util/merge.mjs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../util/platforms.mjs';

export const CODEGRAPH_STATUS = 'MCP registration + AGENTS.md instructions';
export const CODEGRAPH_BLOCK_NAME = 'codegraph';
export const CODEGRAPH_INIT_REMINDER =
  'CodeGraph is configured. Remember to run `codegraph init` before asking agents to explore the codebase.';

// The AGENTS.md section is byte-identical to the pre-migration inline constant
// in scaffold.mjs. Do not change its content — only the write path changed.
export const CODEGRAPH_BLOCK = `## CodeGraph

This project is configured to use [CodeGraph](https://codegraph.ru) for graph-backed codebase context.
When you need to understand relationships, call paths, or impacts, use:

\`\`\`
codegraph explore "<your question>"
\`\`\`

The CodeGraph MCP server is registered in the project config. Run \`codegraph init\` in this directory
if the project has not been indexed yet.`;

/**
 * The CodeGraph MCP server entries, per platform. Unchanged from the previous
 * inline implementation — same server, same command, same shape.
 */
export function codegraphOpencodeConfig() {
  return {
    codegraph: {
      type: 'local',
      command: ['codegraph', 'serve', '--mcp'],
      enabled: true,
    },
  };
}

export function codegraphCopilotMcpJson() {
  return {
    inputs: [],
    servers: {
      codegraph: {
        command: 'codegraph',
        args: ['serve', '--mcp'],
      },
    },
  };
}

/** Which MCP file a given platform owns. Preserves the old per-platform split. */
export function mcpTargetFor(platform) {
  return platform === PLATFORM_OPENCODE ? 'opencode.json' : join('.vscode', 'mcp.json');
}

/**
 * Register CodeGraph in a workspace, using mergeBlock() for every write.
 *
 * Shared by `add codegraph` and init's legacy --codegraph flag — one
 * implementation, two entry points.
 *
 * @returns {Array<{path:string, action:string}>} the files touched.
 */
export function addCodegraphTo({ cwd, platform, dryRun = false, track = false }) {
  const touched = [];
  const isOpenCode = platform === PLATFORM_OPENCODE;

  // 1. MCP registration.
  if (isOpenCode) {
    const opencodePath = join(cwd, 'opencode.json');
    // Preserve a pre-existing `plugins[]` (e.g. jev): deepMerge replaces arrays,
    // so carry the existing value through untouched at the root.
    const existing = readJson(opencodePath) || {};
    const patch = { mcp: codegraphOpencodeConfig() };
    if (Array.isArray(existing.plugins)) patch.plugins = existing.plugins;
    touched.push(mergeBlock(opencodePath, 'codegraph', patch, { dryRun, track }));
  } else {
    const mcpPath = join(cwd, '.vscode', 'mcp.json');
    const existing = readJson(mcpPath) || {};
    // Preserve the old key order (`inputs` first) so output matches the
    // pre-migration inline implementation byte-for-byte. `inputs` is an array;
    // carry it through so deepMerge's array-replace is a no-op.
    const patch = { inputs: Array.isArray(existing.inputs) ? existing.inputs : [] };
    patch.servers = { codegraph: codegraphCopilotMcpJson().servers.codegraph };
    touched.push(mergeBlock(mcpPath, 'codegraph', patch, { dryRun, track }));
  }

  // 2. AGENTS.md section (fenced block; same marker name as the old template).
  const agentsPath = join(cwd, 'AGENTS.md');
  touched.push(mergeBlock(agentsPath, CODEGRAPH_BLOCK_NAME, CODEGRAPH_BLOCK, { dryRun }));

  return touched;
}

/**
 * Idempotent remove-of-duplicates is intentionally NOT implemented: mergeBlock
 * already replaces an existing fenced block in place and deep-merges JSON, so
 * re-running add codegraph does not duplicate anything.
 */
export function isCodegraphPresent(cwd, platform) {
  const mcpPath = join(cwd, mcpTargetFor(platform));
  const cfg = readJson(mcpPath);
  if (platform === PLATFORM_OPENCODE) return Boolean(cfg?.mcp?.codegraph);
  return Boolean(cfg?.servers?.codegraph);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Ensure a file exists with given content (used for a created-not-merged file). */
export function ensureFile(filePath, contents) {
  if (existsSync(filePath)) return false;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return true;
}

export const __testables = { readJson, mcpTargetFor };
