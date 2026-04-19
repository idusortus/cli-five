import kleur from 'kleur';
import { STACK_SIGNATURES } from '../steps/detect.mjs';

export function listStacks() {
  process.stdout.write(kleur.bold('\nDetectable stacks\n\n'));
  process.stdout.write(`  ${kleur.gray('ID'.padEnd(18))} ${kleur.gray('Label'.padEnd(22))} ${kleur.gray('Detected by')}\n`);
  process.stdout.write(`  ${'─'.repeat(18)} ${'─'.repeat(22)} ${'─'.repeat(40)}\n`);
  for (const s of STACK_SIGNATURES) {
    const trigger = s.files ? s.files.join(', ') : `glob: ${s.glob}`;
    process.stdout.write(`  ${s.id.padEnd(18)} ${s.label.padEnd(22)} ${trigger}\n`);
  }
  process.stdout.write('\n');
}
