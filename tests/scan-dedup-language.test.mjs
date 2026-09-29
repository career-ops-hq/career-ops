// tests/scan-dedup-language.test.mjs — company+role dedupe reads a
// provider-supplied requisition id and, behind scan_history.dedup_include_language,
// keeps language versions of one requisition apart.
//
// Live shape: an employer publishes one requisition in German and in English,
// seconds apart, with one title, one location and one requisition id. The
// company+role key collapses the versions into whichever one the provider
// returned first. A candidate who applies only to English postings then loses
// the English version whenever the German one wins.
//
// The halves this file gates:
//   - a provider requisition id is taken verbatim and wins over URL parsing;
//   - language forms fold regional variants onto the primary subtag;
//   - the language decision is conservative: an unknown language on either
//     side, or the switch off, keeps the historical "duplicate" answer;
//   - scan-history's requisition_id / language columns seed the decision, and
//     tracker / pipeline rows inherit them by URL;
//   - the row writer emits both columns, and a written row seeds the same key.
import { pass, fail } from './helpers.mjs';
import {
  ANY_REQUISITION,
  collectPostingAttributes,
  collectSeenCompanyRoles,
  companyRoleDedupKey,
  formatScanHistoryRow,
  isDistinctLanguage,
  languageFormsForDedup,
  matchesSeenCompanyRole,
  requisitionIdsForDedup,
  resolveDedupIncludeLanguage,
} from '../scan.mjs';
import {
  parseScanHistoryLine,
  scanHistoryLineHasColumn,
  SCAN_HISTORY_COLUMNS,
} from '../lib/scan-history-columns.mjs';

console.log('\nscan.mjs — requisition id + language-aware company+role dedupe');

const check = (ok, label, detail = '') => (ok ? pass(label) : fail(`${label}${detail ? ` — ${detail}` : ''}`));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HEADER = SCAN_HISTORY_COLUMNS.join('\t');
const DE_URL = 'https://jobs.smartrecruiters.com/acmegmbh/1001-senior-qa-manager';
const EN_URL = 'https://jobs.smartrecruiters.com/acmegmbh/1002-senior-qa-manager';
const historyRow = (url, { requisition = '', language = '', location = 'Hamburg, Germany' } = {}) => {
  const record = {
    url, first_seen: '2026-09-28', portal: 'smartrecruiters-api', title: 'Senior QA Manager',
    company: 'Acme', status: 'added', location, normalized_company: 'acme',
    requisition_id: requisition, language,
  };
  return SCAN_HISTORY_COLUMNS.map((name) => record[name] ?? '').join('\t');
};

