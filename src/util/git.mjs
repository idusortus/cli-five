import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function isGitRepo(cwd) {
  return existsSync(join(cwd, '.git'));
}

export function gitInit(cwd) {
  const res = spawnSync('git', ['init', '--quiet'], { cwd, stdio: 'inherit' });
  if (res.status !== 0) throw new Error('git init failed');
}
