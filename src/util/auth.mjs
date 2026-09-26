import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PROVIDER_ZEN, PROVIDER_GO } from './models.mjs';

// OpenCode auth provider id -> cli-five provider id.
// Zen authenticates as `opencode`; Go as `opencode-go`.
const AUTH_ID_TO_PROVIDER = {
  opencode: PROVIDER_ZEN,
  'opencode-go': PROVIDER_GO,
};

/**
 * Detect which OpenCode model providers the user is actually authenticated for.
 *
 * Best-effort and side-effect free: shells out to `opencode auth list --format json`
 * and falls back to reading OpenCode's auth.json. Returns an array of cli-five
 * provider ids (e.g. ['opencode-go']); empty when nothing is detected.
 *
 * Never throws — a missing OpenCode CLI or unreadable auth must not break init.
 */
export function detectAuthenticatedProviders() {
  for (const ids of [authFromCli(), authFromFile()]) {
    if (ids && ids.length > 0) return ids;
  }
  return [];
}

function authFromCli() {
  try {
    const out = execFileSync('opencode', ['auth', 'list', '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5000,
    });
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((entry) => AUTH_ID_TO_PROVIDER[entry?.id])
      .filter(Boolean);
  } catch {
    return null;
  }
}

function authFromFile() {
  const candidates = [
    process.env.OPENCODE_AUTH_FILE,
    join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
    join(process.env.XDG_DATA_HOME || '', 'opencode', 'auth.json'),
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      return Object.keys(data)
        .map((id) => AUTH_ID_TO_PROVIDER[id])
        .filter(Boolean);
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Pick the best provider for a platform given what the user is authenticated for.
 *
 * For OpenCode: prefer the authenticated provider when there is one; when the
 * user has only Go (or only Zen), use it instead of the blind Zen default.
 * Returns null when no preference can be inferred (caller keeps its default).
 */
export function preferredProviderForAuth(platform) {
  if (platform !== 'opencode') return null;
  const authed = detectAuthenticatedProviders();
  if (authed.length === 0) return null;
  // Prefer Go when both are present only if Zen is absent — otherwise Zen.
  if (authed.includes(PROVIDER_ZEN)) return PROVIDER_ZEN;
  if (authed.includes(PROVIDER_GO)) return PROVIDER_GO;
  return null;
}

export const __testables = { authFromCli, authFromFile, AUTH_ID_TO_PROVIDER };
