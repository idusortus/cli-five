import kleur from 'kleur';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../util/log.mjs';
import { detectPlatform, platformLabel } from '../util/platforms.mjs';
import { OPENSPEC_PACKAGE, detectOpenSpec, openspecSurfaceFor, openspecToolFor } from './openspec.mjs';

/**
 * `add openspec` — drive the external OpenSpec CLI idempotently.
 *
 * There is no cli-five-owned config to merge here: `openspec/` and the editor
 * surfaces (the `opsx-*` commands + `openspec-*` skills) are owned by the
 * OpenSpec CLI. So this runner shells out to it:
 *   - `openspec init --tools <tool>` when `openspec/` is absent OR the
 *     platform's editor surfaces are missing, and
 *   - `openspec update --force` when both exist (refresh in place).
 *
 * `exec` is injectable for tests; the default uses `spawnSync`, mapping a
 * spawn error (ENOENT) to a non-zero status so a missing CLI is detected.
 */
export async function runOpenSpec({ cwd, args = {}, exec = defaultExec }) {
  const platform = detectPlatform(cwd);
  const tool = openspecToolFor(platform);

  // One guard for both refusal modes: no cli-five scaffold, or a scaffold whose
  // platform OpenSpec has no editor surface for (defensive — both known
  // platforms map to a tool today).
  if (platform === 'unknown' || !tool) {
    if (platform === 'unknown') {
      log.err('No cli-five scaffold detected (neither .opencode/agents nor .github/agents).');
      log.dim('Run `npx cli-five init` first, then `npx cli-five add openspec`.');
    } else {
      log.err(`OpenSpec has no editor surface for ${platformLabel(platform)}.`);
      log.dim('Nothing was written to your project.');
    }
    process.exitCode = 1;
    return [];
  }

  // Init when `openspec/` is absent or this platform's surfaces are missing
  // (a repo set up for another platform, or a bare `openspec/`); otherwise
  // refresh in place. `init` is safe to re-run, so this never regresses.
  const initialised = existsSync(join(cwd, 'openspec'));
  const useInit = !initialised || !openspecSurfaceFor(cwd, platform);
  const argv = useInit ? ['init', '--tools', tool] : ['update', '--force'];
  const printable = `openspec ${argv.join(' ')}`;

  // A dry run is a pure preview: it prints the exact command and spawns
  // nothing (no CLI probe, no init/update).
  if (args.dryRun) {
    log.dim(`would run: ${printable}`);
    return [];
  }

  // 1. Is the OpenSpec CLI available?
  const probe = exec('openspec', ['--version'], { cwd });
  if (probe.status !== 0) {
    log.err('OpenSpec CLI not found (or `openspec --version` failed).');
    const probeDetail = String(probe.stderr || probe.stdout || '').trim();
    if (probeDetail) log.dim(probeDetail);
    log.dim(`Install it first: npm i -g ${OPENSPEC_PACKAGE}`);
    log.dim('Nothing was written to your project.');
    process.exitCode = 1;
    return [];
  }

  // 2. `init` on a fresh repo; `update --force` refreshes an existing install.
  log.info(`Running ${kleur.bold(printable)}`);
  const res = exec('openspec', argv, { cwd });
  if (res.status !== 0) {
    log.err(`openspec ${argv[0]} failed (exit ${res.status}).`);
    const detail = String(res.stderr || res.stdout || '').trim();
    if (detail) log.dim(detail);
    process.exitCode = 1;
    return [];
  }

  const verb = useInit ? 'initialised' : 'refreshed';
  log.ok(`OpenSpec ${verb} for ${platformLabel(platform)}`);

  const signals = detectOpenSpec(cwd);
  if (signals.length) log.dim(`Present: ${signals.join(', ')}`);

  return signals;
}

function defaultExec(cmd, argv, { cwd }) {
  const res = spawnSync(cmd, argv, {
    cwd,
    encoding: 'utf8',
    // Global npm bins are `openspec.cmd` on Windows; a shell resolves them via
    // PATHEXT. Every arg passed here is a fixed literal, so shell:true is safe.
    shell: process.platform === 'win32',
  });
  // spawnSync leaves `status` null and sets `error` (e.g. ENOENT) when the
  // binary is missing; surface that as a non-zero status.
  const status = res.status === null ? 127 : res.status;
  const stderr = res.stderr || (res.error ? String(res.error.message) : '');
  return { status, stdout: res.stdout || '', stderr };
}

export const __testables = { detectPlatform, defaultExec };
