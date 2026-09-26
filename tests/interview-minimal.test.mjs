import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalInterview } from '../src/steps/interview.mjs';

const detected = { projectName: 'fallback-name', stacks: [] };

function info(overrides = {}) {
  return {
    name: { value: 'acme', ambiguous: false, sources: [{ source: 'package.json', value: 'acme' }] },
    oneLiner: { value: 'Does a thing.', ambiguous: false, sources: [{ source: 'package.json', value: 'Does a thing.' }] },
    ...overrides,
  };
}

test('minimalInterview uses confident auto info without prompting', async () => {
  const answers = await minimalInterview(detected, { yes: false, __platform: 'copilot', persona: null }, info());

  assert.equal(answers.projectName, 'acme');
  assert.equal(answers.oneLiner, 'Does a thing.');
  assert.equal(answers.costMode, 'premium');
  assert.equal(answers.snark, false, 'persona is opt-in on the minimal path');
});

test('minimalInterview falls back to defaults under --yes when info is missing', async () => {
  const empty = { name: { value: '', ambiguous: false, sources: [] }, oneLiner: { value: '', ambiguous: false, sources: [] } };
  const answers = await minimalInterview(detected, { yes: true, __platform: 'copilot', persona: null }, empty);

  assert.equal(answers.projectName, 'fallback-name');
  assert.equal(answers.oneLiner, '');
});

test('minimalInterview honours the persona override', async () => {
  const answers = await minimalInterview(detected, { yes: true, __platform: 'copilot', persona: true }, info());
  assert.equal(answers.snark, true);
});

test('minimalInterview sets no cost mode for OpenCode', async () => {
  const answers = await minimalInterview(detected, { yes: true, __platform: 'opencode', persona: null }, info());
  assert.equal(answers.costMode, 'none');
});
