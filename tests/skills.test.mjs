import test from 'node:test';
import assert from 'node:assert/strict';
import kleur from 'kleur';
import { __testables } from '../src/steps/skills.mjs';

test('shouldOfferPnpmInstall only prompts when a pnpm project can be bootstrapped via npm', () => {
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

test('buildBreadcrumbBox keeps every line aligned even with ANSI styling', () => {
  const lines = __testables.buildBreadcrumbBox();
  const widths = lines.map((line) => __testables.stripAnsi(line).length);

  assert.ok(lines.length > 3);
  assert.ok(widths.every((width) => width === widths[0]));

  const coloredLine = __testables.formatBoxLine(kleur.white('    npx skills find'));
  assert.equal(__testables.stripAnsi(coloredLine).length, widths[0]);
});
