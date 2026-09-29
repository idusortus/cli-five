import kleur from 'kleur';
import { log } from '../util/log.mjs';
import { detectPlatform, platformLabel } from '../util/platforms.mjs';
import { addCodegraphTo, CODEGRAPH_INIT_REMINDER, mcpTargetFor } from './codegraph.mjs';

/**
 * `add codegraph` — register the CodeGraph MCP server + AGENTS.md section.
 *
 * Works on both platforms. Same content and behavior as the previous inline
 * init implementation; only the invocation path and write mechanism changed
 * (mergeBlock instead of blunt overwrite).
 */
export async function runCodegraph({ cwd, args = {} }) {
  const platform = detectPlatform(cwd);

  if (platform === 'unknown') {
    log.err('No cli-five scaffold detected (neither .opencode/agents nor .github/agents).');
    log.dim('Run `npx cli-five init` first, then `npx cli-five add codegraph`.');
    process.exitCode = 1;
    return [];
  }

  const dryRun = Boolean(args.dryRun);
  const touched = addCodegraphTo({ cwd, platform, dryRun, track: true });

  for (const t of touched) {
    const rel = t.path.replace(cwd + '/', '');
    const symbol = t.action === 'created' || t.action === 'updated' ? '+' : '~';
    log.raw(`  ${symbol} ${rel} ${kleur.dim(`(${t.action})`)}`);
  }

  log.ok(`CodeGraph registered for ${platformLabel(platform)}`);
  log.dim(`MCP: ${mcpTargetFor(platform)} · instructions: AGENTS.md`);
  log.dim(CODEGRAPH_INIT_REMINDER.replace('CodeGraph is configured. ', ''));

  return touched;
}

export const __testables = { detectPlatform };
