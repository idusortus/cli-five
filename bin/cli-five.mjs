#!/usr/bin/env node
// cli-five — Code Like I'm Five
import { run } from '../src/cli.mjs';

run(process.argv.slice(2)).catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
