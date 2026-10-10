import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fail, pass, ROOT } from './helpers.mjs';

console.log('\nCursor skill discovery uses the shared entrypoint');

const sharedSkill = join(ROOT, '.agents/skills/career-ops/SKILL.md');
const cursorSkill = join(ROOT, '.cursor/skills/career-ops/SKILL.md');

if (!existsSync(sharedSkill)) {
  fail('shared .agents skill entrypoint is missing');
} else if (existsSync(cursorSkill)) {
  fail('redundant .cursor skill entrypoint exists alongside the shared entrypoint');
} else {
  pass('Cursor uses the shared .agents skill entrypoint without an extra directory');
}
