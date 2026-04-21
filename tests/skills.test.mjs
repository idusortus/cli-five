import test from 'node:test';
import assert from 'node:assert/strict';
import kleur from 'kleur';
import { fileURLToPath } from 'node:url';
import { __testables } from '../src/steps/skills.mjs';

test('shouldOfferPnpmInstall returns true only when project uses pnpm, pnpm is missing, and npm is available', () => {
  assert.equal(__testables.shouldOfferPnpmInstall(null), false);

  assert.equal(__testables.shouldOfferPnpmInstall({
    projectPnpm: true,
    pnpmVer: null,
    npmVer: '10.9.2',
  }), true);

  assert.equal(__testables.shouldOfferPnpmInstall({
    projectPnpm: false,
    pnpmVer: null,
    npmVer: '10.9.2',
  }), false);

  assert.equal(__testables.shouldOfferPnpmInstall({
    projectPnpm: true,
    pnpmVer: null,
    npmVer: null,
  }), false);

  assert.equal(__testables.shouldOfferPnpmInstall({
    projectPnpm: true,
    pnpmVer: '9.0.0',
    npmVer: '10.9.2',
  }), false);
});

test('detectEnv includes npmVer when npm is available', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = __testables.detectEnv(repoRoot);

  assert.ok(env);
  assert.equal(typeof env.npmVer, 'string');
  assert.ok(env.npmVer.length > 0);
});

test('buildBreadcrumbBox keeps every line aligned even with ANSI styling', () => {
  const lines = __testables.buildBreadcrumbBox();
  const widths = lines.map((line) => __testables.stripAnsi(line).length);

  assert.ok(lines.length > 3);
  assert.ok(widths.every((width) => width === widths[0]));

  const coloredLine = __testables.formatBoxLine(kleur.white('    npx skills find'));
  assert.equal(__testables.stripAnsi(coloredLine).length, widths[0]);
});

test('isCoreCatalogSkill returns true only for cli-five core catalog skills', () => {
  assert.equal(__testables.isCoreCatalogSkill('anthropics/skills', 'frontend-design'), true);
  assert.equal(__testables.isCoreCatalogSkill('vercel-labs/agent-skills', 'vercel-react-best-practices'), true);

  assert.equal(__testables.isCoreCatalogSkill('anthropics/skills', 'python-best-practices'), false);
  assert.equal(__testables.isCoreCatalogSkill('github/awesome-copilot', 'any-skill'), false);
});
