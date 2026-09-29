import { spawnSync } from 'node:child_process';

export function gitInit(cwd) {
  const res = spawnSync('git', ['init', '--quiet'], { cwd, stdio: 'inherit' });
  if (res.status !== 0) throw new Error('git init failed');
}
