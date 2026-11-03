// tests/verify-portals-unmined.test.mjs — the search_queries coverage hole.
//
// A search_queries entry only yields links for a human to open; it never feeds
// the scanner. Groq and Cerebras lived in one for months with live ATS boards,
// and nothing reported it because both the entry and the scan looked fine.
//
// Network-free: findUnmined takes an injected fetchJson, so the probe matrix is
// exercised without touching the rate-limited ATS directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHintStopwords,
  companyFromHost,
  companyHintsFromQuery,
  unminedHints,
  findUnmined,
  runUnmined,
} from '../verify-portals.mjs';

const CFG = {
  title_filter: {
    positive: ['AI Engineer', 'Machine Learning', 'Design Verification', 'RTL', 'Inference', 'Physical Design'],
    negative: ['Sales'],
  },
  location_filter: { allow: ['San Jose', 'Sunnyvale'] },
  tracked_companies: [{ name: 'Cadence' }, { name: 'd-Matrix' }],
  search_queries: [],
};
const SW = buildHintStopwords(CFG);

// ── host → company ───────────────────────────────────────────────────────────

test('a careers subdomain is stripped to the company', () => {
  assert.equal(companyFromHost('careers.amd.com'), 'amd');
  assert.equal(companyFromHost('jobs.apple.com'), 'apple');
  assert.equal(companyFromHost('www.tesla.com'), 'tesla');
});

test('a path after the host is ignored', () => {
  assert.equal(companyFromHost('google.com/about/careers'), 'google');
  assert.equal(companyFromHost('tesla.com/careers'), 'tesla');
});

test('a non-.com TLD is still a TLD', () => {
  assert.equal(companyFromHost('cerebras.ai'), 'cerebras');
  assert.equal(companyFromHost('together.ai'), 'together');
  assert.equal(companyFromHost('breezy.hr'), null, 'known aggregator');
});

test('multi-label public suffixes drop both labels', () => {
  assert.equal(companyFromHost('www.example.co.uk'), 'example');
});

test('aggregator hosts name no company', () => {
  // site:jobs.ashbyhq.com is a cross-company search — promoting "ashbyhq" to
  // tracked_companies would be nonsense.
  assert.equal(companyFromHost('job-boards.greenhouse.io'), null);
  assert.equal(companyFromHost('jobs.ashbyhq.com'), null);
  assert.equal(companyFromHost('jobs.lever.co'), null);
  // "recruiting" is dropped as a careers subdomain, so without the aggregator
  // entry this host would read as a company called "paylocity".
  assert.equal(companyFromHost('recruiting.paylocity.com'), null);
  assert.equal(companyFromHost('join.com'), null);
});

test('a bare word is not a host', () => {
  assert.equal(companyFromHost('groq'), null);
  assert.equal(companyFromHost(''), null);
});

// ── query → company hints ────────────────────────────────────────────────────

test('site: hosts become hints', () => {
  const q = 'site:careers.amd.com ("RTL" OR "Machine Learning") "San Jose"';
  assert.deepEqual(companyHintsFromQuery(q, SW), ['amd']);
});

test('quoted proper nouns become hints', () => {
  const q = '("ChipAgents" OR "Silimate" OR "Astrus") careers ("engineer" OR "research")';
  assert.deepEqual(companyHintsFromQuery(q, SW), ['chipagents', 'silimate', 'astrus']);
});

test('a quoted fragment of a filter keyword is vocabulary, not a company', () => {
  // The bug this rule exists for: "Verification" and "AI" are quoted in real
  // queries but appear only INSIDE keywords ("Design Verification", "AI
  // Engineer"), so whole-phrase matching let both through as company names.
  const q = 'site:tesla.com/careers ("RTL" OR "Verification" OR "AI")';
  assert.deepEqual(companyHintsFromQuery(q, SW), ['tesla']);
});

test('a partial overlap with filter vocabulary survives', () => {
  // "Physical Intelligence" is a real lab. "physical" is in the filter via
  // "Physical Design"; "intelligence" is the company's own word, so it stays.
  assert.deepEqual(companyHintsFromQuery('("Physical Intelligence") careers', SW), ['physical intelligence']);
});

test('lowercase and sentence-length quotes are search language', () => {
  const q = '("will sponsor" OR "we are hiring engineers across the stack")';
  assert.deepEqual(companyHintsFromQuery(q, SW), []);
});

test('locations from the user config are not companies', () => {
  assert.deepEqual(companyHintsFromQuery('("San Jose" OR "Sunnyvale")', SW), []);
});

