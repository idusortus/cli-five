import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

// Canonical OpenCode credential-store helpers, shared by cli-five's provider
// detection (`src/util/auth.mjs`) and the Jev plugin. The plugin ships a
// vendored copy at `templates/opencode/plugin/jev-tier-router/auth.mjs`; keep
// the two in sync (see the header note in that copy).

function nonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Ordered list of **absolute** candidate paths for OpenCode's `auth.json`.
 *
 * Absolute candidates only: a relative `OPENCODE_AUTH_FILE` or `XDG_DATA_HOME`
 * is rejected so a repo-local `./opencode/auth.json` can never be mistaken for
 * the real credential store. Order: `OPENCODE_AUTH_FILE`, then `XDG_DATA_HOME`,
 * then the `~/.local/share` fallback. Never throws.
 *
 * @param {{ env?: object, homeDir?: string }} [opts]
 * @returns {string[]}
 */
export function resolveOpencodeAuthCandidates(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.homeDir || homedir();

  const candidates = [];
  const explicit = nonEmpty(env.OPENCODE_AUTH_FILE);
  if (explicit) candidates.push(explicit);

  const xdg = nonEmpty(env.XDG_DATA_HOME);
  if (xdg) candidates.push(join(xdg, 'opencode', 'auth.json'));

  candidates.push(join(home, '.local', 'share', 'opencode', 'auth.json'));

  return candidates.filter((path) => isAbsolute(path));
}

/**
 * The `opencode-go` bearer key from a parsed `auth.json`, or `null`.
 *
 * Reads each shape independently so a present-but-keyless top-level entry does
 * not shadow a `providers`-wrapped entry. Never throws.
 *
 * @param {unknown} parsed
 * @returns {string|null}
 */
export function extractOpencodeStoreKey(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  return nonEmpty(parsed?.['opencode-go']?.key ?? parsed?.providers?.['opencode-go']?.key);
}

/**
 * The OpenCode provider ids present in a parsed `auth.json`.
 *
 * Scans both shapes the reader understands — top-level entries and
 * `providers`-wrapped entries — and additionally counts `opencode-go` when a
 * usable Go key exists anywhere in the store. Returns the OpenCode ids (the
 * caller maps them to its own provider vocabulary). Never throws.
 *
 * @param {unknown} parsed
 * @returns {string[]}
 */
export function opencodeStoreProviderIds(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];

  const ids = [];
  const add = (id) => {
    if (id && !ids.includes(id)) ids.push(id);
  };

  for (const group of [parsed, parsed.providers]) {
    if (!group || typeof group !== 'object') continue;
    for (const id of Object.keys(group)) {
      if (id !== 'providers') add(id);
    }
  }

  if (extractOpencodeStoreKey(parsed)) add('opencode-go');

  return ids;
}
