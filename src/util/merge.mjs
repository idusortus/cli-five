import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';

const JSON_EXTENSIONS = new Set(['.json']);

/**
 * Surgically merge a named block into an existing file **without touching the
 * rest of it**. Unlike init's blunt overwrite gate (which replaces whole files),
 * `mergeBlock` is designed for `cli-five add` against repos that are already
 * scaffolded.
 *
 * Two strategies, chosen by file extension:
 *
 *   JSON (.json)
 *     `content` (a plain object or a JSON string) is deep-merged into the file.
 *     Existing keys are preserved; overlapping scalar/array keys are replaced.
 *     Passing `fenceKey` nests the patch under that top-level key instead of
 *     merging at the root (e.g. `{ fenceKey: 'mcp' }` for `opencode.json`).
 *
 *   Markdown / other text
 *     `content` is wrapped in HTML-comment fences derived from `markerFence`:
 *       <!-- NAME_START -->
 *       ...content...
 *       <!-- NAME_END -->
 *     If the fences already exist the body between them is replaced in place;
 *     otherwise the block is appended. Re-running is idempotent.
 *
 * @param {string} filePath              Absolute path to the target file.
 * @param {string|{name?:string,start?:string,end?:string}} markerFence
 *        Block name (e.g. "codegraph"), or explicit `{ start, end }` markers.
 * @param {string|object} content        Markdown body, or object / JSON string.
 * @param {object} [options]
 * @param {boolean} [options.dryRun]     Compute but do not write.
 * @param {string|null} [options.fenceKey] JSON only — nest the merge under this key.
 * @param {boolean} [options.track]      JSON only — record the block name under `$cliFive`.
 * @param {string} [options.metaKey]     JSON only — metadata key (default `$cliFive`).
 * @returns {{path:string, block:string, action:'created'|'updated'|'unchanged', dryRun:boolean}}
 */
export function mergeBlock(filePath, markerFence, content, options = {}) {
  const { dryRun = false, fenceKey = null, track = false, metaKey = '$cliFive' } = options;
  const block = fenceName(markerFence);

  const ext = extname(filePath).toLowerCase();
  const result = JSON_EXTENSIONS.has(ext)
    ? mergeJson(filePath, block, content, { fenceKey, track, metaKey })
    : mergeText(filePath, markerFence, content);

  if (!dryRun && (result.action === 'created' || result.action === 'updated')) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, result.contents);
  }

  return { path: filePath, block, action: result.action, dryRun };
}

// ── Markdown / text ───────────────────────────────────────────────────

function mergeText(filePath, markerFence, content) {
  const { start, end } = fenceMarkers(markerFence);
  const body = String(content ?? '').replace(/\s+$/, '');
  const core = `${start}\n${body}\n${end}`;

  if (!existsSync(filePath)) {
    return { contents: `${core}\n`, action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf8');
  if (existing.trim() === '') {
    return { contents: `${core}\n`, action: 'created' };
  }

  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(existing)) {
    const next = existing.replace(pattern, core);
    return { contents: next, action: next === existing ? 'unchanged' : 'updated' };
  }

  const next = `${existing.replace(/\s+$/, '')}\n\n${core}\n`;
  return { contents: next, action: 'updated' };
}

function fenceMarkers(markerFence) {
  if (isPlainObject(markerFence) && markerFence.start && markerFence.end) {
    return { start: markerFence.start, end: markerFence.end };
  }
  const name = fenceName(markerFence).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return { start: `<!-- ${name}_START -->`, end: `<!-- ${name}_END -->` };
}

// ── JSON ──────────────────────────────────────────────────────────────

function mergeJson(filePath, block, content, { fenceKey, track, metaKey }) {
  let existing = {};
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw) {
      try {
        existing = JSON.parse(raw);
      } catch (err) {
        throw new Error(`mergeBlock: ${filePath} is not valid JSON: ${err.message}`);
      }
    }
  }

  if (!isPlainObject(existing)) {
    throw new Error(`mergeBlock: ${filePath} must contain a JSON object at the root`);
  }

  let patch = content;
  if (typeof patch === 'string') {
    try {
      patch = JSON.parse(patch);
    } catch (err) {
      throw new Error(`mergeBlock: content for ${filePath} is not valid JSON: ${err.message}`);
    }
  }
  if (!isPlainObject(patch)) {
    throw new Error(`mergeBlock: content for ${filePath} must be a JSON object`);
  }

  const before = JSON.stringify(existing);

  const target = fenceKey
    ? (isPlainObject(existing[fenceKey]) ? existing[fenceKey] : (existing[fenceKey] = {}))
    : existing;
  deepMerge(target, patch);

  if (track) {
    const meta = isPlainObject(existing[metaKey]) ? existing[metaKey] : (existing[metaKey] = {});
    const blocks = Array.isArray(meta.blocks) ? meta.blocks : (meta.blocks = []);
    if (!blocks.includes(block)) blocks.push(block);
  }

  const contents = `${JSON.stringify(existing, null, 2)}\n`;
  const action = before === JSON.stringify(existing) && existsSync(filePath) ? 'unchanged' : (existsSync(filePath) ? 'updated' : 'created');
  return { contents, action };
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMerge(target[key], value);
    } else if (isPlainObject(value)) {
      target[key] = deepMerge({}, value);
    } else if (Array.isArray(value)) {
      target[key] = [...value];
    } else {
      target[key] = value;
    }
  }
  return target;
}

// ── Helpers ───────────────────────────────────────────────────────────

function fenceName(markerFence) {
  if (typeof markerFence === 'string' && markerFence.trim()) return markerFence.trim();
  if (isPlainObject(markerFence) && typeof markerFence.name === 'string' && markerFence.name.trim()) {
    return markerFence.name.trim();
  }
  throw new Error('mergeBlock: markerFence must be a non-empty string or { name }');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
