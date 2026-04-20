import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_FILES,
  REPO_REQUIRED_MARKERS,
  readAgentSource,
  validateAgentSource,
} from '../src/util/agents.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(repoRoot, 'plugin-agents');
const templateDir = join(repoRoot, 'templates', '.github', 'agents');

test('plugin agents match scaffold templates exactly', () => {
  for (const file of AGENT_FILES) {
    const pluginSource = readAgentSource(join(pluginDir, file));
    const templateSource = readAgentSource(join(templateDir, file));
    assert.equal(pluginSource, templateSource, `${file} drifted between plugin and template distributions`);
  }
});

test('repo agent files satisfy required structure and contract markers', () => {
  for (const dir of [pluginDir, templateDir]) {
    for (const file of AGENT_FILES) {
      const source = readAgentSource(join(dir, file));
      const errors = validateAgentSource(source, file, {
        requiredMarkers: REPO_REQUIRED_MARKERS[file],
      });

      assert.deepEqual(errors, [], `${join(dir, file)}\n${errors.join('\n')}`);
    }
  }
});