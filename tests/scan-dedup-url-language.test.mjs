// tests/scan-dedup-url-language.test.mjs — behind
// scan_history.dedup_include_language, the URL dedup lets through a language
// version of a seen posting when every language version shares one URL key.
//
// Live shape: Personio serves every language version of a posting at
// /job/<id>?language=<code>, and normalizeUrlForDedup drops `language`, so the
// versions collapse into one URL key before the company+role check runs. A
// seen row that recorded no language is resolved against this scan's versions
// of the posting: by title, else as the first version (the posting's default
// language).
//
// The halves this file gates:
//   - a URL's language param reads back as a language form;
//   - the seen-version decision: recorded language, title match, first-version
//     fallback, and the conservative answers (unknown candidate, no rows);
//   - collectSeenUrls records a version for every URL it marks seen, from each
//     of its three sources, and none for a row the age policy released.
import { pass, fail } from './helpers.mjs';
import {
  collectSeenUrls,
  isUnseenLanguageVersion,
  languageFormsFromUrl,
  normalizeUrlForDedup,
  recordUrlVariant,
  variantTitleKey,
} from '../scan.mjs';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';

console.log('\nScan dedup — language versions sharing a URL key');

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label}: expected ${e}, got ${a}`);
}

const URL_BARE = 'https://acme.jobs.personio.de/job/2825443';
const URL_DE = `${URL_BARE}?language=de`;
const URL_EN = `${URL_BARE}?language=en`;
const KEY = normalizeUrlForDedup(URL_DE);
const TITLE_DE = 'Quality Assurance Engineer (m/w/d) - remote DE';
const TITLE_EN = 'Quality Assurance Engineer (m/f/d) - remote GER';

// ── languageFormsFromUrl ────────────────────────────────────────────
check('language param reads back', languageFormsFromUrl(URL_EN), ['en']);
check('lang / locale params read back, region folded',
  [languageFormsFromUrl('https://x.example/j/1?lang=de'), languageFormsFromUrl('https://x.example/j/1?locale=en_GB')],
  [['de'], ['en']]);
check('param name is case-insensitive', languageFormsFromUrl('https://x.example/j/1?Language=fr'), ['fr']);
check('no language param → none', languageFormsFromUrl(URL_BARE), []);
check('non-string / malformed → none', [languageFormsFromUrl(null), languageFormsFromUrl('not a url')], [[], []]);
check('all three versions share one URL key',
  [normalizeUrlForDedup(URL_BARE), normalizeUrlForDedup(URL_EN)], [KEY, KEY]);

// ── isUnseenLanguageVersion ─────────────────────────────────────────
const siblings = [
  { languages: ['de'], title: TITLE_DE },
  { languages: ['en'], title: TITLE_EN },
];
const de = { languages: ['de'], title: TITLE_DE };
const en = { languages: ['en'], title: TITLE_EN };
const row = (languages, title) => ({ languages, title: variantTitleKey(title) });

check('row with a recorded language: same language is a duplicate',
  isUnseenLanguageVersion([row(['de'], TITLE_DE)], de, siblings), false);
check('row with a recorded language: other language is new',
  isUnseenLanguageVersion([row(['de'], TITLE_DE)], en, siblings), true);
check('rows for every language: nothing is new',
  isUnseenLanguageVersion([row(['de'], TITLE_DE), row(['en'], TITLE_EN)], en, siblings), false);

// Unknown-language row resolved by title.
check('unknown-language row titled like the German version: German is a duplicate',
  isUnseenLanguageVersion([row([], TITLE_DE)], de, siblings), false);
check('unknown-language row titled like the German version: English is new',
  isUnseenLanguageVersion([row([], TITLE_DE)], en, siblings), true);
check('title match ignores case and whitespace',
  isUnseenLanguageVersion([row([], `  ${TITLE_EN.toUpperCase().replace(/ /g, '   ')} `)], de, siblings), true);
// The tenant-language row of a posting whose own default is English: the title
// match, not the first-version fallback, decides.
check('title match wins over the first-version fallback',
  isUnseenLanguageVersion([row([], TITLE_EN)], de, siblings), true);

// Unknown-language row with no single title match → the first version.
check('no title match → row is the first version: first is a duplicate',
  isUnseenLanguageVersion([row([], 'Retitled since')], de, siblings), false);
check('no title match → row is the first version: second is new',
  isUnseenLanguageVersion([row([], 'Retitled since')], en, siblings), true);
check('row without a title → row is the first version',
  [isUnseenLanguageVersion([row([], '')], de, siblings), isUnseenLanguageVersion([row([], '')], en, siblings)],
  [false, true]);
const sameTitle = [
  { languages: ['fr'], title: 'Testeur QA / QA Tester' },
  { languages: ['en'], title: 'Testeur QA / QA Tester' },
];
check('title shared by two versions → row is the first version',
  [isUnseenLanguageVersion([row([], 'Testeur QA / QA Tester')], { languages: ['fr'], title: 'Testeur QA / QA Tester' }, sameTitle),
    isUnseenLanguageVersion([row([], 'Testeur QA / QA Tester')], { languages: ['en'], title: 'Testeur QA / QA Tester' }, sameTitle)],
  [false, true]);
check('siblings without a language are not versions',
  isUnseenLanguageVersion([row([], 'X')], en, [{ languages: [], title: 'X' }, ...siblings]), true);

// Conservative answers.
check('candidate of unknown language stays a duplicate',
  isUnseenLanguageVersion([row(['de'], TITLE_DE)], { languages: [], title: TITLE_EN }, siblings), false);
check('no seen rows (seen through another token) stays a duplicate',
  [isUnseenLanguageVersion(undefined, en, siblings), isUnseenLanguageVersion([], en, siblings)], [false, false]);
check('unknown-language row and no versions to resolve it against stays a duplicate',
  isUnseenLanguageVersion([row([], TITLE_DE)], en, []), false);

// recordUrlVariant — the shape collectSeenUrls and the scan loop share.
{
  const variants = new Map();
  recordUrlVariant(variants, KEY, ['de'], `  ${TITLE_DE} `);
  recordUrlVariant(variants, KEY, []);
  check('recordUrlVariant appends {languages, title key} per key',
    variants.get(KEY), [{ languages: ['de'], title: variantTitleKey(TITLE_DE) }, { languages: [], title: '' }]);
}

// ── collectSeenUrls records the versions ────────────────────────────
{
  const header = SCAN_HISTORY_COLUMNS.join('\t');
  const historyRow = (fields) => SCAN_HISTORY_COLUMNS.map(name => fields[name] ?? '').join('\t');
  const scanHistoryText = [
    header,
    historyRow({ url: URL_BARE, first_seen: '2026-09-01', portal: 'personio-api', title: TITLE_DE, company: 'Acme', status: 'added' }),
    historyRow({ url: 'https://acme.jobs.personio.de/job/7', first_seen: '2026-09-01', title: 'Seven', status: 'added', language: 'de-DE' }),
    historyRow({ url: 'https://acme.jobs.personio.de/job/8?language=en', first_seen: '2026-09-01', title: 'Eight', status: 'added' }),
    // Released by the age policy below: no version recorded for it.
    historyRow({ url: 'https://acme.jobs.personio.de/job/9', first_seen: '2020-01-01', title: 'Nine', status: 'added' }),
  ].join('\n');
  const pipelineText = [
    '## Pending',
    `- [ ] ${URL_EN} | Acme | ${TITLE_EN}`,
  ].join('\n');
  const applicationsText = '| 1 | 2026-09-01 | Acme | Role | 4.0/5 | Applied | ❌ | — | https://acme.jobs.personio.de/job/10?language=fr |';
  const { seen, variants } = collectSeenUrls({ scanHistoryText, pipelineText, applicationsText },
    { recheckAfterDays: 365, today: '2026-10-05' });
  const at = (url) => variants.get(normalizeUrlForDedup(url));

  check('scan-history row without a language cell: unknown language, its title',
    at(URL_BARE)?.[0], { languages: [], title: variantTitleKey(TITLE_DE) });
  check('pipeline row: language from its URL param, title from its role cell',
    at(URL_BARE)?.[1], { languages: ['en'], title: variantTitleKey(TITLE_EN) });
  check('scan-history language cell wins and folds the region',
    at('https://acme.jobs.personio.de/job/7')?.[0]?.languages, ['de']);
  check('scan-history row without a language cell falls back to its URL param',
    at('https://acme.jobs.personio.de/job/8')?.[0]?.languages, ['en']);
  check('applications.md URL: language from the param, no title',
    at('https://acme.jobs.personio.de/job/10'), [{ languages: ['fr'], title: '' }]);
  check('row released by the age policy records no version',
    [seen.has(normalizeUrlForDedup('https://acme.jobs.personio.de/job/9')), at('https://acme.jobs.personio.de/job/9')],
    [false, undefined]);

  // End to end over the seeded rows: the scan's German and English versions.
  check('seeded legacy row + pipeline English row: German and English both seen',
    [isUnseenLanguageVersion(at(URL_BARE), de, siblings), isUnseenLanguageVersion(at(URL_BARE), en, siblings)],
    [false, false]);
  check('seeded legacy row alone: German seen, English new',
    [isUnseenLanguageVersion(at(URL_BARE).slice(0, 1), de, siblings), isUnseenLanguageVersion(at(URL_BARE).slice(0, 1), en, siblings)],
    [false, true]);
}
