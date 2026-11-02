// tests/tracker-writers-seeded-roundtrip.test.mjs — seeded invariants for the
// tracker writers (merge-tracker.mjs, set-status.mjs).
//
// Every other tracker suite pins one hand-picked example: the row that once
// went missing, the URL spelling that once forked a row. Those stay the
// precise record of each fix. This suite asks the question they cannot: does a
// tracker built from many shapes at once still keep the documented contract?
// A deterministic generator (mulberry32 over fixed seeds, so a failure always
// reproduces) builds a scrambled tracker plus a mixed batch of additions, and
// the suite checks the invariants AGENTS.md states for the writers:
//
//   - no row is lost or duplicated: final rows = seeded rows + new postings
//   - `#` stays unique and the table is sorted ascending, sentinel `#` last
//     (#3515)
//   - free-text fields round-trip through cell(), the one table sanitizer
//   - the posting URL's dedup key survives link rendering (#3516), headed and
//     headerless TSVs, permuted header order (#3517), and a URL derived from
//     the linked report when the TSV carries none
//   - a re-evaluation under another spelling of the same URL updates its row
//     instead of adding one, and keeps the row's status
//   - rows the batch does not touch keep every byte
//   - merged TSVs are archived; a second merge with nothing pending writes
//     identical bytes; replaying the whole batch adds no rows
//   - set-status changes only the Status (and Notes) cell of the selected row,
//     and repeating the same command is a byte-identical no-op
//
// Hermetic: every tracker, report and lock lives under a mkdtemp directory.
// merge-tracker runs in-process through its exported mergeTracker(); the
// set-status cases spawn the real CLI with CAREER_OPS_TRACKER pointing at the
// sandbox, as tests/set-status.test.mjs does.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeTracker } from '../merge-tracker.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { cell } from '../tracker-utils.mjs';

console.log('\ntracker writers — seeded round-trip invariants');

const SEEDS = [1, 7, 42, 1337, 20261020];
const quiet = { log() {}, warn() {}, error() {}, info() {} };

/** mulberry32: a tiny deterministic PRNG, so every case replays from its seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];
  const chance = (p) => next() < p;
  const shuffle = (arr) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { int, pick, chance, shuffle };
}

// Obviously fictional vocabulary. Each company's first word is unique within a
// run, so no two generated employers can meet in the exact or corporate-form
// company tiers and every dedup decision is made by the posting URL.
const SYLLABLES = ['ka', 'zo', 'vex', 'lum', 'tri', 'nor', 'qua', 'bel', 'dra', 'fen', 'mio', 'rux', 'sol', 'tep', 'yar', 'wix'];
const COMPANY_TAILS = ['', '', '', ' Labs', ' Inc.', ' GmbH', ' & Sons'];
const ROLES = ['Data Engineer', 'Platform Engineer', 'Product Manager', 'ML Engineer', 'Solutions Architect', 'Staff Backend Engineer'];
const NOTES = ['remote ok', 'referral from meetup', 'salary band unclear', 'needs a pipe | check', 'ends with a period.', 'fixture note', ''];
const SEED_STATUSES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Rejected', 'SKIP'];
// Targets for set-status that start no side job (Interview triggers a JD
// archive, Applied seeds a follow-up), from rows that are not terminal.
const SET_STATUS_FROM = new Set(['Evaluated', 'Applied', 'Responded']);
const SET_STATUS_TO = ['Responded', 'Assessment', 'Rejected', 'Discarded', 'SKIP'];

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|-----|',
];

/** One posting identity: a canonical URL plus spellings that share its key. */
function makePosting(rng, slug, id) {
  const shapes = [
    () => `https://boards.greenhouse.io/${slug}/jobs/${id}`,
    () => `https://jobs.ashbyhq.com/${slug}/${id}-aaaa-bbbb`,
    () => `https://jobs.lever.co/${slug}/${id}`,
    () => `https://careers.${slug}.example/jobs/${id}`,
    // Documented edge shapes (#3516): a space is written as %20 inside a link,
    // and parentheses must still read back to the same key.
    () => `https://careers.${slug}.example/jobs/${id}/senior role`,
    () => `https://careers.${slug}.example/jobs/${id}/eng-(remote)`,
  ];
  const url = rng.pick(shapes)();
  return { url, key: normalizeUrl(url) };
}