// ── config → unmined set ─────────────────────────────────────────────────────

test('already-tracked companies are not findings', () => {
  const cfg = {
    ...CFG,
    search_queries: [{ name: 'EDA', query: '("Synopsys" OR "Cadence") jobs', enabled: true }],
  };
  assert.deepEqual(unminedHints(cfg).map((h) => h.hint), ['synopsys'], 'Cadence is tracked');
});

test('tracked matching tolerates punctuation differences', () => {
  const cfg = { ...CFG, search_queries: [{ name: 'x', query: '("d-Matrix" OR "Etched")' }] };
  assert.deepEqual(unminedHints(cfg).map((h) => h.hint), ['etched'], 'd-Matrix already tracked');
});

test('a disabled search entry is not mined', () => {
  const cfg = { ...CFG, search_queries: [{ name: 'off', query: '("Silimate")', enabled: false }] };
  assert.deepEqual(unminedHints(cfg), []);
});

test('one company named by two entries reports both sources', () => {
  const cfg = {
    ...CFG,
    search_queries: [
      { name: 'B entry', query: 'site:groq.com/careers "RTL"' },
      { name: 'A entry', query: '("Groq")' },
    ],
  };
  const [only] = unminedHints(cfg);
  assert.equal(only.hint, 'groq');
  assert.deepEqual(only.sources, ['A entry', 'B entry'], 'sorted, deduped');
});

test('missing sections are not a crash', () => {
  assert.deepEqual(unminedHints({}), []);
  assert.deepEqual(unminedHints(null), []);
});

// ── probing ──────────────────────────────────────────────────────────────────

/** Resolve only the exact urls given; everything else 404s like a bad slug. */
function fakeFetch(liveUrlSubstrings) {
  return async (url) => {
    const hit = liveUrlSubstrings.find((s) => url.includes(s));
    if (!hit) { const e = new Error('404'); e.status = 404; throw e; }
    if (url.includes('ashby')) return { jobs: [{ title: 'x' }, { title: 'y' }] };
    return { jobs: [{ title: 'x' }, { title: 'y' }] };
  };
}

test('a company with a live board is reported with its slug', async () => {
  const cfg = { ...CFG, search_queries: [{ name: 'silicon', query: 'site:cerebras.ai "RTL"' }] };
  const [r] = await findUnmined(cfg, { fetchJson: fakeFetch(['/cerebras']) });
  assert.equal(r.hint, 'cerebras');
  assert.equal(r.hit.slug, 'cerebras');
  assert.equal(r.hit.status, 'live');
});

test('a derived slug variant is found when the bare name is not', async () => {
  // together.ai's board is 'togetherai', not 'together' — the miss that makes
  // probing the bare host label alone insufficient.
  const cfg = { ...CFG, search_queries: [{ name: 'infra', query: 'site:together.ai "Inference"' }] };
  const [r] = await findUnmined(cfg, { fetchJson: fakeFetch(['/togetherai']) });
  assert.equal(r.hit.slug, 'togetherai');
});

test('a live-but-empty board still counts as mineable', async () => {
  // Groq's real state: board reachable, zero openings. Tracking it now means
  // the first posting is caught automatically instead of by someone noticing.
  const cfg = { ...CFG, search_queries: [{ name: 'silicon', query: 'site:groq.com/careers "RTL"' }] };
  const fetchJson = async (url) => {
    if (!url.includes('/groq')) { const e = new Error('404'); e.status = 404; throw e; }
    return { jobs: [] };
  };
  const [r] = await findUnmined(cfg, { fetchJson });
  assert.equal(r.hit.status, 'empty');
});

test('a name with no board anywhere reports no hit', async () => {
  const cfg = { ...CFG, search_queries: [{ name: 'big', query: 'site:google.com/about/careers "ASIC"' }] };
  const [r] = await findUnmined(cfg, { fetchJson: fakeFetch([]) });
  assert.equal(r.hit, null, 'websearch really is the right tool for this one');
});

test('probing stops at the first hit for a company', async () => {
  // The ATS directories rate-limit hard; exhausting every variant of every hint
  // would poison the run for the companies probed after it.
  let calls = 0;
  const cfg = { ...CFG, search_queries: [{ name: 'x', query: 'site:cerebras.ai "RTL"' }] };
  const fetchJson = async (url) => {
    calls++;
    if (!url.includes('/cerebras')) { const e = new Error('404'); e.status = 404; throw e; }
    return { jobs: [{ title: 'x' }] };
  };
  await findUnmined(cfg, { fetchJson });
  assert.ok(calls <= 3, `stopped early, took ${calls} probes for a first-candidate hit`);
});

