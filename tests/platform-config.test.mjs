import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePlatform, resolveCodegraphDefault } from '../src/steps/platform.mjs';

test('resolveCodegraphDefault lets explicit flags win', () => {
  assert.equal(resolveCodegraphDefault({ codegraph: true }, false), true);
  assert.equal(resolveCodegraphDefault({ codegraph: false }, true), false);
});

test('resolveCodegraphDefault defaults CodeGraph off for minimal, on for full interview', () => {
  assert.equal(resolveCodegraphDefault({ codegraph: null }, false), false);
  assert.equal(resolveCodegraphDefault({ codegraph: null }, true), true);
});

test('choosePlatform honours the resolved codegraph default with an explicit target', async () => {
  const minimal = await choosePlatform(
    { target: 'opencode', cwd: '/tmp', codegraph: null },
    { codegraphDefault: false },
  );
  assert.equal(minimal.platform, 'opencode');
  assert.equal(minimal.codegraph, false);

  const full = await choosePlatform(
    { target: 'copilot', cwd: '/tmp', codegraph: null },
    { codegraphDefault: true },
  );
  assert.equal(full.platform, 'copilot');
  assert.equal(full.codegraph, true);
});