/** Another spelling of the same posting: same normalized key, different text. */
function respell(rng, url) {
  const u = new URL(url);
  const variants = [
    () => { u.searchParams.set('utm_source', 'feed'); return u.toString(); },
    () => { u.searchParams.set('gh_src', 'abc123'); return u.toString(); },
    () => `${url}/`,
    () => url.replace(/^https:/, 'http:'),
    () => url.replace(u.host, u.host.toUpperCase()),
  ];
  return rng.pick(variants)();
}

function score(rng) {
  return `${rng.int(10, 50) / 10}`.replace(/^(\d)$/, '$1.0') + '/5';
}

function date(rng) {
  return `2026-${String(rng.int(1, 9)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
}

/** Build one seeded scenario: the starting tracker rows and a batch of additions. */
function buildScenario(seed) {
  const rng = makeRng(seed);
  const usedFirstWords = new Set();
  const companyName = () => {
    for (;;) {
      const word = rng.pick(SYLLABLES) + rng.pick(SYLLABLES) + rng.pick(SYLLABLES);
      const first = word[0].toUpperCase() + word.slice(1);
      if (usedFirstWords.has(first)) continue;
      usedFirstWords.add(first);
      return first + rng.pick(COMPANY_TAILS);
    }
  };
  let nextId = 100000 + seed % 1000;
  const freshId = () => ++nextId;

  // Seeded tracker rows, numbered sparsely so additions can fill gaps.
  const seedCount = rng.int(5, 9);
  const nums = rng.shuffle(Array.from({ length: 40 }, (_, i) => i + 1)).slice(0, seedCount);
  const rows = nums.map((num) => {
    const company = companyName();
    const slug = company.split(' ')[0].toLowerCase();
    const posting = makePosting(rng, slug, freshId());
    const d = date(rng);
    return {
      num, date: d, company, role: rng.pick(ROLES), score: score(rng),
      status: rng.pick(SEED_STATUSES), pdf: '❌',
      reportFile: `${num}-${slug}-${d}.md`, notes: cell(rng.pick(NOTES)) || 'seeded row',
      url: posting.url, key: posting.key,
    };
  });
  const sentinelLines = [
    '| N/A | 2026-01-05 | Backfill Example One | Engineer | N/A | Applied | ❌ | — | backfilled, no evaluation | — |',
    '| — | 2026-01-06 | Backfill Example Two | Engineer | — | Rejected | ❌ | — | backfilled, no evaluation | — |',
  ];
  const trackerLines = rng.shuffle([...rows.map(seedLineOf), ...sentinelLines.slice(0, rng.int(0, 2))]);

  const usedNums = new Set(nums);
  let reportNum = 200;
  const additions = [];
  const addAddition = (a) => { additions.push(a); return a; };

  // Brand-new postings.
  const newCount = rng.int(4, 8);
  for (let i = 0; i < newCount; i++) {
    let num;
    do { num = rng.int(1, 60); } while (usedNums.has(num));
    usedNums.add(num);
    const company = companyName();
    const slug = company.split(' ')[0].toLowerCase();
    const posting = makePosting(rng, slug, freshId());
    // Known gap, kept out of this suite rather than asserted: a report's
    // `**URL:**` token loses a trailing `)` to unwrapReportUrlToken()'s
    // punctuation strip even when it closes a `(` inside the URL, so such a
    // URL is only carried in the TSV here.
    const urlVia = posting.url.endsWith(')') ? 'tsv' : rng.pick(['tsv', 'tsv', 'report']);
    addAddition({
      kind: 'new', num, report: num, date: date(rng), company, role: rng.pick(ROLES),
      score: score(rng), status: rng.pick(['Evaluated', 'Applied', 'SKIP']), notes: rng.pick(NOTES),
      url: posting.url, key: posting.key, urlVia,
    });
  }

  // A new posting whose reserved number collides with a seeded row: it must be
  // renumbered, never merged into the unrelated row.
  if (rng.chance(0.6)) {
    const company = companyName();
    const slug = company.split(' ')[0].toLowerCase();
    const posting = makePosting(rng, slug, freshId());
    addAddition({
      kind: 'new', num: rng.pick(nums), report: ++reportNum, date: date(rng), company, role: rng.pick(ROLES),
      score: score(rng), status: 'Evaluated', notes: 'collision fixture', url: posting.url, key: posting.key, urlVia: 'tsv',
    });
  }

  // Re-evaluations of seeded rows under another spelling of their URL, with a
  // new report number and sometimes an edited title.
  for (const target of rng.shuffle(rows).slice(0, rng.int(1, 3))) {
    addAddition({
      kind: 'reeval', target, num: 300 + additions.length, report: ++reportNum, date: date(rng),
      company: target.company, role: rng.chance(0.5) ? target.role : rng.pick(ROLES),
      score: score(rng), status: 'Evaluated', notes: rng.pick(NOTES),
      url: respell(rng, target.url), key: target.key, urlVia: 'tsv',
    });
  }

  // Two TSVs for one new posting in the same run (#2392 gap 3): one row.
  if (rng.chance(0.7)) {
    const first = additions.find((a) => a.kind === 'new' && a.notes !== 'collision fixture');
    addAddition({
      kind: 'intra-run', target: first, num: 400 + additions.length, report: ++reportNum, date: date(rng),
      company: first.company, role: first.role, score: score(rng), status: 'Evaluated',
      notes: 'second evaluation same run', url: respell(rng, first.url), key: first.key, urlVia: 'tsv',
    });
  }

  return { rng, rows, trackerLines, additions };
}

const HEADED_FIELDS = ['num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes'];

/** Render one addition as a TSV file body: headed (any column order) or legacy. */
function renderTsv(rng, a, reportFile) {
  const values = {
    num: String(a.num), date: a.date, company: a.company, role: a.role, status: a.status,
    score: a.score, pdf: '❌', report: `[${a.report}](reports/${reportFile})`, notes: a.notes,
  };
  const withUrl = a.urlVia === 'tsv';
  if (rng.chance(0.5)) {
    const fields = rng.shuffle([...HEADED_FIELDS, ...(withUrl ? ['url'] : [])]);
    const row = fields.map((f) => (f === 'url' ? a.url : values[f]));
    return `${fields.join('\t')}\n${row.join('\t')}\n`;
  }
  const row = HEADED_FIELDS.map((f) => values[f]);
  if (withUrl) row.push(a.url);
  return `${row.join('\t')}\n`;
}

function parseTable(text) {
  const lines = text.split('\n');
  const colmap = resolveColumns(lines);
  const dataLines = lines.filter((l) => l.startsWith('|') && !/^\|\s*#\s*\|/.test(l) && !/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(l));
  return {
    dataLines,
    numCells: dataLines.map((l) => l.split('|')[1].trim()),
    rows: dataLines.map((l) => parseTrackerRow(l, colmap)).filter(Boolean),
  };
}

function check(cond, label, failures) {
  if (!cond) failures.push(label);
}

function runSetStatus(sandbox, args) {
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'set-status.mjs'), ...args], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      // set-status also resolves its data root and claims a session-activity
      // sentinel; point both into the sandbox so the real checkout is untouched.
      env: {
        ...process.env,
        CAREER_OPS_ROOT: sandbox.root,
        CAREER_OPS_ACTIVITY_DIR: join(sandbox.root, '.career-ops-locks', 'active'),
        CAREER_OPS_TRACKER: sandbox.appsFile,
        CAREER_OPS_TRACKER_LOCK: sandbox.lockDir,
      },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

for (const seed of SEEDS) {
  const label = `seed ${seed}`;
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-seeded-tracker-'));
  const failures = [];
  try {
    const { rng, rows, trackerLines, additions } = buildScenario(seed);
    const dataDir = join(dir, 'data');
    const reportsDir = join(dir, 'reports');
    const additionsDir = join(dir, 'batch', 'tracker-additions');
    for (const d of [dataDir, reportsDir, additionsDir]) mkdirSync(d, { recursive: true });
    const appsFile = join(dataDir, 'applications.md');
    const sandbox = {
      root: dir,
      appsFile,
      lockDir: join(dir, 'career-ops-merge-tracker-seeded.lock'),
    };
    const options = {
      appsFile, dataRoot: dir, additionsDir,
      batchStateFile: join(dir, 'batch', 'batch-state.tsv'),
      pdfIndexFile: join(dataDir, 'pdf-index.tsv'),
      lockDir: sandbox.lockDir, logger: quiet,
    };

    for (const r of rows) writeFileSync(join(reportsDir, r.reportFile), `# ${r.company}\n\n**URL:** ${r.url.replace(/ /g, '%20')}\n`);
    const reportFileOf = new Map();
    for (const a of additions) {
      const file = `${a.report}-${a.company.split(' ')[0].toLowerCase()}-${a.date}.md`;
      reportFileOf.set(a, file);
      // A report-derived URL must not contain a space: the report header is
      // read with `\S+`, so only the TSV path can carry one.
      const reportUrl = a.urlVia === 'report' ? a.url.replace(/ /g, '%20') : 'N/A';
      if (a.urlVia === 'report') a.url = reportUrl;
      writeFileSync(join(reportsDir, file), `# ${a.company}\n\n**Score:** ${a.score} | **URL:** ${reportUrl}\n`);
      writeFileSync(join(additionsDir, `${a.num}-${a.company.split(' ')[0].toLowerCase()}.tsv`), renderTsv(rng, a, file));
    }
    const original = [...TRACKER_HEADER, ...trackerLines, ''].join('\n');
    writeFileSync(appsFile, original);

    // ---- Expected outcome, modelled independently of the merge -------------
    // Additions are processed in numeric filename order; each one either
    // updates the row that already carries its URL key or adds a row.
    const expected = new Map(); // key -> expected row
    const seedByKey = new Map(rows.map((r) => [r.key, r]));
    for (const r of rows) expected.set(r.key, { ...r, touched: false, reportLink: `[${r.num}](../reports/${r.reportFile})` });
    const taken = new Set(rows.map((r) => r.num));
    let maxNum = Math.max(0, ...taken);
    for (const a of [...additions].sort((x, y) => x.num - y.num)) {
      const link = `[${a.report}](../reports/${reportFileOf.get(a)})`;
      const hit = expected.get(a.key);
      if (hit) {
        Object.assign(hit, { touched: true, date: a.date, score: a.score, role: a.role, company: a.company, reportLink: link, lastNotes: a.notes });
      } else {
        let num = a.num;
        if (taken.has(num)) { num = maxNum + 1; while (taken.has(num)) num++; }
        taken.add(num);
        maxNum = Math.max(maxNum, num);
        expected.set(a.key, {
          num, date: a.date, company: a.company, role: a.role, score: a.score, status: a.status,
          notes: cell(a.notes), key: a.key, reportLink: link, touched: false, isNew: true,
        });
      }
    }
    const sentinelCount = trackerLines.filter((l) => /^\| (N\/A|—) \|/.test(l)).length;

    // ---- First merge --------------------------------------------------------
    const code = await mergeTracker({ ...options });
    check(code === 0, `merge exited ${code}`, failures);
    const merged = readFileSync(appsFile, 'utf-8');
    const table = parseTable(merged);

    check(table.dataLines.length === expected.size + sentinelCount,
      `row count ${table.dataLines.length}, want ${expected.size + sentinelCount} (rows lost or duplicated)`, failures);
    const numeric = table.rows.map((r) => r.num);
    check(new Set(numeric).size === numeric.length, `duplicate # in [${numeric.join(' ')}]`, failures);
    check(numeric.every((n, i) => i === 0 || numeric[i - 1] < n), `not sorted ascending: [${numeric.join(' ')}]`, failures);
    check(table.numCells.slice(numeric.length).every((c) => c === 'N/A' || c === '—')
      && table.numCells.length - numeric.length === sentinelCount,
    `sentinel # rows not parked at the end: [${table.numCells.join(' ')}]`, failures);

    const byKey = new Map(table.rows.map((r) => [normalizeUrl(r.url), r]));
    check(byKey.size === table.rows.length, 'two rows share one URL key', failures);
    for (const [key, want] of expected) {
      const got = byKey.get(key);
      if (!got) { failures.push(`no row carries key ${key} (${want.company})`); continue; }
      const who = `#${want.num} ${want.company}`;
      check(got.num === want.num, `${who}: # is ${got.num}`, failures);
      check(got.date === want.date, `${who}: date ${got.date}, want ${want.date}`, failures);
      check(got.company === cell(want.company), `${who}: company "${got.company}"`, failures);
      check(got.role === want.role, `${who}: role "${got.role}", want "${want.role}"`, failures);
      check(got.score === want.score, `${who}: score ${got.score}, want ${want.score}`, failures);
      check(got.status === want.status, `${who}: status ${got.status}, want ${want.status}`, failures);
      check(got.report === want.reportLink, `${who}: report ${got.report}, want ${want.reportLink}`, failures);
      if (want.isNew && !want.touched) {
        check(got.notes === want.notes, `${who}: notes "${got.notes}", want "${want.notes}"`, failures);
      } else if (want.touched) {
        // Re-evaluation notes: the existing cell is kept verbatim and first.
        const prev = (want.notes ?? '').replace(/\s*\.\s*$/, '');
        check(got.notes.startsWith(prev) && got.notes.includes(`Re-eval ${want.date}`),
          `${who}: re-eval notes "${got.notes}" dropped the earlier "${prev}"`, failures);
      }
      // Rows the batch never touched keep every byte, whatever the sort did.
      const seedRow = seedByKey.get(key);
      if (seedRow && !want.touched) {
        check(table.dataLines.includes(seedLineOf(seedRow)), `${who}: untouched row was rewritten`, failures);
      }
    }
    const left = readdirSync(additionsDir).filter((f) => f.endsWith('.tsv'));
    check(left.length === 0, `TSVs left unarchived: ${left.join(', ')}`, failures);

    // ---- Idempotency --------------------------------------------------------
    check(await mergeTracker({ ...options }) === 0, 'second merge failed', failures);
    check(readFileSync(appsFile, 'utf-8') === merged, 'a merge with nothing pending changed the tracker', failures);

    // Replaying the whole batch adds no row and moves no field but Notes.
    const mergedDir = join(additionsDir, 'merged');
    for (const f of readdirSync(mergedDir)) renameSync(join(mergedDir, f), join(additionsDir, f));
    check(await mergeTracker({ ...options }) === 0, 'replay merge failed', failures);
    const replay = parseTable(readFileSync(appsFile, 'utf-8'));
    check(replay.dataLines.length === table.dataLines.length,
      `replay changed the row count ${table.dataLines.length} → ${replay.dataLines.length}`, failures);
    const strip = (r) => [r.num, r.date, r.company, r.role, r.score, r.status, r.report, normalizeUrl(r.url)].join(' | ');
    check(replay.rows.map(strip).join('\n') === table.rows.map(strip).join('\n'),
      'replay changed a field other than Notes', failures);

    // ---- set-status ---------------------------------------------------------
    // One row per seed: each set-status run is a node cold start (~1s).
    const candidates = rng.shuffle(replay.rows.filter((r) => SET_STATUS_FROM.has(r.status))).slice(0, 1);
    check(candidates.length === 1, 'no row eligible for the set-status check', failures);
    for (const target of candidates) {
      const before = readFileSync(appsFile, 'utf-8');
      const state = rng.pick(SET_STATUS_TO.filter((s) => s !== target.status));
      const note = rng.chance(0.5) ? `fixture note ${seed}-${target.num}` : null;
      const args = ['--row', String(target.num), state, ...(note ? ['--note', note] : [])];
      const res = runSetStatus(sandbox, args);
      check(res.code === 0, `set-status ${args.join(' ')} exited ${res.code}: ${res.out.trim().split('\n').pop()}`, failures);
      const after = readFileSync(appsFile, 'utf-8');
      const b = before.split('\n');
      const a = after.split('\n');
      check(a.length === b.length, `set-status changed the line count ${b.length} → ${a.length}`, failures);
      const changed = b.map((l, i) => (l === a[i] ? -1 : i)).filter((i) => i >= 0);
      check(changed.length === 1 && b[changed[0]] === target.raw,
        `set-status --row ${target.num} changed ${changed.length} line(s), not just its own row`, failures);
      if (changed.length === 1) {
        const colmap = resolveColumns(a);
        const was = parseTrackerRow(b[changed[0]], colmap);
        const now = parseTrackerRow(a[changed[0]], colmap);
        check(now.status === state, `set-status wrote status "${now.status}", want "${state}"`, failures);
        for (const f of ['num', 'date', 'company', 'role', 'score', 'pdf', 'report', 'url']) {
          check(now[f] === was[f], `set-status changed ${f} on #${target.num}: "${was[f]}" → "${now[f]}"`, failures);
        }
        if (note) check(now.notes.startsWith(was.notes) && now.notes.endsWith(note), `set-status note not appended: "${now.notes}"`, failures);
        else check(now.notes === was.notes, `set-status changed notes without --note: "${now.notes}"`, failures);
      }
      const again = runSetStatus(sandbox, args);
      check(again.code === 0 && readFileSync(appsFile, 'utf-8') === after,
        `repeating set-status ${args.join(' ')} was not a no-op`, failures);
    }

    if (failures.length === 0) {
      pass(`${label}: ${rows.length} seeded rows + ${additions.length} additions keep every tracker invariant`);
    } else {
      for (const f of failures) fail(`${label}: ${f}`);
    }
  } catch (e) {
    fail(`${label}: crashed: ${e.stack || e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** The exact line a seeded row is written as; untouched rows must keep it. */
function seedLineOf(r) {
  return `| ${r.num} | ${r.date} | ${r.company} | ${r.role} | ${r.score} | ${r.status} | ${r.pdf} | `
    + `[${r.num}](../reports/${r.reportFile}) | ${r.notes} | ${r.url} |`;
}
