import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_MAP,
  PROVIDER_MODEL_CATALOG,
  PROVIDERS,
  agentNames,
  getDefaultModelMap,
  getModelCatalog,
  isValidProvider,
  normalizeProvider,
  providerForPlatform,
} from '../src/util/models.mjs';
import { PLATFORM_COPILOT, PLATFORM_OPENCODE } from '../src/util/platforms.mjs';

test('every provider has a complete 5-agent default map', () => {
  for (const provider of PROVIDERS) {
    const map = getDefaultModelMap(provider);
    const names = agentNames();
    assert.equal(Object.keys(map).length, names.length, `${provider} missing agents`);
    for (const agent of names) {
      assert.ok(map[agent], `${provider} missing ${agent}`);
      assert.ok(map[agent].length > 0, `${provider} ${agent} model is empty`);
    }
  }
});

test('every provider has a non-empty model catalog', () => {
  for (const provider of PROVIDERS) {
    const catalog = getModelCatalog(provider);
    assert.ok(catalog.length > 0, `${provider} catalog is empty`);
    for (const model of catalog) {
      assert.ok(model.length > 0, `${provider} has empty model entry`);
    }
  }
});

test('provider normalization', () => {
  assert.equal(normalizeProvider('copilot'), 'copilot');
  assert.equal(normalizeProvider('github-copilot'), 'copilot');
  assert.equal(normalizeProvider('opencode'), 'opencode');
  assert.equal(normalizeProvider('zen'), 'opencode');
  assert.equal(normalizeProvider('opencode-go'), 'opencode-go');
  assert.equal(normalizeProvider('go'), 'opencode-go');
  assert.equal(normalizeProvider('unknown'), 'copilot');
});

test('provider validation', () => {
  assert.equal(isValidProvider('copilot'), true);
  assert.equal(isValidProvider('opencode'), true);
  assert.equal(isValidProvider('opencode-go'), true);
  assert.equal(isValidProvider('foo'), false);
});

test('platform default providers', () => {
  assert.equal(providerForPlatform(PLATFORM_COPILOT, null), 'copilot');
  assert.equal(providerForPlatform(PLATFORM_OPENCODE, null), 'opencode');
  assert.equal(providerForPlatform(PLATFORM_OPENCODE, 'go'), 'opencode-go');
});
