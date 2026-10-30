import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
const kyujin = readFileSync(join(ROOT, 'modes', 'ja', 'kyujin.md'), 'utf8');
const batch = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');

console.log('\nRecruiter identity verification (Block G Signal 18, #5079)');

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(`${label}: ${detail}`);
}

const signal = oferta.match(/\*\*18\. Recruiter Identity Verification\*\*[\s\S]*?(?=\n### Output format:)/)?.[0] ?? '';
check('oferta defines Signal 18 as the last signal before the output format', Boolean(signal), 'missing Signal 18 section');
check(
  'signal runs only for recruiter outreach',
  /only when the role reached the candidate through recruiter outreach/i.test(signal)
    && /otherwise skip and say nothing/i.test(signal),
  'recruiter-only gate is missing',
);
check(
  'recruiter outreach that links a posting is still recruiter-sourced',
  /including outreach that links a public posting/.test(signal)
    && /a posting the candidate found on their own/.test(signal),
  'gate keys on URL presence instead of how the role arrived',
);
check(
  'checks without a query budget mark missing evidence Unknown, not Concerning',
  /Checks \(b\), \(c\) and \(e\) spend no queries/.test(signal)
    && /never Concerning on absence of evidence alone/.test(signal)
    && /Absence from a list that does not claim to be complete is Unknown/.test(signal),
  'Unknown rule for (b), (c), (e) is missing',
);
check(
  'signal carries all five checks',
  ['(a) Official board', '(b) Name pairing', '(c) Recruiter-to-company link', '(d) Public scam reports', '(e) Process requests']
    .every((label) => signal.includes(label)),
  'one or more of checks (a)-(e) is missing',
);
check(
  'research cost stays bounded',
  /at most one query each from the bounded research budget/i.test(signal),
  'query budget is not stated',
);
check(
  'agent never runs recruiter-supplied code',
  /never clone, install, open, or execute a repository, archive, or link the recruiter supplied/i.test(signal)
    && /untrusted external content/i.test(signal),
  'hard rule or untrusted-content rule is missing',
);
check(
  'signal feeds the tier with an evidence threshold',
  /this signal feeds the tier/i.test(signal)
    && /Recruiter contact alone is Neutral/.test(signal)
    && /\(a\) or \(d\) is Concerning and at least one other check is also Concerning/.test(signal),
  'tier rule is missing or has no evidence threshold',
);
check(
  'suspicious note is rendered in the output language and stays non-accusatory',
  signal.includes('⚠️ **Recruiter identity note:**')
    && signal.includes('Render in {language.output}')
    && /Present observations, not accusations/.test(signal),
  'note template is incomplete',
);

check(
  'recruiter contact is no longer a positive legitimacy signal (oferta)',
  !/recruiter contact is itself a positive legitimacy signal/i.test(oferta)
    && /Recruiter contact alone is Neutral, not a positive legitimacy signal: run Signal 18/.test(oferta),
  'edge case still treats recruiter contact as positive',
);
// Translated modes carry the recruiter edge case in their own language and
// stay self-contained: no positive-signal rule, the five checks, and the
// hard stop on recruiter-supplied material.
const locales = [
  {
    file: ['ja', 'kyujin.md'],
    oldRule: /Active recruiter contact 自体を positive legitimacy signal として note/,
    freshness: 'Posting snapshot がない場合のみ Freshness signals unavailable',
    budget: '(b)、(c)、(e) は新しい検索をせず',
    note: 'non-accusatory な recruiter identity note',
    checks: '(a) company 自身の careers page',
    hardStop: 'clone / install / open / execute しない',
  },
  {
    file: ['es', 'oferta.md'],
    oldRule: /contacto activo del recruiter es señal positiva de legitimidad/,
    freshness: 'señales de frescura no disponibles solo si no hay captura de la publicación',
    budget: '(b), (c) y (e) no hacen búsquedas nuevas',
    note: 'añadir una nota breve y no acusatoria',
    checks: '(a) ¿la página de empleo o el board ATS público de la propia empresa lista el rol?',
    hardStop: 'Nunca clonar, instalar, abrir ni ejecutar repositorios, archivos o enlaces enviados por el recruiter',
  },
  {
    file: ['ru', 'oferta.md'],
    oldRule: /активный контакт рекрутера сам по себе — положительный сигнал легитимности/,
    freshness: 'сигналы свежести недоступны, только если снимка вакансии нет',
    budget: '(b), (c) и (e) не делают новых поисков',
    note: 'добавить короткую, необвиняющую заметку',
    checks: '(a) есть ли эта роль на собственной странице карьеры или публичной ATS-доске компании',
    hardStop: 'Никогда не клонировать, не устанавливать, не открывать и не запускать репозитории, архивы или ссылки от рекрутера',
  },
  {
    file: ['tr', 'is-ilani.md'],
    oldRule: /Aktif recruiter temasının kendisinin olumlu bir meşruiyet sinyali olduğunu not et/,
    freshness: 'Tazelik sinyali sadece ilanın snapshot\'ı yoksa alınamaz',
    budget: '(b), (c) ve (e) yeni arama yapmaz',
    note: 'kısa ve suçlamayan bir not ekle',
    checks: '(a) şirketin kendi kariyer sayfası veya herkese açık ATS board\'u bu rolü listeliyor mu',
    hardStop: 'Recruiter\'ın gönderdiği repo, arşiv veya linki asla klonlama, kurma, açma ya da çalıştırma',
  },
];
for (const { file, oldRule, freshness, budget, note, checks, hardStop } of locales) {
  const text = file[0] === 'ja' ? kyujin : readFileSync(join(ROOT, 'modes', ...file), 'utf8');
  check(
    `recruiter edge case is self-contained and no longer positive (${file.join('/')})`,
    !oldRule.test(text)
      && text.includes(freshness)
      && text.includes(budget)
      && text.includes(note)
      && text.includes(checks)
      && text.includes(hardStop)
      && !text.includes('modes/oferta.md の Signal 18'),
    'old positive-signal rule, conditional freshness, query budget, Suspicious note, the checks, or the hard stop is wrong',
  );
}

check(
  'batch prompt mirrors Signal 18 with the hard stop and lets it set the tier',
  /18\. \*\*Recruiter Identity Verification\*\*/.test(batch)
    && /Never clone, install, open, or execute anything the recruiter supplied/.test(batch)
    && /Signals 1-5, 7-9 and 18 set the tier/.test(batch)
    && /including outreach that links a public posting/.test(batch)
    && !/a posting URL → `not evaluated`/.test(batch)
    && /never Concerning\./.test(batch),
  'batch parity, gate, Unknown rule, hard stop, or tier wording is missing',
);