// ── 1. Provider requisition id ───────────────────────────────────────────────
{
  const cases = [
    [{ requisitionId: 'ID2608-00427A' }, ['ID2608-00427A'], 'supplied id is taken verbatim'],
    [{ requisitionId: 'ref7515n' }, ['REF7515N'], 'supplied id is case-folded like every other form'],
    [{ requisitionId: 'JREQ 12757' }, ['JREQ 12757'], 'an inner space is part of the id, not a separator'],
    [{ requisitionId: 'R7501', url: 'https://acme.wd1.myworkdayjobs.com/careers/job/London/Engineer_JR100' }, ['R7501'], 'supplied id wins over a Workday URL tail'],
    [{ requisitionId: '   ', url: 'https://acme.wd1.myworkdayjobs.com/careers/job/London/Engineer_JR100' }, ['JR100'], 'a blank supplied id falls back to the URL'],
    [{ requisitionId: 42 }, [], 'a non-string supplied id is ignored'],
    [{ url: 'https://jobs.smartrecruiters.com/acmegmbh/744000152158712-role' }, [], 'the SmartRecruiters posting id in the URL is still not a requisition'],
  ];
  for (const [input, want, label] of cases) {
    const got = requisitionIdsForDedup(input);
    check(same(got, want), `requisitionIdsForDedup: ${label}`, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ── 2. Language forms ────────────────────────────────────────────────────────
{
  const cases = [
    ['de', ['de']],
    ['en-GB', ['en']],
    ['EN', ['en']],
    ['en-us', ['en']],
    ['en_GLOBAL', ['en']],
    ['zh_TW', ['zh']],
    ['zh-Hant-TW', ['zh']],
    [' fr-CA ', ['fr']],
    ['deu', ['de']],
    ['eng', ['en']],
    ['iw', ['he']],
    ['German', ['german']],
    [' german ', ['german']],
    ['English (US)', ['english (us)']],
    ['x', ['x']],
    ['', []],
    ['   ', []],
    [undefined, []],
    [{ code: 'de' }, []],
  ];
  for (const [input, want] of cases) {
    const got = languageFormsForDedup(input);
    check(same(got, want), `languageFormsForDedup(${JSON.stringify(input)}) → ${JSON.stringify(want)}`, `got ${JSON.stringify(got)}`);
  }
}

// ── 3. Language decision is conservative ─────────────────────────────────────
{
  const checks = [
    [new Set(['de']), ['en'], true, 'another language version is distinct'],
    [new Set(['de', 'en']), ['en'], false, 'a seen language is a duplicate'],
    [new Set(['de', ANY_REQUISITION]), ['en'], false, 'a seed with unknown language keeps the duplicate'],
    [undefined, ['en'], false, 'no seed data keeps the duplicate'],
    [new Set(['de']), [], false, 'an unknown candidate language keeps the duplicate'],
  ];
  for (const [seeded, candidate, want, label] of checks) {
    check(isDistinctLanguage(seeded, candidate) === want, `isDistinctLanguage: ${label}`, `expected ${want}`);
  }
}

// ── 4. The switch ────────────────────────────────────────────────────────────
{
  check(resolveDedupIncludeLanguage({ scan_history: { dedup_include_language: true } }) === true,
    'resolveDedupIncludeLanguage: true turns it on');
  check(resolveDedupIncludeLanguage({ scan_history: { dedup_include_language: 'true' } }) === false,
    'resolveDedupIncludeLanguage: a string is a typo, not true');
  check(resolveDedupIncludeLanguage({}) === false, 'resolveDedupIncludeLanguage: absent means off');
}

// ── 5. matchesSeenCompanyRole combines requisition and language ──────────────
{
  const key = companyRoleDedupKey('Acme', 'Senior QA Manager');
  const state = {
    key,
    baseKey: key,
    seen: new Set([key]),
    requisitions: new Map([[key, new Set(['ID2608-00427A'])]]),
    locatedRequisitions: new Map(),
    languages: new Map([[key, new Set(['de'])]]),
    locatedLanguages: new Map(),
  };
  check(matchesSeenCompanyRole(state, ['ID2608-00427A'], ['en']) === false,
    'matchesSeenCompanyRole: same requisition, other language, switch on → kept');
  check(matchesSeenCompanyRole(state, ['ID2608-00427A'], []) === true,
    'matchesSeenCompanyRole: same requisition, switch off (no candidate language) → duplicate');
  check(matchesSeenCompanyRole(state, ['ID2608-00427A'], ['de']) === true,
    'matchesSeenCompanyRole: same requisition, same language → duplicate');
  check(matchesSeenCompanyRole(state, ['ID2609-00001B'], []) === false,
    'matchesSeenCompanyRole: different requisition → kept, regardless of language');
  const legacy = { key, baseKey: key, seen: new Set([key]), requisitions: new Map(), locatedRequisitions: new Map() };
  check(matchesSeenCompanyRole(legacy, [], ['en']) === true,
    'matchesSeenCompanyRole: callers without language maps keep the historical answer');
}

// ── 6. Seeding from scan-history, inherited by tracker and pipeline rows ─────
{
  const requisitionsByBase = new Map();
  const languagesByBase = new Map();
  collectSeenCompanyRoles({
    scanHistoryText: `${HEADER}\n${historyRow(DE_URL, { requisition: 'ID2608-00427A', language: 'de' })}\n`,
    pipelineText: `- [ ] ${DE_URL} | Acme | Senior QA Manager | Hamburg, Germany\n`,
    applicationsText: `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-09-28 | Acme | Senior QA Manager | 2.4/5 | SKIP | ❌ | [001](../reports/001-acme-2026-09-28.md) | skipped | ${DE_URL} |
`,
  }, {}, undefined, { requisitionsByBase, languagesByBase });
  const key = companyRoleDedupKey('Acme', 'Senior QA Manager');
  const reqs = requisitionsByBase.get(key);
  const langs = languagesByBase.get(key);
  check(reqs && reqs.size === 1 && reqs.has('ID2608-00427A'),
    'collectSeenCompanyRoles: history, pipeline and tracker rows for one URL seed one requisition',
    `seeded [${reqs ? [...reqs].join(', ') : 'nothing'}]`);
  check(langs && langs.size === 1 && langs.has('de'),
    'collectSeenCompanyRoles: pipeline and tracker rows inherit the history language (no unknown marker)',
    `seeded [${langs ? [...langs].join(', ') : 'nothing'}]`);
  check(isDistinctLanguage(langs, ['en']) === true,
    'collectSeenCompanyRoles: the English version of that requisition is distinct in a later run');
}
{
  // One URL, several rows: fields merge, a later value wins, an empty cell
  // keeps what an earlier row recorded.
  const attributes = collectPostingAttributes([
    HEADER,
    historyRow(DE_URL, { requisition: 'ID2608-00427A', language: 'de' }),
    historyRow(DE_URL, { requisition: 'ID2608-00427B' }),
    historyRow(DE_URL),
  ].join('\n'));
  const merged = [...attributes.values()];
  check(merged.length === 1 && merged[0].requisitionId === 'ID2608-00427B' && merged[0].language === 'de',
    'collectPostingAttributes: rows for one URL merge field by field (later value wins, empty keeps)',
    `got ${JSON.stringify(merged)}`);
}
{
  const languagesByBase = new Map();
  collectSeenCompanyRoles({
    scanHistoryText: `${HEADER}\n${historyRow(DE_URL, { requisition: 'ID2608-00427A', language: 'de' })}\n`,
    pipelineText: `- [ ] https://jobs.smartrecruiters.com/acmegmbh/999-senior-qa-manager | Acme | Senior QA Manager | Hamburg, Germany\n`,
  }, {}, undefined, { languagesByBase });
  const langs = languagesByBase.get(companyRoleDedupKey('Acme', 'Senior QA Manager'));
  check(langs && langs.has(ANY_REQUISITION),
    'collectSeenCompanyRoles: a pipeline row whose URL history never described stays unknown');
}
{
  const languagesByBase = new Map();
  collectSeenCompanyRoles({
    scanHistoryText: `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${DE_URL}\t2026-09-28\tsmartrecruiters-api\tSenior QA Manager\tAcme\tadded\tHamburg, Germany\n`,
  }, {}, undefined, { languagesByBase });
  const langs = languagesByBase.get(companyRoleDedupKey('Acme', 'Senior QA Manager'));
  check(langs && langs.size === 1 && langs.has(ANY_REQUISITION),
    'collectSeenCompanyRoles: a legacy 7-column history row reads as unknown language');
}
{
  const languagesByBase = new Map();
  const locatedLanguagesByBase = new Map();
  collectSeenCompanyRoles({
    scanHistoryText: `${HEADER}\n${historyRow(DE_URL, { requisition: 'ID2608-00427A', language: 'de' })}\n`,
  }, {}, undefined, { includeLocation: true, languagesByBase, locatedLanguagesByBase });
  const located = companyRoleDedupKey('Acme', 'Senior QA Manager', undefined, 'Hamburg, Germany');
  const base = companyRoleDedupKey('Acme', 'Senior QA Manager');
  check(languagesByBase.get(located)?.has('de') && locatedLanguagesByBase.get(base)?.has('de'),
    'collectSeenCompanyRoles: with dedup_include_location the language lands on the located key and its base aggregate');
}

// ── 7. Row writer ────────────────────────────────────────────────────────────
{
  const offer = {
    url: EN_URL, source: 'smartrecruiters-api', title: 'Senior QA Manager', company: 'Acme',
    location: 'Hamburg, Germany', requisitionId: 'JREQ 12757', language: 'en-GB',
  };
  const line = formatScanHistoryRow(offer, '2026-09-28');
  const written = parseScanHistoryLine(line);
  check(line.split('\t').length === SCAN_HISTORY_COLUMNS.length
      && written.requisition_id === 'JREQ 12757' && written.language === 'en-GB',
    'formatScanHistoryRow: writes every declared column, requisition_id and language included',
    `got ${JSON.stringify(written)}`);
  const bare = parseScanHistoryLine(formatScanHistoryRow({ url: EN_URL, source: 's', title: 't', company: 'c' }, '2026-09-28'));
  check(bare.requisition_id === '' && bare.language === '',
    'formatScanHistoryRow: a provider without the fields writes empty cells');
  // Append-only: every column that has ever shipped keeps its position, so a
  // later column can only extend this prefix, never shift it.
  const SHIPPED = [
    'url',
    'first_seen',
    'portal',
    'title',
    'company',
    'status',
    'location',
    'fingerprint',
    'posted_at',
    'trust_score',
    'trust_flags',
    'normalized_company',
    'requisition_id',
    'language',
  ];
  check(same(SCAN_HISTORY_COLUMNS.slice(0, SHIPPED.length), SHIPPED),
    'SCAN_HISTORY_COLUMNS: shipped columns keep their positions (append-only, positional readers stay valid)',
    `got ${JSON.stringify(SCAN_HISTORY_COLUMNS)}`);
  const legacyLine = 'https://x.example/1\t2026-01-01\tp\tt\tc\tadded\tBerlin';
  const legacy = parseScanHistoryLine(legacyLine);
  check(legacy.location === 'Berlin' && legacy.fingerprint === '' && legacy.language === '',
    'parseScanHistoryLine: a short legacy row reads its missing cells as empty');
  check(scanHistoryLineHasColumn(legacyLine, 'location') && !scanHistoryLineHasColumn(legacyLine, 'fingerprint')
      && scanHistoryLineHasColumn('https://x.example/1\t2026-01-01\t\t\t', 'company'),
    'scanHistoryLineHasColumn: tells a missing column from an empty cell');
  let unknownThrew = false;
  try { scanHistoryLineHasColumn(legacyLine, 'no_such_column'); } catch { unknownThrew = true; }
  check(unknownThrew, 'scanHistoryLineHasColumn: an unknown column name throws instead of reading as absent');

  const requisitionsByBase = new Map();
  const languagesByBase = new Map();
  collectSeenCompanyRoles({ scanHistoryText: `${HEADER}\n${line}\n` }, {}, undefined, { requisitionsByBase, languagesByBase });
  const key = companyRoleDedupKey('Acme', 'Senior QA Manager');
  check(requisitionsByBase.get(key)?.has('JREQ 12757') && languagesByBase.get(key)?.has('en'),
    'formatScanHistoryRow → collectSeenCompanyRoles: a written row seeds its requisition and language');
}
