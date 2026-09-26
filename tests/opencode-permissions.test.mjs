import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOpenCodeAgentSource } from '../src/util/agents.mjs';

const BODY = '\nBody content.\n';

function orch(frontmatter) {
  return `---\n${frontmatter}\n---\n${BODY}`;
}

test('V1 permission map with task children validates (backward compat)', () => {
  const src = orch(
    'name: Orchestrator\ndescription: d\nmode: primary\nmodel: m\npermission:\n  task:\n    planner: allow\n    coder: allow',
  );
  assert.deepEqual(validateOpenCodeAgentSource(src, 'orchestrator.md'), []);
});

test('V2 permissions array with subagent entries validates', () => {
  const src = orch(
    [
      'description: d',
      'mode: primary',
      'model: m',
      'permissions:',
      '  - action: subagent',
      '    resource: planner',
      '    effect: allow',
      '  - action: subagent',
      '    resource: coder',
      '    effect: allow',
    ].join('\n'),
  );
  assert.deepEqual(validateOpenCodeAgentSource(src, 'orchestrator.md'), []);
});

test('orchestrator without any subagent grant fails in both shapes', () => {
  const v1 = orch('description: d\nmode: primary\nmodel: m\npermission:\n  read: allow');
  assert.ok(validateOpenCodeAgentSource(v1, 'orchestrator.md').some((e) => /subagent|task/.test(e)));

  const v2 = orch(
    'description: d\nmode: primary\nmodel: m\npermissions:\n  - action: read\n    resource: "*"\n    effect: allow',
  );
  assert.ok(validateOpenCodeAgentSource(v2, 'orchestrator.md').some((e) => /subagent|task/.test(e)));
});

test('non-orchestrator agents do not require subagent grants', () => {
  const src = orch(
    'description: d\nmode: subagent\nmodel: m\npermissions:\n  - action: read\n    resource: "*"\n    effect: allow',
  );
  assert.deepEqual(validateOpenCodeAgentSource(src, 'coder.md'), []);
});

test('an unparseable permissions field does not crash the validator', () => {
  const src = orch('description: d\nmode: subagent\nmodel: m\npermissions: "not-a-list"');
  assert.doesNotThrow(() => validateOpenCodeAgentSource(src, 'coder.md'));
});

test('missing frontmatter is still reported', () => {
  assert.deepEqual(validateOpenCodeAgentSource('no frontmatter here', 'coder.md'), ['missing YAML frontmatter']);
});
