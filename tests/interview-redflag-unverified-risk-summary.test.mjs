// tests/interview-redflag-unverified-risk-summary.test.mjs — the Risk Summary must
// not show the warning level of a red-flag file marked unverified (#6763).
//
// interview-redflag keeps a red-flag file that may rest on practice or mock
// sessions when the user declines to delete it, and adds a note saying its
// warning level is unverified. The note is rendered in the user's output
// language, so the evaluation modes cannot find it by its wording. Step 1 writes
// a fixed, untranslated HTML-comment marker above it, and every evaluation mode
// that cross-references the file reads the marker: a marked file renders
// `— not evaluated` with a link (not `— no interview sessions yet`, since the
// file exists) and maps to `risk_summary.interview_redflags: not_evaluated`.
// A file Step 5 rewrites from real-interview sessions carries no marker and
// shows its warning level as before; a missing file keeps the no-session row.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ninterview-redflag: an unverified red-flag file is not evaluated in the Risk Summary (#6763)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const between = (text, start, end) => {
  const a = text.indexOf(start);
  const b = a >= 0 ? text.indexOf(end, a + start.length) : -1;
  return a >= 0 && b > a ? text.slice(a, b) : '';
};
const fence = (text) => {
  const body = between(text, '```markdown\n', '\n```');
  return body.slice('```markdown\n'.length);
};
const LINK = '../interview-prep/{company-slug}-redflags.md';
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- the producer: interview-redflag writes the marker, Step 5 drops it ---
const redflag = read('modes', 'interview-redflag.md');
const step1 = between(redflag, '## Step 1', '## Step 2');
const step5 = between(redflag, '## Step 5', '## Step 6');
const noteBlock = fence(step1);
const [markerLine = '', noteLine = ''] = noteBlock.split('\n');
const MARKER = markerLine.trim();

check('Step 1 note block opens with a fixed HTML-comment marker',
  /^<!-- career-ops:[a-z-]+ -->$/.test(MARKER), `first line was ${JSON.stringify(markerLine)}`);
