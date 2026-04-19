import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const STACK_SIGNATURES = [
  { id: 'node-ts', label: 'Node + TypeScript', files: ['tsconfig.json', 'package.json'] },
  { id: 'node', label: 'Node', files: ['package.json'] },
  { id: 'python', label: 'Python', files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { id: 'dotnet', label: '.NET', glob: /\.(csproj|fsproj|sln)$/i },
  { id: 'rust', label: 'Rust', files: ['Cargo.toml'] },
  { id: 'go', label: 'Go', files: ['go.mod'] },
  { id: 'kotlin-android', label: 'Kotlin / Android', files: ['build.gradle.kts', 'settings.gradle.kts'] },
  { id: 'gradle', label: 'Gradle (JVM)', files: ['build.gradle', 'settings.gradle'] },
  { id: 'maven', label: 'Maven (JVM)', files: ['pom.xml'] },
  { id: 'ruby', label: 'Ruby', files: ['Gemfile'] },
  { id: 'php', label: 'PHP', files: ['composer.json'] },
];

export function detect(cwd) {
  const entries = safeRead(cwd);
  const names = new Set(entries);
  const stacks = [];

  for (const sig of STACK_SIGNATURES) {
    if (sig.files && sig.files.some((f) => names.has(f))) stacks.push(sig);
    else if (sig.glob && entries.some((n) => sig.glob.test(n))) stacks.push(sig);
  }

  const hasGit = names.has('.git');
  const hasGithub = names.has('.github');
  const hasAgents = existsSync(join(cwd, '.github', 'agents'));
  const hasCopilotInstructions = existsSync(join(cwd, '.github', 'copilot-instructions.md'));
  const projectName = guessName(cwd, names);

  return {
    cwd,
    projectName,
    hasGit,
    hasGithub,
    hasAgents,
    hasCopilotInstructions,
    isBrownfield: stacks.length > 0,
    stacks,
  };
}

function safeRead(cwd) {
  try {
    return readdirSync(cwd);
  } catch {
    return [];
  }
}

function guessName(cwd, names) {
  if (names.has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
      if (pkg?.name) return pkg.name;
    } catch {
      /* ignore */
    }
  }
  return basename(cwd);
}
