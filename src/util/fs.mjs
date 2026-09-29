import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const PKG_ROOT = join(HERE, '..', '..');
export const TEMPLATES_DIR = join(PKG_ROOT, 'templates');

export function templatePath(...segments) {
  return join(TEMPLATES_DIR, ...segments);
}

export function readTemplate(...segments) {
  return readFileSync(templatePath(...segments), 'utf8');
}

/**
 * Write a file, reporting what happened. Idempotent by construction:
 *
 *   policy 'overwrite' (default) — write when the content differs; a no-op
 *                                  (action 'unchanged') when it is byte-identical.
 *   policy 'create'               — write only when the file is absent; an
 *                                  existing file is left untouched (action
 *                                  'skipped'). Used for user-owned memory files.
 *
 * Returns { written, action, path } where action is one of
 * 'created' | 'updated' | 'unchanged' | 'skipped'. `written` is true only when
 * bytes were actually flushed.
 */
export function writeFile(targetPath, contents, { dryRun = false, policy = 'overwrite' } = {}) {
  const exists = existsSync(targetPath);
  if (exists) {
    if (policy === 'create') return { written: false, action: 'skipped', path: targetPath };
    if (readFileSync(targetPath, 'utf8') === contents) {
      return { written: false, action: 'unchanged', path: targetPath };
    }
  }
  if (dryRun) return { written: false, action: exists ? 'updated' : 'created', path: targetPath };
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents);
  return { written: true, action: exists ? 'updated' : 'created', path: targetPath };
}

export function fileExists(p) {
  return existsSync(p);
}

/** Read a file as JSON, returning null when it is absent or unparseable. */
export function readJsonFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listFilesRecursive(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

export function relTo(base, p) {
  return relative(base, p);
}

export function render(tmpl, vars) {
  return tmpl.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
