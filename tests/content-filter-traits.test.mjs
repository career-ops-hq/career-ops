// tests/content-filter-traits.test.mjs — `content_filter` trait matching and
// the title-miss rescue (#6020).
//
// The same work hides under different titles: a "Solutions Engineer", a
// "Forward Deployed Engineer" and a "Customer Engineer" can be one job, and a
// title list never converges on every spelling. Two content_filter gaps kept
// it from selecting such roles on what the posting says:
//   1. it ran after title_filter, so a title miss never reached it, and
//   2. any one positive keyword kept a posting, so a single generic word
//      ("demo", "customers") was as good as a full description of the role.
// `rescue_title_misses: true` closes the first and `min_match` the second.
//
// Ported from the selection-logic tests of the scan-jd prototype proposed in
// #6020. The tests that covered only that separate command (its CLI, receipt,
// JD fetching and hydration ledger) have no counterpart here: content_filter
// reads only the listing text the scan already holds.
//
// Section 5 runs the real scan.mjs with the builtin provider's fetch replaced
// by a fixture, the preload technique scan-unnamed-employer-dedup.test.mjs
// uses. Any real network request fails the run.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  buildContentFilter, compileContentTraits, matchContentTraits, foldContentText,
  matchedTitleKeywords, buildTitleGate,
} from '../scan.mjs';
import { passesFilters, warnRescueTitleMissesIgnored, RESCUE_TITLE_MISSES_IGNORED_WARNING } from '../scan-ats-full.mjs';
import { scanBoard } from '../scan-dayforce.mjs';
import { buildTitleFilter, buildLocationFilter } from '../scan.mjs';
import { validatePortalsConfig } from '../validate-portals.mjs';

