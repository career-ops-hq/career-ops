// Interview-process preferences are an ordinary `culture_screen.require`
// criterion under the existing Cultural signals dimension, not a sixth scoring
// dimension. Evaluation is executed by the agent from the mode files, so this
// suite pins the contract those files give it: the shipped example config
// carries a parseable interview-process criterion, Cultural signals names
// interview stages as evidence, the generic contradiction / no-evidence caps
// apply to any `require` line (including that one), and no sixth dimension or
// extra Block A row appears.
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nculture_screen — interview-process criterion lives in Cultural signals');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const check = (ok, message) => (ok ? pass(message) : fail(message));

const shared = read('modes/_shared.md');
const oferta = read('modes/oferta.md');
const example = read('config/profile.example.yml');
const customization = read('docs/CUSTOMIZATION.md');

// ── The shipped example: uncomment the culture_screen block and parse it ───
const exampleLines = example.split('\n');
const start = exampleLines.findIndex((l) => l.startsWith('# culture_screen:'));
const end = exampleLines.findIndex((l, i) => i > start && /deprioritize_if_absent:/.test(l));
let screen = null;
try {
  const block = exampleLines.slice(start, end + 1).map((l) => l.replace(/^# ?/, '')).join('\n');
  screen = load(block)?.culture_screen ?? null;
} catch (err) {
  screen = null;
}

check(
  start >= 0 && end > start && Array.isArray(screen?.require) && typeof screen?.deprioritize_if_absent === 'boolean',
  'the example culture_screen block uncomments to valid YAML with a require list and the strict flag',
);
// YAML folds a wrapped quoted string into one line, so check the raw text: each
// commented list item must open and close its quote on the same line.
const rawItems = exampleLines.slice(start, end + 1).filter((l) => /^#\s+- /.test(l));
check(
  rawItems.length > 0 && rawItems.every((l) => /^#\s+- ".*"$/.test(l)),
  'every example require criterion sits on one line (a wrapped quoted string is easy to break when copied)',
);
const interviewLines = (screen?.require ?? []).filter((line) => /interview/i.test(line));
check(
  interviewLines.length === 1 && /leetcode/i.test(interviewLines[0]) && /take-home/i.test(interviewLines[0]),
  'the example shows an interview-process criterion as one ordinary require line (LeetCode rounds and take-homes)',
);

// ── Cultural signals: the rules that score an explicit interview criterion ──
const culturalStart = shared.indexOf('**How to score the "Cultural signals" dimension:**');
const culturalEnd = shared.indexOf('## Posting Legitimacy');
const cultural = culturalStart >= 0 && culturalEnd > culturalStart ? shared.slice(culturalStart, culturalEnd) : '';
const rules = new Map(
  [...cultural.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]),
);

check(
  /named interview stages/.test(rules.get(2) ?? ''),
  'rule 2 lists named interview stages as evidence to look for against `require` criteria',
);
check(
  /evidence contradicts the `require` criteria/.test(rules.get(5) ?? '')
    && /cap this dimension at 2\/5/.test(rules.get(5) ?? '')
    && /Culture Screen field/.test(rules.get(5) ?? ''),
  'rule 5: a contradicted require criterion (e.g. LeetCode rounds) caps the dimension at 2/5 and is named in Block A',
);
check(
  /no evidence exists for any `require` criterion/.test(rules.get(6) ?? '')
    && /deprioritize_if_absent: true/.test(rules.get(6) ?? ''),
  'rule 6: absent interview detail defaults to 3, or caps at 2/5 under deprioritize_if_absent',
);
check(
  /3 by default/.test(rules.get(6) ?? '') && /4-5/.test(rules.get(3) ?? ''),
  'rule 3 scores positive evidence (e.g. pairing / system design) 4-5 and rule 6 defaults to 3',
);
check(
  /4\.5\+ overall but 2 or below on Cultural signals must carry an explicit warning/.test(rules.get(7) ?? ''),
  'rule 7: a high-fit role capped by the culture screen carries the explicit warning',
);
check(
  ![...rules.values()].some((text) => /^\*\*Interview/i.test(text)),
  'no interview-specific rule block is added to Cultural signals; the generic rules cover it',
);

// ── No sixth dimension, no extra Block A row ───────────────────────────────
const tableStart = shared.indexOf('| Dimension | What it measures |');
const tableEnd = shared.indexOf('Decide the Global Score once');
const rows = tableStart >= 0 && tableEnd > tableStart
  ? shared.slice(tableStart, tableEnd).split('\n').filter((l) => l.startsWith('|')).slice(2)
  : [];
const names = rows.map((l) => l.split('|')[1].trim());
check(
  JSON.stringify(names) === JSON.stringify(['Match con CV', 'North Star alignment', 'Comp', 'Cultural signals', 'Red flags', '**Global**']),
  'the scoring table still has exactly the five dimensions plus Global',
);
check(
  /scores five dimensions/.test(shared) && /integrating the five dimensions above/.test(shared),
  'the scoring prose still says five dimensions',
);
check(
  !/Interview process screen/.test(oferta) && /\*\*Culture screen\*\* \(see `_shared\.md` § Scoring System\)/.test(oferta),
  'Block A has no separate interview-process row; the Culture screen line is the one place stages are named',
);
check(
  oferta.includes('(`CV match`, `North Star alignment`, `Compensation`, `Cultural signals`, `Red flags`)'),
  'Score Evidence still lists the five dimensions, with no interview-process row',
);

// ── Docs ───────────────────────────────────────────────────────────────────
const bullet = customization.split('\n').find((l) => l.startsWith('- **culture_screen**')) ?? '';
check(/hiring process/i.test(bullet), 'CUSTOMIZATION.md tells users hiring-process preferences belong in culture_screen');
