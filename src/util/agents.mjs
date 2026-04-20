import { readFileSync } from 'node:fs';

export const AGENT_FILES = [
  'orchestrator.agent.md',
  'planner.agent.md',
  'coder.agent.md',
  'designer.agent.md',
  'reviewer.agent.md',
];

export const EXPECTED_AGENT_NAMES = {
  'orchestrator.agent.md': 'Orchestrator',
  'planner.agent.md': 'Planner',
  'coder.agent.md': 'Coder',
  'designer.agent.md': 'Designer',
  'reviewer.agent.md': 'Reviewer',
};

export const ORCHESTRATOR_CHILDREN = ['Planner', 'Coder', 'Designer', 'Reviewer'];

export const REPO_REQUIRED_MARKERS = {
  'orchestrator.agent.md': ['## Required Reading', 'Subagent output contract', '## Constraint Budgets'],
  'planner.agent.md': ['io.github.upstash/context7/*', '## Required Reading', '## Subagent Output Contract'],
  'coder.agent.md': ['io.github.upstash/context7/*', '## Subagent Output Contract', '## Required Reading'],
  'designer.agent.md': ['io.github.upstash/context7/*', '## Subagent Output Contract', '## Required Reading'],
  'reviewer.agent.md': ['## Subagent Output Contract', '## Required Reading', '## Review Output Format'],
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function readAgentSource(filePath) {
  return readFileSync(filePath, 'utf8');
}

export function parseAgentSource(source) {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { frontmatter: null, body: source };
  return {
    frontmatter: parseFrontmatter(match[1]),
    body: match[2],
  };
}

export function validateAgentSource(source, fileName, { requiredMarkers = [] } = {}) {
  const errors = [];
  const { frontmatter, body } = parseAgentSource(source);

  if (!frontmatter) {
    return ['missing YAML frontmatter'];
  }

  const expectedName = EXPECTED_AGENT_NAMES[fileName];
  if (expectedName && frontmatter.name !== expectedName) {
    errors.push(`expected name ${expectedName}, found ${String(frontmatter.name ?? 'missing')}`);
  }

  for (const key of requiredFrontmatterKeys(fileName)) {
    if (!(key in frontmatter)) {
      errors.push(`missing frontmatter key: ${key}`);
    }
  }

  if ('tools' in frontmatter && (!Array.isArray(frontmatter.tools) || frontmatter.tools.length === 0)) {
    errors.push('frontmatter tools must be a non-empty array');
  }

  if ('agents' in frontmatter && !Array.isArray(frontmatter.agents)) {
    errors.push('frontmatter agents must be an array when present');
  }

  if (fileName === 'orchestrator.agent.md' && Array.isArray(frontmatter.agents)) {
    for (const agent of ORCHESTRATOR_CHILDREN) {
      if (!frontmatter.agents.includes(agent)) {
        errors.push(`orchestrator agents must include ${agent}`);
      }
    }
  }

  if (!body.trim()) {
    errors.push('agent body must not be empty');
  }

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      errors.push(`missing required marker: ${marker}`);
    }
  }

  return errors;
}

function requiredFrontmatterKeys(fileName) {
  return fileName === 'orchestrator.agent.md'
    ? ['name', 'description', 'model', 'tools', 'agents']
    : ['name', 'description', 'model', 'tools'];
}

function parseFrontmatter(block) {
  const out = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    out[key] = parseFrontmatterValue(rawValue.trim());
  }
  return out;
}

function parseFrontmatterValue(rawValue) {
  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    return parseArrayValue(rawValue);
  }
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function parseArrayValue(rawValue) {
  const inner = rawValue.slice(1, -1).trim();
  if (!inner) return [];

  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
        return part.slice(1, -1);
      }
      return part;
    });
}