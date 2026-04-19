import kleur from 'kleur';
import prompts from 'prompts';
import { log } from '../util/log.mjs';
import { detect } from '../steps/detect.mjs';
import { confirmOverwriteIfNeeded } from '../steps/confirm.mjs';
import { interview } from '../steps/interview.mjs';
import { scaffold, summarize } from '../steps/scaffold.mjs';
import { skillDiscovery } from '../steps/skills.mjs';
import { instructionGeneration } from '../steps/instructions.mjs';
import { isGitRepo, gitInit } from '../util/git.mjs';

export async function init(args) {
  const cwd = args.cwd;
  log.raw(kleur.bold().magenta('\ncli-five init') + kleur.gray(`  ${cwd}`));

  // 1. Detect
  log.step('1/6 Detect workspace');
  const detected = detect(cwd);
  log.info(`Project: ${kleur.bold(detected.projectName)}`);
  log.info(`Mode:    ${detected.isBrownfield ? kleur.yellow('brownfield') : kleur.green('greenfield')}`);
  if (detected.stacks.length) log.info(`Stack:   ${detected.stacks.map((s) => s.label).join(', ')}`);
  if (!detected.hasGit) log.warn('Not a git repository.');

  // 2. git init if needed
  if (!detected.hasGit) {
    if (args.yes || (await ask('Run `git init`?', true))) {
      gitInit(cwd);
      log.ok('Initialised git repo.');
    } else {
      log.warn('Continuing without git. You will regret this.');
    }
  }

  // 3. Overwrite gate
  log.step('2/6 Confirm overwrites');
  const ok = await confirmOverwriteIfNeeded(detected, args);
  if (!ok) {
    log.warn('Aborted. Nothing written.');
    return;
  }
  if (!detected.hasAgents && !detected.hasCopilotInstructions) log.dim('No collisions.');

  // 4. Interview
  log.step('3/6 Interview');
  const answers = await interview(detected, args);

  // CLI --cost-mode override
  if (args.costMode && ['premium', 'cheap', 'mixed'].includes(args.costMode)) {
    answers.costMode = args.costMode;
  }

  if (answers.presetId && answers.presetId !== 'custom') {
    log.info(`Preset: ${answers.presetId}`);
  }
  if (answers.frameworks.length) log.info(`Stack:  ${answers.stack.join(', ')} + ${answers.frameworks.join(', ')}`);

  // 5. Scaffold
  log.step('4/6 Scaffold');
  const written = scaffold({ cwd, answers, args });
  if (args.dryRun) log.warn('--dry-run: no files written. Plan:');
  log.raw(summarize(written, cwd));
  if (!args.dryRun) log.ok(`Wrote ${written.length} files.`);

  // 6. Skill discovery
  log.step('5/6 Skill discovery');
  await skillDiscovery({ cwd, answers, args });

  // 7. Custom instructions
  log.step('6/6 Custom instructions');
  const instrWritten = await instructionGeneration({ cwd, answers, args });
  if (instrWritten && instrWritten.length > 0) {
    if (args.dryRun) log.warn('--dry-run: instruction plan:');
    for (const w of instrWritten) {
      log.raw(`  ${w.written ? '+' : '~'} ${w.path.replace(cwd + '/', '')}`);
    }
    if (!args.dryRun) log.ok(`Wrote ${instrWritten.length} instruction file${instrWritten.length > 1 ? 's' : ''}.`);
  }

  // 8. Next steps
  printNextSteps(answers);
}

async function ask(message, initial = false) {
  const { v } = await prompts({ type: 'confirm', name: 'v', message, initial });
  return Boolean(v);
}

function printNextSteps(answers) {
  log.raw('');
  log.raw(kleur.bold().green('Done. Next steps:'));
  log.raw('');
  log.raw(`  1. Open this folder in VS Code Insiders.`);
  log.raw(`  2. Enable Copilot subagent invocations (settings.json):`);
  log.raw(kleur.gray(`        "chat.subagents.allowInvocationsFromSubagents": true`));
  log.raw(`  3. Open Copilot Chat — select an agent from the dropdown (${kleur.bold('not')} @mention).`);
  log.raw(`  4. Select ${kleur.bold('Orchestrator')} — use handoff buttons or ask it to delegate:`);
  log.raw(kleur.gray(`        📋 Plan  💻 Code  🎨 Design  🔍 Review`));
  log.raw(`  5. Or go autonomous:`);
  log.raw(kleur.gray(`        read PROJECT.md and implement Phase 1.`));
  log.raw(`  6. Review generated instruction files in .github/instructions/.`);
  log.raw(kleur.gray(`        Edit applyTo globs and guidelines to fit your project.`));
  log.raw('');
  log.raw(kleur.dim('  Quick plugin install (personal, no project config):'));
  log.raw(kleur.dim('    copilot plugin install idusortus/cli-five'));
  log.raw('');
  log.raw(kleur.dim('Edit cost mode anytime by changing `model:` in .github/agents/*.agent.md.'));
  log.raw('');
}