// The child scanners get none of the caller's CAREER_OPS_* settings: each one
// points at the developer's own data.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CAREER_OPS_')));

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const okAsync = async (name, fn) => { try { await fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const traits = (positive, negative = [], minMatch = 1) => ({
  positive: compileContentTraits(positive), negative: compileContentTraits(negative), minMatch,
});

console.log('\ncontent_filter — trait matching and title-miss rescue (#6020)');

// ── 1. Trait lists: deduplication, prefixes, alternatives, folding ────
ok('traits deduplicate case-insensitively, keep the first spelling, and keep order', () => {
  const compiled = compileContentTraits([' Demo ', 'demo', 'word:intern', 'stem:demo', 'DEMO']);
  assert.deepStrictEqual(compiled.map(t => t.original), ['Demo', 'word:intern', 'stem:demo']);
});

ok('a bare string, non-strings and empty entries are tolerated like a keyword list', () => {
  assert.deepStrictEqual(compileContentTraits('python').map(t => t.original), ['python']);
  assert.deepStrictEqual(compileContentTraits(['', '  ', 3, null, 'go']).map(t => t.original), ['go']);
  assert.deepStrictEqual(compileContentTraits(undefined), []);
});

ok('word: and stem: prefixes keep their title_filter meaning inside a trait', () => {
  assert.strictEqual(matchContentTraits('internship intern', traits(['word:intern'])).matched, true);
  assert.strictEqual(matchContentTraits('internship', traits(['word:intern'])).matched, false);
  assert.strictEqual(matchContentTraits('demonstration', traits(['stem:demo'])).matched, true);
  assert.strictEqual(matchContentTraits('a pseudo-demo', traits(['stem:demo'])).matched, true);
});

ok('the result names the matched traits and the vetoing negatives', () => {
  const rule = traits(['customer-facing', 'word:intern', 'stem:demo', 'proof of concept'], ['no customer interaction']);
  assert.deepStrictEqual(matchContentTraits('A DEMO engineer with customer-facing work', rule), {
    matched: true, matchedTraits: ['customer-facing', 'stem:demo'], negativeMatches: [],
  });
});

ok('" | " alternatives count once toward min_match, however many spellings appear', () => {
  const rule = traits(['customer-facing', 'pre-sales | presales', 'word:demo'], [], 2);
  const synonyms = matchContentTraits('presales and pre-sales', rule);
  assert.deepStrictEqual(synonyms.matchedTraits, ['pre-sales | presales']);
  assert.strictEqual(synonyms.matched, false, 'two spellings of one trait are one trait');
  assert.strictEqual(matchContentTraits('presales demo', rule).matched, true);
});

ok('the separator needs surrounding spaces, so "c|c++" stays one literal', () => {
  const [trait] = compileContentTraits(['c|c++']);
  assert.strictEqual(trait.match(foldContentText('we write c|c++ daily')), true);
  assert.strictEqual(trait.match(foldContentText('we write c++ daily')), false);
});

ok('typographic and soft hyphens fold to "-", accents and case fold like a title', () => {
  const rule = traits(['customer-facing', 'pre-sales | presales', 'résumé'], [], 3);
  // U+2011 non-breaking hyphen, U+00AD soft hyphen, upper case, no accent.
  assert.deepStrictEqual(matchContentTraits('Customer‑facing pre­sales, send a RESUME', rule).matchedTraits,
    ['customer-facing', 'pre-sales | presales', 'résumé']);
  // The en dash is a range or clause separator in JD prose, not a hyphen.
  assert.strictEqual(foldContentText('3–5 years'), '3–5 years');
});

// ── 2. Thresholds and vetoes through buildContentFilter ────────────────
ok('min_match requires that many distinct traits', () => {
  const filter = buildContentFilter({ positive: ['customer-facing', 'demo', 'proof of concept'], min_match: 2 });
  assert.strictEqual(filter('customer-facing role'), false);
  assert.strictEqual(filter('customer-facing role, run the demo'), true);
  assert.strictEqual(filter('customer-facing demo and a proof of concept'), true);
});

ok('a negative trait vetoes whatever the positive count', () => {
  const filter = buildContentFilter({
    positive: ['customer-facing', 'demo'], negative: ['internal tools only | no customer interaction'], min_match: 1,
  });
  assert.strictEqual(filter('customer-facing demo'), true);
  assert.strictEqual(filter('customer-facing demo, internal tools only'), false);
  assert.strictEqual(filter('customer-facing demo, no customer interaction'), false);
});

ok('with min_match, a description that matches no trait is rejected', () => {
  const filter = buildContentFilter({ positive: ['python'], min_match: 1 });
  assert.strictEqual(filter('Go and Rust'), false);
});

ok('with min_match, an empty description still passes for a posting whose title matched', () => {
  // The pass-on-empty rule protects a title MATCH from a provider that returns
  // no description; the title-miss path below is where empty must fail.
  const filter = buildContentFilter({ positive: ['python', 'go'], min_match: 2 });
  for (const empty of ['', '   ', undefined, null, 42]) assert.strictEqual(filter(empty), true, String(empty));
});

ok('a by_title_keyword rule takes its own min_match; the global pair keeps its own', () => {
  const filter = buildContentFilter({
    positive: ['python'],
    by_title_keyword: { 'Solutions Engineer': { positive: ['demo', 'customer-facing', 'pre-sales'], min_match: 2 } },
  });
  assert.strictEqual(filter('demo only', ['Solutions Engineer']), false);
  assert.strictEqual(filter('demo for customer-facing teams', ['Solutions Engineer']), true);
  assert.strictEqual(filter('python', ['Data Engineer']), true, 'no override: global any-one rule');
});

ok('an invalid min_match is refused when the filter is built', () => {
  const cases = [
    [{ positive: ['demo'], min_match: 0 }, /from 1 to 1/],
    [{ positive: ['demo'], min_match: -1 }, /from 1 to 1/],
    [{ positive: ['demo'], min_match: 2 }, /from 1 to 1/],
    [{ positive: ['demo'], min_match: 1.5 }, /from 1 to 1/],
    [{ positive: ['demo'], min_match: '2' }, /from 1 to 1/],
    [{ positive: ['demo'], min_match: null }, /from 1 to 1/],
    [{ positive: ['demo', ' DEMO '], min_match: 2 }, /from 1 to 1/],
    [{ positive: ['a | b'], min_match: 2 }, /from 1 to 1/],
    [{ min_match: 1 }, /needs a non-empty content_filter\.positive/],
    [{ positive: ['x'], by_title_keyword: { AI: { positive: ['gpt'], min_match: 3 } } },
      /content_filter\.by_title_keyword\.AI\.min_match/],
  ];
  for (const [config, message] of cases) {
    assert.throws(() => buildContentFilter(config), message, JSON.stringify(config));
  }
  assert.doesNotThrow(() => buildContentFilter({ positive: ['demo', 'word:demo'], min_match: 2 }),
    'a prefix makes a different trait');
});

ok('a bare word: or stem: is not a trait, so it cannot make min_match unreachable', () => {
  assert.deepStrictEqual(compileContentTraits(['demo', 'word:', ' stem: ', 'WORD:']).map(t => t.original), ['demo']);
  assert.deepStrictEqual(compileContentTraits(['word: | presales']).map(t => t.original), ['word: | presales']);
  assert.strictEqual(matchContentTraits('presales', traits(['word: | presales'])).matched, true);
  assert.throws(() => buildContentFilter({ positive: ['demo', 'word:'], min_match: 2 }), /from 1 to 1/);
  assert.throws(() => buildContentFilter({ positive: ['word:'], rescue_title_misses: true }),
    /rescue_title_misses needs a non-empty content_filter\.positive/);
  // Without min_match or rescue, a bare prefix keeps its any-one meaning: it matches nothing.
  assert.doesNotThrow(() => buildContentFilter({ positive: ['word:'] }));
});

// ── 3. Absent new keys: the default is unchanged ────────────────────────
ok('without min_match, " | " is a literal substring, as before', () => {
  const filter = buildContentFilter({ positive: ['a | b'] });
  assert.strictEqual(filter('pick a | b here'), true);
  assert.strictEqual(filter('pick a here'), false);
});

ok('without min_match, matching is lowercase substring with no accent or hyphen folding', () => {
  const filter = buildContentFilter({ positive: ['résumé', 'customer-facing'] });
  assert.strictEqual(filter('send your RESUME'), false);
  assert.strictEqual(filter('send your RÉSUMÉ'), true);
  assert.strictEqual(filter('customer‑facing'), false);
  assert.strictEqual(filter('customer-facing'), true);
});

ok('without min_match, any one positive keyword passes and duplicates do not matter', () => {
  const filter = buildContentFilter({ positive: ['demo', 'DEMO', 'poc'], negative: ['php'] });
  assert.strictEqual(filter('a demo'), true);
  assert.strictEqual(filter('a demo in php'), false);
  assert.strictEqual(filter(''), true);
  assert.strictEqual(filter.rescueTitleMisses, false);
});

ok('an absent content_filter passes everything, even a title miss asked about', () => {
  const filter = buildContentFilter(undefined);
  assert.strictEqual(filter('anything'), true);
  assert.notStrictEqual(filter.rescueTitleMisses, true);
});

// ── 4. The title-miss rescue at the filter level ────────────────────────
ok('rescue_title_misses is off unless set to true, and must be a boolean', () => {
  assert.strictEqual(buildContentFilter({ positive: ['x'] }).rescueTitleMisses, false);
  assert.strictEqual(buildContentFilter({ positive: ['x'], rescue_title_misses: false }).rescueTitleMisses, false);
  assert.strictEqual(buildContentFilter({ positive: ['x'], rescue_title_misses: true }).rescueTitleMisses, true);
  assert.throws(() => buildContentFilter({ positive: ['x'], rescue_title_misses: 'yes' }), /true or false/);
  assert.throws(() => buildContentFilter({ rescue_title_misses: true }), /non-empty content_filter\.positive/);
  assert.throws(() => buildContentFilter({ negative: ['php'], rescue_title_misses: true }), /non-empty/);
});

ok('a title miss passes only on its description: empty fails, min_match and vetoes apply', () => {
  const filter = buildContentFilter({
    positive: ['customer-facing', 'demo', 'proof of concept'], negative: ['security clearance'],
    min_match: 2, rescue_title_misses: true,
  });
  const miss = (d) => filter(d, [], { titleMissed: true });
  for (const empty of ['', '   ', undefined, null]) assert.strictEqual(miss(empty), false, String(empty));
  assert.strictEqual(miss('customer-facing'), false);
  assert.strictEqual(miss('customer-facing demo'), true);
  assert.strictEqual(miss('customer-facing demo, security clearance required'), false);
});

ok('a title miss is judged by the global pair only, never by a by_title_keyword rule', () => {
  const filter = buildContentFilter({
    positive: ['demo'], rescue_title_misses: true,
    by_title_keyword: { Engineer: { positive: [] } },
  });
  // The Engineer rule has no positive list, so a title MATCH passes on anything;
  // a title miss matched no title keyword and still needs the global "demo".
  assert.strictEqual(filter('nothing relevant', ['Engineer']), true);
  assert.strictEqual(filter('nothing relevant', ['Engineer'], { titleMissed: true }), false);
  assert.strictEqual(filter('a demo', ['Engineer'], { titleMissed: true }), true);
});

ok('without the opt-in, a caller asking about a title miss gets a rejection', () => {
  const filter = buildContentFilter({ positive: ['demo'] });
  assert.strictEqual(filter('a demo', [], { titleMissed: true }), false);
});

ok('scan-ats-full picks up trait matching through the same buildContentFilter', () => {
  const titleFilterConfig = { positive: ['Engineer'] };
  const deps = {
    titleFilter: buildTitleFilter(titleFilterConfig), locationFilter: buildLocationFilter(undefined),
    contentFilter: buildContentFilter({ positive: ['demo', 'customer-facing'], min_match: 2 }), titleFilterConfig,
  };
  assert.strictEqual(passesFilters({ title: 'Solutions Engineer', location: '', description: 'a demo' }, deps), false);
  assert.strictEqual(passesFilters({ title: 'Solutions Engineer', location: '', description: 'customer-facing demo' }, deps), true);
  assert.deepStrictEqual(matchedTitleKeywords('Solutions Engineer', titleFilterConfig), ['Engineer']);
});

// ── 5. The real scan.mjs ────────────────────────────────────────────────
/** Run scan.mjs over one builtin board whose fetch returns `jobs`. */
function scan(contentFilterYaml, jobs, { titleFilterYaml = ['title_filter:', '  positive: [Solutions Engineer]'], args = [], profileYaml = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'content-filter-traits-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, [
      ...titleFilterYaml,
      ...contentFilterYaml,
      'job_boards:',
      '  - name: Built In',
      '    provider: builtin',
      '    builtin:',
      '      queries: ["engineer"]',
      '    enabled: true',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify(jobs));
    // An explicit profile, so the caller's own CAREER_OPS_PROFILE never leaks in.
    const profile = join(dir, 'profile.yml');
    writeFileSync(profile, profileYaml);
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, [
      "import { readFileSync } from 'node:fs';",
      `import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'builtin.mjs')).href)};`,
      "const jobs = JSON.parse(readFileSync(new URL('./jobs.json', import.meta.url), 'utf-8'));",
      'provider.fetch = async () => jobs;',
      "globalThis.fetch = async () => { throw new Error('Unexpected network request'); };",
      '',
    ].join('\n'));
    const r = spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan.mjs'), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...cleanEnv(), CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: portals, CAREER_OPS_PROFILE: profile,
        // Empty, so a caller's own pipeline lane or history file is never written to.
        CAREER_OPS_PIPELINE: '', CAREER_OPS_SCAN_HISTORY: '' },
    });
    const read = (name) => (existsSync(join(dir, 'data', name)) ? readFileSync(join(dir, 'data', name), 'utf-8') : '');
    const urls = read('pipeline.md').split('\n').map(l => l.match(/^- \[[ x]\]\s+(https?:\/\/\S+)/)?.[1]).filter(Boolean);
    const history = read('scan-history.tsv').split('\n').slice(1).filter(Boolean).map(l => l.split('\t'))
      .map(cols => ({ url: cols[0], status: cols[5] }));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, urls, history };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const job = (n, title, description, company = 'Acme') => ({
  title, url: `https://builtin.com/job/role/${n}`, company, location: 'Remote', description,
});
const RESCUE = [
  'content_filter:',
  '  positive: ["customer-facing", "pre-sales | presales", "demo"]',
  '  negative: ["security clearance"]',
  '  min_match: 2',
  '  rescue_title_misses: true',
];

