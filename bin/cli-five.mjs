#!/usr/bin/env node
// cli-five — Code Like I'm Five
import { run } from '../src/cli.mjs';

run(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`cli-five: ${err?.message || err}\n`);
  if (process.env.CLI_FIVE_DEBUG) process.stderr.write(`${err?.stack || ''}\n`);
  process.exit(1);
});
