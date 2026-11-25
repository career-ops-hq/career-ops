// tests/scan-preferred-languages.test.mjs — portals.yml preferred_languages:
// the scan keeps the version of a posting in the language the candidate wants.
//
// The halves this file gates:
//   - the setting is read and reduced the way posting languages are;
//   - a language ranks by its place in the list, -1 when absent or unknown;
//   - one provider's jobs are ordered preferred-language first, stably, so the
//     dedup that keeps the first version keeps the preferred one;
//   - validate-portals.mjs reports a malformed list.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  resolvePreferredLanguages,
  preferredLanguageRanker,
  orderByPreferredLanguage,
} from '../scan.mjs';

console.log('\nScan — preferred posting languages');

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label}: expected ${e}, got ${a}`);
}

// ── resolvePreferredLanguages ───────────────────────────────────────
check('absent → no preference', resolvePreferredLanguages({}), []);
check('a list, best first, reduced to language forms',
  resolvePreferredLanguages({ preferred_languages: ['en-GB', 'deu'] }), ['en', 'de']);
check('a single string counts as a one-entry list', resolvePreferredLanguages({ preferred_languages: 'en' }), ['en']);
check('a repeated language keeps its first place',
  resolvePreferredLanguages({ preferred_languages: ['en', 'fr', 'en-US'] }), ['en', 'fr']);
check('entries that are not non-empty strings are skipped',
  resolvePreferredLanguages({ preferred_languages: ['', 7, null, 'fr'] }), ['fr']);

// ── preferredLanguageRanker ─────────────────────────────────────────
const rank = preferredLanguageRanker(['en', 'fr']);
check('a preferred language ranks by its place, region and case folded',
  [rank('en'), rank('EN-gb'), rank('fr_CA')], [0, 0, 1]);
check('a language not in the list, or none, ranks -1', [rank('de'), rank(''), rank(undefined)], [-1, -1, -1]);

// ── orderByPreferredLanguage ────────────────────────────────────────
// Personio / Recruitee shape: the language versions of one posting share a
// URL, the default language first.
const jobs = [
  { url: 'https://acme.example/o/qa?lang=de', language: 'de', title: 'QA (m/w/d)' },
  { url: 'https://acme.example/o/qa?lang=en', language: 'en', title: 'QA (m/f/d)' },
  { url: 'https://acme.example/o/dev', title: 'Dev (no language)' },
  { url: 'https://acme.example/o/ops?lang=fr', language: 'fr', title: 'Ops (fr)' },
  { url: 'https://acme.example/o/pm?lang=en', language: 'en', title: 'PM (en)' },
];
const ordered = orderByPreferredLanguage(jobs, rank);
check('preferred languages first, best first; the rest in provider order',
  ordered.map(j => j.title), ['QA (m/f/d)', 'PM (en)', 'Ops (fr)', 'QA (m/w/d)', 'Dev (no language)']);
check('the provider\'s array is left as it was', jobs.map(j => j.title)[0], 'QA (m/w/d)');

// SmartRecruiters shape: each language version is its own posting with its own
// URL, tied by the requisition id; the company + role dedup keeps the first.
const separateUrls = [
  { url: 'https://jobs.example.com/postings/1001', language: 'de', requisitionId: 'R-7', title: 'QA' },
  { url: 'https://jobs.example.com/postings/1002', language: 'en', requisitionId: 'R-7', title: 'QA' },
];
check('versions on separate URLs are ordered the same way',
  orderByPreferredLanguage(separateUrls, rank).map(j => j.language), ['en', 'de']);

// ── validate-portals.mjs ────────────────────────────────────────────
// Run as the CLI, the way a user meets it: the paths it reports for the key.
function validatorPaths(yamlValue) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-preferred-languages-'));
  try {
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `preferred_languages: ${yamlValue}\ntracked_companies: []\n`);
    let out;
    try {
      out = execFileSync(NODE, ['validate-portals.mjs', '--file', portals], {
        cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
      });
    } catch (err) {
      out = `${err.stdout || ''}${err.stderr || ''}`;
    }
    // A path also appears inside its own message, so each one is listed once.
    return [...new Set([...out.matchAll(/preferred_languages(\[\d+\])?/g)].map(m => m[0]))];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
check('validate-portals: a list of codes or a single code is valid',
  [validatorPaths('[en, fr]'), validatorPaths('en')], [[], []]);
check('validate-portals: a mapping instead of a list is reported', validatorPaths('{ en: true }'), ['preferred_languages']);
check('validate-portals: each empty or non-string entry is reported by index',
  validatorPaths('[en, "", 3]'), ['preferred_languages[1]', 'preferred_languages[2]']);