test('a tracked name spelled without the space still counts as tracked', () => {
  // CodeRabbit on #2730: the raw hint "scale nova" matched neither the tracked
  // name "scalenova" nor its slug shapes, so a tracked company was reported as
  // unmined and `--strict --unmined` failed for nothing.
  const query = '"Scale Nova" OR Cerebras';
  for (const name of ['ScaleNova', 'Scale-Nova', 'Scale Nova']) {
    const cfg = { ...CFG, tracked_companies: [{ name }], search_queries: [{ name: 'q', query }] };
    assert.ok(!unminedHints(cfg).some((h) => h.hint === 'scale nova'), `tracked as "${name}"`);
  }
});

test('a tracked first word does not hide a different company', () => {
  // Matching on every slug candidate would include the first word, so a
  // tracked "Scale" would swallow an untracked "Scale Nova".
  const cfg = { ...CFG, tracked_companies: [{ name: 'Scale' }], search_queries: [{ name: 'q', query: '"Scale Nova"' }] };
  assert.deepEqual(unminedHints(cfg).map((h) => h.hint), ['scale nova']);
});

test('the CLI accepts --unmined and no-ops without a portals file', () => {
  // main() validates flags before any network work; --unmined has to be a
  // known flag or the command exits 1 before it starts.
  const dir = mkdtempSync(join(tmpdir(), 'unmined-cli-'));
  try {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'verify-portals.mjs');
    const out = execFileSync(process.execPath, [script, '--unmined', '--file', join(dir, 'absent.yml')], {
      encoding: 'utf-8', timeout: 20000,
    });
    assert.match(out, /no portals file at .*nothing to check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an EU-only Lever board is found', async () => {
  // Lever is one ATS key with an eu flag; probing only api.lever.co reported an
  // EU-only tenant as having no Lever board (CodeRabbit, #2730).
  const cfg = { ...CFG, search_queries: [{ name: 'x', query: 'site:cerebras.ai "RTL"' }] };
  const fetchJson = async (url) => {
    if (url.startsWith('https://api.eu.lever.co/v0/postings/cerebras')) return [{ text: 'x' }];
    const e = new Error('404'); e.status = 404; throw e;
  };
  const [r] = await findUnmined(cfg, { fetchJson });
  assert.equal(r.hit?.ats, 'lever');
  assert.equal(r.hit?.eu, true);
  assert.equal(r.probeError, null);
});

test('a probe that failed for another reason than 404 is unverified, not "no board"', async () => {
  const cfg = { ...CFG, search_queries: [{ name: 'x', query: 'site:cerebras.ai "RTL"' }] };
  const fetchJson = async (url) => {
    const e = new Error(url.includes('ashbyhq') ? 'HTTP 429' : '404');
    e.status = url.includes('ashbyhq') ? 429 : 404;
    throw e;
  };
  const [r] = await findUnmined(cfg, { fetchJson });
  assert.equal(r.hit, null);
  assert.equal(r.probeError?.ats, 'ashby');
  assert.equal(r.probeError?.httpStatus, 429);
});

test('every candidate 404ing is still a plain "no board"', async () => {
  const cfg = { ...CFG, search_queries: [{ name: 'x', query: 'site:cerebras.ai "RTL"' }] };
  const [r] = await findUnmined(cfg, { fetchJson: fakeFetch([]) });
  assert.equal(r.hit, null);
  assert.equal(r.probeError, null);
});

test('runUnmined counts unverified names for --strict and says so', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unmined-run-'));
  const logged = [];
  const log = console.log;
  try {
    const file = join(dir, 'portals.yml');
    writeFileSync(file, 'search_queries:\n  - name: x\n    query: \'site:cerebras.ai OR site:baseten.co\'\n');
    const fetchJson = async (url) => {
      const e = new Error('x');
      e.status = url.includes('/cerebras') ? 503 : 404;
      throw e;
    };
    console.log = (...a) => logged.push(a.join(' '));
    const n = await runUnmined(file, { fetchJson });
    console.log = log;
    const out = logged.join('\n');
    assert.equal(n, 1, 'one unverified name fails --strict');
    assert.match(out, /cerebras — could not verify \(.*HTTP 503\)/);
    assert.match(out, /baseten — no greenhouse\/ashby\/lever board/);
    assert.doesNotMatch(out, /earning their keep/);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runUnmined can be called without options', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unmined-noopts-'));
  const log = console.log;
  try {
    console.log = () => {};
    assert.equal(await runUnmined(join(dir, 'absent.yml')), 0);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