check('the marker sits outside the translated sentence, which stays in {language.output}',
  /^> \[Render in \{language\.output\}: "Unverified:/.test(noteLine) && !noteLine.includes('<!--'),
  `note line was ${JSON.stringify(noteLine)}`);
check('Step 1 says the marker is never translated and is what the Risk Summary reads',
  step1.includes(`write \`${MARKER}\` exactly as shown, never translated`)
    && /modes\/oferta\.md/.test(step1) && /batch\/batch-prompt\.md/.test(step1),
  'marker contract missing from Step 1');
check('Step 1 adds the marker to a note written before the marker existed',
  /if the note is there without the marker comment, add only the marker comment/.test(step1),
  'an older unmarked note stays invisible to the Risk Summary');
const template = fence(step5);
check('Step 5 output template carries a Warning level line and no marker (a rewrite drops it)',
  /\*\*Warning level:\*\* \{emoji\} \{label\}/.test(template) && !template.includes('career-ops:'),
  'template missing the level line or carrying a marker');
check('Step 5 says a rewritten file never carries the marker',
  step5.includes(`never carries the \`${MARKER}\` marker`), 'rewrite rule missing');

// --- the consumers: every evaluation mode that cross-references the file ---
// notEvaluated: the literal each file uses for its not-evaluated state.
// noSessions: the literal its missing-file row keeps.
const consumers = [
  { file: 'modes/oferta.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet' },
  { file: 'batch/batch-prompt.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet' },
  { file: 'modes/pt/oferta.md', notEvaluated: '— não avaliado', noSessions: '— sem sessões de entrevista ainda', level: '{nível}', l10n: true },
  { file: 'modes/ru/oferta.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/ua/oferta.md', notEvaluated: '— не оцінювалося', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/zh/oferta.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/zh-TW/oferta.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/ar/fursah.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/ja/kyujin.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/tr/is-ilani.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
  { file: 'modes/vi/tuyen-dung.md', notEvaluated: '— not evaluated', noSessions: '— no interview sessions yet', l10n: true },
];

// Every evaluation mode that cross-references the red-flag file must be in the list above,
// so a locale that adds the Interview red flags row later fails here until it is covered.
const referencing = ['modes/oferta.md', 'batch/batch-prompt.md'];
for (const dir of readdirSync(join(ROOT, 'modes'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(ROOT, 'modes', dir.name))) {
    if (f.endsWith('.md') && read('modes', dir.name, f).includes('-redflags.md')) referencing.push(`modes/${dir.name}/${f}`);
  }
}
const listed = new Set(consumers.map((c) => c.file));
const missing = referencing.filter((f) => !listed.has(f));
check('every mode file that cites the red-flag file is a checked consumer',
  missing.length === 0, `not covered: ${missing.join(', ')}`);

for (const c of consumers) {
  const text = read(c.file);
  const levelLink = `[${c.level || '{level}'}](${LINK})`;
  const cell = text.split('\n').find((l) => l.startsWith('|') && l.includes(levelLink)) || '';
  check(`${c.file}: valid file still shows its warning level and relative link`,
    cell.includes(`\`${levelLink}\``), 'level link missing from the Interview red flags row');
  check(`${c.file}: missing file still renders ${c.noSessions}`,
    cell.includes(`\`${c.noSessions}\``), 'no-session rendering missing');
  check(`${c.file}: reads the same marker interview-redflag writes`,
    cell.includes(`\`${MARKER}\``), `marker ${MARKER} not in the row rule`);
  const unverified = cell.match(new RegExp(`\`(${escape(c.notEvaluated)}): \\[[^\\]]+\\]\\(${escape(LINK)}\\)\``));
  check(`${c.file}: a marked file renders ${c.notEvaluated} with a link, not the no-session phrase`,
    Boolean(unverified) && !unverified[0].includes(c.noSessions),
    'unverified rendering missing or reuses the no-session phrase');
  // The rule must forbid the level for a marked file, so the level link cannot be the only rendering.
  check(`${c.file}: a marked file never shows its warning level`,
    cell.indexOf(MARKER) > cell.indexOf(levelLink) && unverified && cell.indexOf(unverified[0]) > cell.indexOf(MARKER),
    'unverified rule does not follow the marker check');
  if (c.l10n) {
    check(`${c.file}: the row rule maps a marked file to risk_summary.interview_redflags: not_evaluated`,
      /`risk_summary\.interview_redflags`[^|]*`not_evaluated`/.test(cell), 'Machine Summary mapping missing from the row');
  }
  // The named no-session exception must not swallow a marked file.
  const exceptionLine = text.split('\n').find((l) => l.includes('no interview sessions yet') && !l.startsWith('|') && /\*\*/.test(l)
    || l.includes('sem sessões de entrevista ainda') && !l.startsWith('|')) || '';
  check(`${c.file}: the no-session exception excludes a file marked unverified`,
    exceptionLine.includes(`\`${c.notEvaluated}\``) && (exceptionLine.match(new RegExp(escape(c.notEvaluated), 'g')) || []).length >= 2,
    'exception paragraph does not name the unverified case');
  // The count above still passes if the "marked file is not this exception" sentence goes,
  // so pin that sentence where the paragraph is written in a language this test reads.
  const exceptionExclusion = {
    'modes/oferta.md': /marked unverified.*`— not evaluated`.*not this exception/,
    'batch/batch-prompt.md': /marked unverified.*`— not evaluated`.*not this exception/,
    'modes/pt/oferta.md': /marcado como não verificado.*`— não avaliado`.*não esta exceção/,
  }[c.file];
  if (exceptionExclusion) {
    check(`${c.file}: a marked file is not the no-session exception`,
      exceptionExclusion.test(exceptionLine), 'marked-file exclusion missing from the exception paragraph');
  }
}

// --- Machine Summary agrees with the row ---
const batch = read('batch', 'batch-prompt.md');
check('batch-prompt: interview_redflags is not_evaluated when there is no file or it carries the marker',
  new RegExp(`\`interview_redflags\` from the red-flag file's warning level \\(\`none\` / \`caution\` / \`warning\`\\), or \`not_evaluated\` when there is no red-flag file or the file carries the \`${escape(MARKER)}\` marker`).test(batch),
  'Machine Summary mapping does not cover the marker');
check('batch-prompt: interview_redflags enum keeps not_evaluated (no new value for consumers to learn)',
  (batch.match(/interview_redflags: "\{none \| caution \| warning \| not_evaluated\}"/g) || []).length === 2,
  'enum changed');
const oferta = read('modes', 'oferta.md');
check('oferta: Machine Summary mirror says a row with no warning level is not_evaluated',
  /no redflags file, or one marked unverified\) is `interview_redflags: "not_evaluated"`, never the level written in the file/.test(oferta),
  'mirror rule missing');

// --- the four file states, decided the way the rule says (marker, never wording) ---
const ofertaCell = oferta.split('\n').find((l) => l.startsWith('| Interview red flags |')) || '';
const ofertaUnverified = (ofertaCell.match(new RegExp(`\`(— not evaluated: \\[[^\\]]+\\]\\(${escape(LINK)}\\))\``)) || [])[1];
function riskRow(file) {
  if (file === null) return { row: '— no interview sessions yet', ms: 'not_evaluated' };
  if (file.includes(MARKER)) return { row: ofertaUnverified, ms: 'not_evaluated' };
  const level = (file.match(/\*\*Warning level:\*\* (.+)/) || [])[1];
  const ms = /Reconsider/.test(level) ? 'warning' : /eyes open/.test(level) ? 'caution' : 'none';
  return { row: `[${level}](${LINK})`, ms };
}
const valid = template.replace('{emoji} {label}', '🚩 Reconsider').replace('{Company}', 'Acme');
const insertNote = (note) => valid.replace(/^(# Red-Flag Analysis — Acme)\n/, `$1\n${MARKER}\n${note}\n`);
const unverifiedJa = insertNote('> 未検証：この分析は練習または模擬セッションに基づいている可能性があります。');
const unverifiedEs = insertNote('> Sin verificar: este análisis puede basarse en sesiones de práctica o simuladas.');
const rewritten = template.replace('{emoji} {label}', '⚠️ Enter with eyes open').replace('{Company}', 'Acme');

check('fixture: oferta row rule yields an unverified rendering to compare against',
  Boolean(ofertaUnverified), 'could not extract the unverified rendering');
for (const [name, file] of [['Japanese', unverifiedJa], ['Spanish', unverifiedEs]]) {
  const r = riskRow(file);
  check(`unverified file with the note in ${name}: not evaluated, no warning level, map agrees`,
    r.row === ofertaUnverified && !r.row.includes('Reconsider') && r.ms === 'not_evaluated' && !/no interview sessions/.test(r.row),
    JSON.stringify(r));
}
const v = riskRow(valid);
check('valid file: warning level + relative link, map carries the level',
  v.row === `[🚩 Reconsider](${LINK})` && v.ms === 'warning', JSON.stringify(v));
const m = riskRow(null);
check('missing file: no-session row, map not_evaluated',
  m.row === '— no interview sessions yet' && m.ms === 'not_evaluated', JSON.stringify(m));
const rw = riskRow(rewritten);
check('file rewritten by Step 5 from real sessions: marker gone, new level shown',
  !rewritten.includes(MARKER) && rw.row === `[⚠️ Enter with eyes open](${LINK})` && rw.ms === 'caution', JSON.stringify(rw));
