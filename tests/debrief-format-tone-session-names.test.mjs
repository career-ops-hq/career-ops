// tests/debrief-format-tone-session-names.test.mjs — the interview format/tone
// front matter (#6915) and the never-overwrite session file rule plus quoted
// `speaker` (#6933) must reach every translation of the interview modes.
//
// Both changes landed in modes/interview/ only, and the localized copies kept
// the old text: a debrief run in another language silently overwrote an
// earlier session file and never recorded format or tone. This suite pins the
// structural pieces each translation must carry, whatever its prose says:
//   - debrief Step 9 front matter has the four optional keys, with
//     `candidate_comfort` double-quoted, and still parses as YAML;
//   - a rules bullet names the four keys;
//   - the Step 9 intro names the `-2` counter and the README's "File names";
//   - every `stated_priorities` example quotes its `speaker`;
//   - practice's session-transcript paragraph names the `-2` counter.
// fr has no `stated_priorities` (its debrief predates it, #3407), so the
// speaker check applies only where that block exists.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nInterview modes: format/tone keys and session file names reach every translation (#6915, #6933)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const MODES = join(ROOT, 'modes');
const dirs = [['en', join(MODES, 'interview')]];
for (const entry of readdirSync(MODES, { withFileTypes: true })) {
  const dir = join(MODES, entry.name, 'interview');
  if (entry.isDirectory() && existsSync(join(dir, 'debrief.md'))) dirs.push([entry.name, dir]);
}
check('found localized interview modes to check', dirs.length > 1, `only ${dirs.length} dir(s)`);

const SESSION_PATH = '`interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`';
const KEYS = ['format', 'people_on_call', 'tone', 'candidate_comfort'];

// The Step 9 template: the first fenced block after the session-path paragraph
// that opens with front matter.
function stepNineFrontMatter(text) {
  const start = text.indexOf(SESSION_PATH);
  if (start < 0) return null;
  const m = text.slice(start).match(/```markdown\n---\n([\s\S]*?)\n---\n/);
  return m ? m[1] : null;
}

for (const [loc, dir] of dirs) {
  const debrief = readFileSync(join(dir, 'debrief.md'), 'utf8');
  const lines = debrief.split('\n');

  const fm = stepNineFrontMatter(debrief);
  check(`${loc} debrief has a Step 9 front-matter template`, fm !== null, 'no ```markdown --- block after the session path');
  if (fm === null) continue;

  for (const key of KEYS) {
    check(`${loc} front matter carries \`${key}\``, new RegExp(`^${key}: `, 'm').test(fm), 'key missing');
  }
  check(`${loc} front matter double-quotes candidate_comfort`, /^candidate_comfort: "/m.test(fm), 'value not double-quoted');

  let parsed = null;
  try { parsed = yaml.load(fm); } catch (e) { parsed = e; }
  check(`${loc} Step 9 front matter parses as YAML`, parsed && !(parsed instanceof Error), String(parsed && parsed.message));

  if (/^stated_priorities:/m.test(fm)) {
    const speakers = fm.split('\n').filter((l) => /^\s*- speaker:/.test(l));
    check(`${loc} stated_priorities example has a speaker`, speakers.length > 0, 'no speaker line');
    check(`${loc} every speaker is double-quoted`, speakers.every((l) => /- speaker: "/.test(l)), speakers.join(' | '));
  }

  const bullet = lines.find((l) => /^[-*] \*\*`format`/.test(l)) || '';
  check(`${loc} a transcript rule names all four keys`,
    KEYS.every((k) => bullet.includes(`\`${k}\``)), bullet ? bullet.slice(0, 80) : 'no rule bullet starting with `format`');

  const intro = lines.find((l) => l.includes(SESSION_PATH)) || '';
  check(`${loc} debrief Step 9 names the -2 counter`, intro.includes('`-2`'), 'no `-2` in the session-path paragraph');
  check(`${loc} debrief Step 9 points to the README's File names section`, intro.includes('File names'), 'no "File names" reference');

  const practicePath = join(dir, 'practice.md');
  if (existsSync(practicePath)) {
    const practice = readFileSync(practicePath, 'utf8');
    const p = practice.split('\n').find((l) => l.includes('interview-prep/sessions/{company-slug}')) || '';
    check(`${loc} practice session paragraph names the -2 counter`, p.includes('`-2`'), 'no `-2` in the session-path paragraph');
  }
}
