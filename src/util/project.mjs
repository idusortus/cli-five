import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// README variants checked in order. First match wins.
const README_CANDIDATES = [
  'README.md',
  'readme.md',
  'Readme.md',
  'README.MD',
  'README.markdown',
  'README.txt',
  'README',
];

/**
 * Best-effort auto-extraction of a project name and one-liner from the
 * workspace itself (package.json and/or README), used by the minimal init
 * interview so it only has to ask when the answer is genuinely missing or
 * ambiguous.
 *
 * Returns:
 *   {
 *     name:     { value, ambiguous, sources: [{ source, value }] },
 *     oneLiner: { value, ambiguous, sources: [{ source, value }] },
 *   }
 *
 * `value` is the first candidate (a safe fallback), `ambiguous` is true when
 * two or more distinct candidates were found. Callers should ask the user
 * whenever `ambiguous` is true or `value` is empty.
 */
export function autoProjectInfo(cwd) {
  const nameSources = [];
  const oneLinerSources = [];

  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (isNonEmptyString(pkg?.name)) {
        nameSources.push({ source: 'package.json', value: pkg.name.trim() });
      }
      if (isNonEmptyString(pkg?.description)) {
        oneLinerSources.push({ source: 'package.json', value: pkg.description.trim() });
      }
    } catch {
      /* malformed package.json — ignore */
    }
  }

  for (const file of README_CANDIDATES) {
    const filePath = join(cwd, file);
    if (!existsSync(filePath)) continue;

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const hints = extractReadmeHints(content);
    if (hints.name) nameSources.push({ source: file, value: hints.name });
    if (hints.oneLiner) oneLinerSources.push({ source: file, value: hints.oneLiner });

    break; // first README found wins — don't blend multiple README variants
  }

  return {
    name: summarize(nameSources),
    oneLiner: summarize(oneLinerSources),
  };
}

/** Pull a name (first H1) and one-liner (first prose line) out of a README. */
export function extractReadmeHints(content) {
  const lines = String(content || '').split('\n');
  let name = '';
  let oneLiner = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!name) {
      const h1 = /^#\s+(.+?)\s*$/.exec(line);
      if (h1) {
        name = stripInlineMarkdown(h1[1]);
        continue;
      }
    }

    // Wait for the first H1 before reading prose — otherwise the README may
    // start with a logo/badge that is not a name.
    if (!name || oneLiner) continue;

    if (isProseLine(line)) {
      oneLiner = line.length > 120 ? `${line.slice(0, 117)}...` : line;
    }
  }

  return { name, oneLiner };
}

function summarize(sources) {
  if (sources.length === 0) {
    return { value: '', ambiguous: false, sources: [] };
  }

  const distinct = [];
  for (const entry of sources) {
    if (!distinct.includes(entry.value)) distinct.push(entry.value);
  }

  return {
    value: sources[0].value,
    ambiguous: distinct.length > 1,
    sources,
  };
}

function isProseLine(line) {
  // Skip headings, badges/images, code fences, lists, tables, blockquotes, HTML.
  if (/^[#>|`*\-_]/.test(line)) return false;
  if (/^\[!\[/.test(line)) return false;
  if (/^!\[/.test(line)) return false;
  if (/^<[a-zA-Z!/]/.test(line)) return false;
  if (/^\|/.test(line)) return false;
  return true;
}

function stripInlineMarkdown(value) {
  return String(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/[*_`]/g, '')
    .trim();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
