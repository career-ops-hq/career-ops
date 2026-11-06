// tests/debrief-quote-escape-rule.test.mjs — the stated_priorities.quote rule must
// preserve the exact spoken value, including literal backslashes (#6540).
//
// The Step 9 instruction in modes/interview/debrief.md used to say only
// "double-quote every quote and escape inner double quotes". For a quoted
// interviewer who actually said `\n` or `\t`, that produces a YAML double-quoted
// scalar whose \n means a newline: valid YAML, wrong value. Escaping
// backslashes before inner double quotes (\\n -> \n literal) is what makes the
// parsed value byte-identical to what was said, so the rule texts name that
// order explicitly and the translations keep the same three ingredients:
// backslash escaping, inner-double-quote escaping, and the value staying intact.
//
// fr and id are not asserted: their debrief translations predate the whole
// Step-9 stated_priorities rule (pre-existing drift, tracked outside this fix).
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nDebrief quote-escape rule: backslash-before-quotes keeps the exact value (#6540)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (...p) => readFileSync(join(ROOT, 'modes', ...p), 'utf8');
const bullet = (...dir) => {
  const raw = read(...dir, 'debrief.md');
  const line = raw.split('\n').find((l) => l.includes('`stated_priorities`') && l.includes('`quote`'));
  return line || '';
};

// --- canonical English rule: order must be explicit (this is the source) ---
const en = bullet('interview');
check('canonical rule still requires double-quoted quote values', /Double-quote every `quote`/.test(en), 'missing double-quote requirement');
check('canonical rule escapes backslashes before inner double quotes', /escape backslashes before escaping inner double quotes/.test(en), 'ordering not stated');
check('canonical rule names the concrete loss (literal \\n must not become a newline)', /\\n/.test(en) && /stays two characters/.test(en), 'no literal-\\n consequence named');

// --- omission rules survived the rewrite ---
check('canonical keeps the recall-input omission rule', /input_source: recall/.test(en), 'recall omission lost');
check('canonical keeps the practice-session omission rule', /practice-session file/.test(en), 'practice-session omission lost');

// --- each locale carrying the rule keeps all three ingredients ---
// (backslash-escape ingredient, inner-double-quote ingredient, intact-value promise)
const locales = [
  ['de', /Backslashes zuerst escapen/, /innere doppelte Anführungszeichen/, /zwei Zeichen/],
  ['es', /barras invertidas/, /comillas dobles internas/, /dos caracteres/],
  ['it', /barre rovesciate/, /virgolette doppie interne/, /due caratteri/],
  ['ja', /バックスラッシュをエスケープ/, /内側のダブルクォート/, /2 文字/],
  ['ko', /역슬래시/, /큰따옴표/, /두 글자/],
  ['pl', /backslashe/, /wewnętrzne podwójne cudzysłowy/, /dwoma znakami/],
  ['pt', /barras invertidas/, /aspas duplas internas/, /dois caracteres/],
  ['ru', /обратные слэши/, /внутренние двойные кавычки/, /двумя символами/],
  ['ua', /зворотні скісні риски/, /внутрішні подвійні лапки/, /двома символами/],
  ['zh', /反斜杠/, /内部双引号/, /两个字符/],
];
for (const [loc, bs, inner, intact] of locales) {
  const line = bullet(loc, 'interview');
  check(`${loc} rule mentions backslash escaping`, bs.test(line), `no backslash term in: ${line.slice(0, 80)}`);
  check(`${loc} rule still guards inner double quotes`, inner.test(line), `no inner-quote term`);
  check(`${loc} rule promises the value survives intact`, intact.test(line), `no intact-value term`);
}

// --- the rule's reason: YAML round trip on a transcript-shaped quote ---
// Fix per the rule (escape backslashes first, then quotes):
const byRule = yaml.load('q: "He said \\"hi\\" then wrote a\\\\nb"');
check('rule-escaped quote parses back to the exact spoken value',
  byRule.q === 'He said "hi" then wrote a\\nb', JSON.stringify(byRule.q));
// Without the backslash-first rule, the same spoken quote serializes differently:
const naive = yaml.load('q: "He said \\"hi\\" then wrote a\\nb"');
check('backslash-blind serialization silently changes the value',
  naive.q === 'He said "hi" then wrote a\nb' && naive.q !== byRule.q, JSON.stringify(naive.q));