ok('scan: a title miss with enough traits is kept; one without them is booked as a title miss', () => {
  const jobs = [
    job(1, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.'),
    job(2, 'Platform Engineer', 'Kubernetes and Terraform, plus one demo a year.'),
    job(3, 'Customer Engineer', ''),
    job(4, 'Field Engineer', 'Customer-facing demo work. Security clearance required.'),
  ];
  const r = scan(RESCUE, jobs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, [jobs[0].url]);
  assert.match(r.stdout, /Filtered by title:\s+3 removed/);
  assert.match(r.stdout, /Filtered by content:\s+0 removed/);
  assert.match(r.stdout, /Title misses kept by content: 1\b/);
  const skipped = r.history.filter(h => h.status === 'skipped_title').map(h => h.url).sort();
  assert.deepStrictEqual(skipped, [jobs[1].url, jobs[2].url, jobs[3].url].sort());
  assert.ok(r.history.some(h => h.url === jobs[0].url && h.status === 'added'), JSON.stringify(r.history));
});

ok('scan: a title match is still judged by min_match and booked as a content rejection', () => {
  const jobs = [
    job(1, 'Solutions Engineer', 'One demo.'),
    job(2, 'Solutions Engineer II', 'Customer-facing demo work.'),
  ];
  const r = scan(RESCUE, jobs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, [jobs[1].url]);
  assert.match(r.stdout, /Filtered by title:\s+0 removed/);
  assert.match(r.stdout, /Filtered by content:\s+1 removed/);
  assert.match(r.stdout, /Title misses kept by content: 0\b/);
  assert.ok(!r.history.some(h => h.url === jobs[0].url), 'a content rejection writes no history row');
});

ok('scan: a title_filter.negative hit is never rescued', () => {
  const jobs = [job(1, 'Pre-sales Intern', 'Customer-facing presales demo.')];
  const r = scan(RESCUE, jobs, { titleFilterYaml: ['title_filter:', '  positive: [Solutions Engineer]', '  negative: [Intern]'] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, []);
  assert.match(r.stdout, /Filtered by title:\s+1 removed/);
  assert.match(r.stdout, /Title misses kept by content: 0\b/);
});

ok('scan: a trait miss reserves no identity, so a later matching posting of the same role is added', () => {
  const jobs = [
    job(1, 'Customer Engineer', 'Nothing relevant here.'),
    job(2, 'Customer Engineer', 'Customer-facing pre-sales role.'),
  ];
  const r = scan(RESCUE, jobs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, [jobs[1].url]);
  assert.match(r.stdout, /Duplicates:\s+0\b/);
});

ok('scan: without rescue_title_misses the output carries no rescue line and title misses stay dropped', () => {
  const jobs = [job(1, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.')];
  const r = scan(['content_filter:', '  positive: ["customer-facing", "demo"]', '  min_match: 2'], jobs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, []);
  assert.match(r.stdout, /Filtered by title:\s+1 removed/);
  assert.doesNotMatch(r.stdout, /Title misses kept by content/);
});

ok('scan: an unusable content_filter stops the run before any fetch', () => {
  const r = scan(['content_filter:', '  positive: ["demo"]', '  min_match: 3'], [job(1, 'Solutions Engineer', 'demo')]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stderr, /content_filter\.min_match must be an integer from 1 to 1/);
  assert.deepStrictEqual(r.urls, []);
});

ok('scan: a rescued posting still goes through the re-apply cooldown', () => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const jobs = [job(1, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.')];
  const r = scan(RESCUE, jobs, { profileYaml: [
    're_apply_windows:',
    '  Acme:',
    `    last_apply_date: "${iso}"`,
    '    same_role_days: 90',
    '    applied_to: ["Forward Deployed Engineer"]',
    '',
  ].join('\n') });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, []);
  assert.match(r.stdout, /Title misses kept by content: 1\b/);
  assert.match(r.stdout, /Filtered by cooldown:\s+1 removed/);
});

ok('scan: a rescued posting already seen in the same run is a duplicate, not a second offer', () => {
  const jobs = [
    job(1, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.'),
    job(1, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.'),
  ];
  const r = scan(RESCUE, jobs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.urls, [jobs[0].url]);
  assert.match(r.stdout, /Duplicates:\s+1\b/);
});

// ── 5b. The shared title decision, and the other two scanners ──────────
ok('buildTitleGate: match, rescue and reject follow title_filter and rescue_title_misses', () => {
  const titleConfig = { positive: ['Solutions Engineer'], negative: ['Intern'] };
  const on = buildTitleGate(titleConfig, buildContentFilter({ positive: ['demo'], rescue_title_misses: true }));
  assert.strictEqual(on('Solutions Engineer'), 'match');
  assert.strictEqual(on('Forward Deployed Engineer'), 'rescue');
  assert.strictEqual(on('Pre-sales Intern'), 'reject');
  const off = buildTitleGate(titleConfig, buildContentFilter({ positive: ['demo'] }));
  assert.strictEqual(off('Solutions Engineer'), 'match');
  assert.strictEqual(off('Forward Deployed Engineer'), 'reject');
  assert.strictEqual(buildTitleGate(titleConfig, () => true)('Forward Deployed Engineer'), 'reject');
});

/** A stub Dayforce page whose list API returns `rows`; detail fetches are recorded. */
function dayforcePage(rows, detailIds) {
  const response = (json) => ({ ok: () => true, status: () => 200, json: async () => json });
  return {
    goto: async () => {},
    url: () => 'https://jobs.dayforcehcm.com/en-US/tenant/CANDIDATEPORTAL',
    title: async () => 'Careers',
    locator: () => ({ count: async () => 0 }),
    request: {
      post: async () => response({ jobPostings: rows, offset: 0, count: rows.length, maxCount: rows.length }),
      get: async (url) => {
        if (String(url).endsWith('/api/auth/csrf')) return response({ csrfToken: 'token' });
        detailIds.push(String(url).split('/').at(-1));
        return response({ jobTitle: 'x', jobPostingContent: { jobDescription: 'full detail' } });
      },
    },
  };
}
const DAYFORCE_BOARD = { name: 'Acme', tenant: 'tenant', board: 'CANDIDATEPORTAL', culture: 'en-US', jobBoardId: '1' };

function dayforceFilters(contentFilterConfig) {
  const titleConfig = { positive: ['Solutions Engineer'], negative: ['Intern'] };
  const titleFilter = buildTitleFilter(titleConfig);
  const contentFilter = buildContentFilter(contentFilterConfig);
  return {
    titleFilter,
    titleGate: buildTitleGate(titleConfig, contentFilter, titleFilter),
    contentFilter,
    matchedTitleKeywords: (title) => matchedTitleKeywords(title, titleConfig),
  };
}

await okAsync('scan-dayforce: a title miss is kept on its list description, and a failed rescue is a title skip', async () => {
  const row = (id, jobTitle, jobDescription) => ({ jobPostingId: id, jobTitle, jobDescription, postingLocations: [] });
  const rows = [
    row(1, 'Solutions Engineer', 'Customer-facing demo work.'),
    row(2, 'Forward Deployed Engineer', 'Customer-facing presales work with a live demo.'),
    row(3, 'Platform Engineer', 'Kubernetes, plus one demo a year.'),
    row(4, 'Pre-sales Intern', 'Customer-facing presales demo.'),
    row(5, 'Customer Engineer', ''),
    row(6, 'Solutions Engineer II', 'One demo.'),
  ];
  const detailIds = [];
  const result = await scanBoard(dayforcePage(rows, detailIds), DAYFORCE_BOARD, dayforceFilters({
    positive: ['customer-facing', 'pre-sales | presales', 'demo'], min_match: 2, rescue_title_misses: true,
  }));
  assert.deepStrictEqual(detailIds, ['1', '2']);
  assert.deepStrictEqual(result.titleSkipped.map(s => s.title), ['Platform Engineer', 'Pre-sales Intern', 'Customer Engineer']);
  assert.deepStrictEqual(result.contentSkipped.map(s => s.title), ['Solutions Engineer II']);
});

await okAsync('scan-dayforce: without rescue_title_misses, or without a titleGate, title misses stay skipped', async () => {
  const rows = [{ jobPostingId: 1, jobTitle: 'Forward Deployed Engineer', jobDescription: 'Customer-facing demo.', postingLocations: [] }];
  for (const filters of [
    dayforceFilters({ positive: ['customer-facing', 'demo'], min_match: 2 }),
    { ...dayforceFilters({ positive: ['customer-facing', 'demo'], min_match: 2, rescue_title_misses: true }), titleGate: undefined },
  ]) {
    const detailIds = [];
    const result = await scanBoard(dayforcePage(rows, detailIds), DAYFORCE_BOARD, filters);
    assert.deepStrictEqual(detailIds, []);
    assert.strictEqual(result.titleSkipped.length, 1);
  }
});

ok('scan-ats-full: rescue_title_misses is named as ignored, never dropped silently', () => {
  const warnings = [];
  warnRescueTitleMissesIgnored(buildContentFilter({ positive: ['demo'], rescue_title_misses: true }), (m) => warnings.push(m));
  warnRescueTitleMissesIgnored(buildContentFilter({ positive: ['demo'] }), (m) => warnings.push(m));
  warnRescueTitleMissesIgnored(buildContentFilter(undefined), (m) => warnings.push(m));
  assert.deepStrictEqual(warnings, [RESCUE_TITLE_MISSES_IGNORED_WARNING]);
  assert.match(RESCUE_TITLE_MISSES_IGNORED_WARNING, /ignored by scan-ats-full\.mjs/);
});

/** Run `script` against a portals.yml holding only `lines`; no network is reachable. */
function runWithPortals(script, lines, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'content-filter-exit-'));
  try {
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, [...lines, ''].join('\n'));
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('Unexpected network request'); };\n");
    return spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, script), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...cleanEnv(), CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: portals, CAREER_OPS_PROFILE: join(dir, 'profile.yml') },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const script of ['scan-dayforce.mjs', 'scan-ats-full.mjs']) {
  ok(`${script}: an unusable content_filter exits 1 with the same error as scan.mjs`, () => {
    const r = runWithPortals(script, ['title_filter:', '  positive: [Engineer]', 'content_filter:', '  positive: ["demo"]', '  min_match: 3'], ['--dry-run']);
    assert.strictEqual(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^Error: content_filter\.min_match must be an integer from 1 to 1/m);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  });
}

// ── 6. validate-portals reports the same shapes scan.mjs refuses ────────
await okAsync('validate-portals: min_match and rescue_title_misses errors match scan.mjs', async () => {
  const errorsFor = async (contentFilter) => (await validatePortalsConfig({
    title_filter: { positive: ['Engineer'] }, content_filter: contentFilter,
  })).errors.map(e => `${e.path}: ${e.message}`);
  assert.deepStrictEqual(await errorsFor({ positive: ['demo', 'pre-sales | presales'], min_match: 2, rescue_title_misses: true }), []);
  assert.deepStrictEqual(await errorsFor({ positive: ['demo', 'DEMO'], min_match: 2 }),
    ['content_filter.min_match: must be an integer from 1 to 1 (the number of distinct content_filter.positive entries)']);
  assert.deepStrictEqual(await errorsFor({ min_match: 1 }), ['content_filter.min_match: needs a non-empty content_filter.positive list']);
  assert.deepStrictEqual(await errorsFor({ positive: ['x'], rescue_title_misses: 'yes' }),
    ['content_filter.rescue_title_misses: must be a boolean when set']);
  assert.match((await errorsFor({ negative: ['php'], rescue_title_misses: true }))[0], /^content_filter\.rescue_title_misses: needs a non-empty/);
  assert.deepStrictEqual(await errorsFor({ by_title_keyword: { Engineer: { positive: ['gpt'], min_match: 2 } } }),
    ['content_filter.by_title_keyword.Engineer.min_match: must be an integer from 1 to 1 (the number of distinct content_filter.by_title_keyword.Engineer.positive entries)']);
  // Every shape validate-portals rejects, buildContentFilter rejects too.
  for (const shape of [{ positive: ['demo', 'DEMO'], min_match: 2 }, { min_match: 1 },
    { positive: ['x'], rescue_title_misses: 'yes' }, { negative: ['php'], rescue_title_misses: true },
    { positive: ['demo', 'word:'], min_match: 2 }, { positive: ['word:'], rescue_title_misses: true }]) {
    assert.notDeepStrictEqual(await errorsFor(shape), [], JSON.stringify(shape));
    assert.throws(() => buildContentFilter(shape), JSON.stringify(shape));
  }
});
