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

export function writeFile(targetPath, contents, { dryRun = false } = {}) {
  if (dryRun) return { written: false, path: targetPath };
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents);
  return { written: true, path: targetPath };
}

export function fileExists(p) {
  return existsSync(p);
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
