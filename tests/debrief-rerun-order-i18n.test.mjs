// tests/debrief-rerun-order-i18n.test.mjs — the debrief re-run fix (#7035)
// must reach every translation of interview/debrief.
//
// English moved the existing-session check ahead of Step 8 (new Step 1d), made
// Step 8 replace a round's prep-file entry on a confirmed re-run, and made a
// recall re-run keep the picked file's turns and `stated_priorities`. A
// translation that kept the old text would still append a duplicate round
// entry and overwrite saved verbatim turns. This suite pins the structure each
// localized debrief must carry, whatever its prose says:
//   - a Step 1d (it: Passo 1d) heading sits between Step 1 and Step 2, and it
//     lists the `-2` variants, shows `interviewer_role`, and names the prep file;
//   - Step 8's opening line names Step 1d and the round-entry heading it replaces;
//   - Step 9's session-path paragraph names Step 1d, `-2` and "File names";
//   - a re-run paragraph after the session-path paragraph names Step 1d and,
//     where the locale has `input_source`, both inputs and `stated_priorities`.
// fr has no `input_source` or `stated_priorities` (its debrief predates them,
// #3407), so its re-run paragraph is checked for Step 1d and `## Q` only.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nDebrief re-run order reaches every translation (#7035)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const MODES = join(ROOT, 'modes');
const locales = [];
for (const entry of readdirSync(MODES, { withFileTypes: true })) {
  const file = join(MODES, entry.name, 'interview', 'debrief.md');
  if (entry.isDirectory() && existsSync(file)) locales.push([entry.name, readFileSync(file, 'utf8')]);
}
check('found localized debriefs to check', locales.length >= 12, `only ${locales.length}`);

const STEP = '(?:Step|Passo)';
const heading = (n) => new RegExp(`^## ${STEP} ${n} `, 'm');

function section(text, n) {
  const m = heading(n).exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  // Stop at the next step heading, not at any `## ` line: the Step 8 and Step 9
  // templates contain `## Round` and `## Q1` inside their fences.
  const next = rest.search(new RegExp(`\\n## (?:${STEP} |Rules)`));
  return next < 0 ? rest : rest.slice(0, next);
}

for (const [loc, text] of locales) {
  const pos = (n) => { const m = heading(n).exec(text); return m ? m.index : -1; };
  const p1d = pos('1d');
  check(`${loc} has a Step 1d heading`, p1d >= 0, 'no ## Step 1d / ## Passo 1d heading');
  check(`${loc} Step 1d sits between Step 1 and Step 2`, p1d > pos(1) && p1d < pos(2), `1=${pos(1)} 1d=${p1d} 2=${pos(2)}`);

  const s1d = section(text, '1d');
  check(`${loc} Step 1d lists the -2 variants`, s1d.includes('`-2`'), 'no `-2`');
  check(`${loc} Step 1d shows interviewer_role`, s1d.includes('`interviewer_role`'), 'no `interviewer_role`');
  check(`${loc} Step 1d checks the prep file when no session file exists`,
    s1d.includes('`interview-prep/{company-slug}-{role-slug}.md`'), 'prep file not named');

  const bullets = s1d.split('\n').filter((l) => l.startsWith('- **'));
  check(`${loc} Step 1d offers an interrupted prep entry when session files exist`,
    bullets.length === 2 && /`## (?:Round \[N\] Debrief|Debriefing del Round \[N\]) — \[YYYY-MM-DD\]`/.test(bullets[1]),
    bullets[1] ? bullets[1].slice(0, 100) : 'no second bullet');
  check(`${loc} Step 1d shows that entry's round type`,
    /`\*\*(?:Round type|Tipo di round|Type de round) ?:\*\*`/.test(bullets[1] || ''), 'no round-type label in the offer');

  const s8first =section(text, 8).split('\n').slice(1).find((l) => l.trim()) || '';
  check(`${loc} Step 8 opening names Step 1d`, /(?:Step|Passo) 1d/.test(s8first), s8first.slice(0, 100));
  check(`${loc} Step 8 opening names the round entry it replaces`, /`## (?:Round \[N\] Debrief|Debriefing del Round \[N\]) — \[YYYY-MM-DD\]`/.test(s8first), s8first.slice(0, 100));

  const s9 = section(text, 9);
  const paras = s9.split('\n');
  const introIdx = paras.findIndex((l) => l.includes('interview-prep/sessions/{company-slug}') && l.includes('File names'));
  const intro = paras[introIdx] || '';
  check(`${loc} Step 9 intro names Step 1d`, /(?:Step|Passo) 1d/.test(intro), intro.slice(0, 120));
  check(`${loc} Step 9 intro keeps the -2 counter`, intro.includes('`-2`'), 'no `-2`');

  const rerun = paras.slice(introIdx + 1).find((l) => /^\*\*[^*]*(?:Step|Passo) 1d/.test(l)) || '';
  check(`${loc} Step 9 has a re-run paragraph naming Step 1d`, rerun.length > 0, 'no bold paragraph naming Step 1d after the intro');
  check(`${loc} re-run paragraph adds missing questions as new ## Q turns`, rerun.includes('`## Q`'), rerun.slice(0, 120));
  if (text.includes('input_source: recall')) {
    check(`${loc} re-run paragraph covers both inputs and stated_priorities`,
      rerun.includes('`input_source: recall`') && rerun.includes('`input_source: transcript`') && rerun.includes('`stated_priorities`'),
      rerun.slice(0, 120));
  }
}
