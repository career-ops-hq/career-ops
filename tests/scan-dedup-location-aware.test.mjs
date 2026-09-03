// tests/scan-dedup-location-aware.test.mjs — opt-in location-aware company+role
// dedupe (`scan_history.dedup_include_location`).
//
// The company+role key deliberately carries no location, so an employer that
// opens one req per city collapses to a single pipeline entry (see
// tests/scan-company-role-dedup.test.mjs). That default is right for most
// people and stays the default here.
//
// It is wrong for a location-constrained candidate, because the survivor is
// arbitrary — whichever twin the provider happens to return first. Live shape
// that motivated this (Anthropic's Greenhouse board, verified against
// boards-api.greenhouse.io/v1/boards/anthropic/jobs):
//
//   Staff Software Engineer, Inference             id 5097742008  London, UK
//   Staff Software Engineer, Inference             id 5150472008  Dublin, IE
//   Staff Software Engineer, AI Reliability Eng.   id 5101173008  London, UK
//   Staff Software Engineer, AI Reliability Eng.   id 5101169008  Dublin, IE
//
// `location_filter` cannot discriminate: an EU-based candidate's allow-list
// passes both "London, UK" and "Dublin, IE", so the filter is a no-op here and
// dedupe then keeps one city at random. On the reporter's machine every one of
// the 9 Anthropic rows in data/scan-history.tsv was London and none was Dublin
// — the city he cannot legally work in survived, the one he can was dropped.
//
// The two halves this file gates:
//   - flag OFF (absent config) → byte-identical keys and identical collapse.
//   - flag ON  → the location joins the key, and a source that records NO
//     location still seeds the bare key, which matches every city. That
//     asymmetry is what keeps an applied role (applications.md usually has no
//     Location column) from resurfacing city by city.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { companyRoleDedupKey, collectSeenCompanyRoles, loadSeenCompanyRoles } from '../scan.mjs';

console.log('\nscan.mjs — opt-in location-aware company+role dedupe');

const HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const EMPTY_TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const CO = 'Anthropic';
const ROLE = 'Staff Software Engineer, Inference';
const BARE = companyRoleDedupKey(CO, ROLE);

// ── 1. The key shape is unchanged when no location is supplied ──────────────
// Every existing caller passes 2 or 3 arguments; none of them may see a
// different string, or a tracker seeded by an older run stops matching.
{
  if (BARE === 'anthropic::staff software engineer inference') {
    pass('companyRoleDedupKey without a location keeps its existing `company::role` shape');
  } else {
    fail(`bare key shape changed: ${JSON.stringify(BARE)}`);
  }
}

// ── 2. A supplied location joins the key ────────────────────────────────────
{
  const london = companyRoleDedupKey(CO, ROLE, undefined, 'London, UK');
  const dublin = companyRoleDedupKey(CO, ROLE, undefined, 'Dublin, IE');
  if (london !== dublin) pass('two cities of one role produce two distinct keys');
  else fail(`London and Dublin collapsed to one key: ${london}`);

  if (london !== BARE && dublin !== BARE) pass('a located key never equals the bare key');
  else fail('a located key collided with the bare (location-unknown) key');

  // Same city, cosmetically different string → one key. The provider's display
  // string is not stable enough to key on verbatim.
  if (companyRoleDedupKey(CO, ROLE, undefined, 'London,  UK') === london) {
    pass('location text is normalized (punctuation/whitespace collapse) before keying');
  } else {
    fail('cosmetically different spellings of one city produced two keys');
  }
}

// ── 3. Unknown location degrades to the bare key ────────────────────────────
// The wildcard is the whole safety property: a source that records no location
// must keep suppressing every city, exactly as it does today.
{
  const blanks = [undefined, null, '', '   ', 42, {}];
  const wrong = blanks.filter(v => companyRoleDedupKey(CO, ROLE, undefined, v) !== BARE);
  if (wrong.length === 0) pass('empty/malformed location degrades to the bare key (wildcard)');
  else fail(`these locations did not degrade to the bare key: ${JSON.stringify(wrong)}`);
}

// ── 4. collectSeenCompanyRoles: default is byte-identical ───────────────────
{
  const history = `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\t${ROLE}\t${CO}\tadded\tLondon, UK\n`;
  const seen = collectSeenCompanyRoles({ scanHistoryText: history });
  if (seen.size === 1 && seen.has(BARE)) pass('default (flag off) still seeds the bare key only');
  else fail(`default seeding changed — got [${[...seen].join(', ')}]`);
}

// ── 5. collectSeenCompanyRoles: opt-in seeds per-city keys ──────────────────
// The bug, expressed as a seed-set assertion: the London row must not put the
// Dublin twin's key into the seen-set.
{
  const history = `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\t${ROLE}\t${CO}\tadded\tLondon, UK\n`;
  const seen = collectSeenCompanyRoles({ scanHistoryText: history }, {}, undefined, { includeLocation: true });
  const london = companyRoleDedupKey(CO, ROLE, undefined, 'London, UK');
  const dublin = companyRoleDedupKey(CO, ROLE, undefined, 'Dublin, IE');
  if (seen.has(london) && !seen.has(dublin) && !seen.has(BARE)) {
    pass('opt-in: a London scan-history row seeds London only — the Dublin twin stays eligible');
  } else {
    fail(`opt-in seeding wrong — got [${[...seen].join(', ')}]`);
  }
}

// ── 6. A location-less source still seeds the wildcard ──────────────────────
// applications.md normally has no Location column. Once the user has applied,
// no city variant of that role may resurface — otherwise turning the flag on
// would spam the pipeline with cities of roles already in flight.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-locdedup-'));
  try {
    const appsPath = join(dir, 'applications.md');
    writeFileSync(appsPath, `${EMPTY_TRACKER}| 1 | 2026-01-01 | ${CO} | ${ROLE} | 4.5/5 | Applied | ✅ | — | seed row |\n`);
    const seen = loadSeenCompanyRoles(appsPath, undefined, {
      includeLocation: true,
      scanHistoryPath: join(dir, 'scan-history.tsv'),
      pipelinePath: join(dir, 'pipeline.md'),
    });
    if (seen.has(BARE)) pass('a tracker row with no Location column seeds the bare wildcard key');
    else fail(`location-less tracker row did not seed the wildcard — got [${[...seen].join(', ')}]`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. pipeline.md contributes a location only where the cell IS one ────────
// The 4th cell after the URL is positional and means different things per
// shape. It is the location only in the shape appendToPipeline writes (URL
// first). A report-led processed entry puts the SCORE there, and a labeled
// `posted:` segment lands there when the offer had no location and no comp —
// keying on either would invent a city and resurface a processed role.
{
  const CASES = [
    ['- [ ] https://ex.com/p/1 | Acme Corp | Staff Engineer | Dublin, IE',
      'Dublin, IE', 'pending entry: 4th cell is the location'],
    ['- [x] #143 | https://ex.com/p/2 | Acme Corp | AI PM | 4.2/5 | PDF ✅',
      null, 'processed entry led by a report number: score cell is not a location'],
    ['- [x] [144](reports/144-acme-2026-01-01.md) | https://ex.com/p/3 | Acme Corp | Solutions Architect | 3.1/5 | PDF ❌',
      null, 'processed entry led by a report link: score cell is not a location'],
    ['- [ ] https://ex.com/p/4 | Acme Corp | Data Engineer | posted: 2026-07-01',
      null, 'labeled `posted:` segment in the 4th cell is not a location'],
    ['- [ ] https://ex.com/p/5 | Acme Corp | Backend Engineer |  | 120000 EUR',
      null, 'empty location cell forced by a compensation column is not a location'],
  ];

  for (const [line, location, label] of CASES) {
    const seen = collectSeenCompanyRoles({ pipelineText: `${line}\n` }, {}, undefined, { includeLocation: true });
    const [, company, role] = line.match(/\|\s*(Acme Corp)\s*\|\s*([^|]+?)\s*\|/) ?? [];
    const want = companyRoleDedupKey(company ?? 'Acme Corp', role ?? '', undefined, location ?? undefined);
    if (seen.has(want) && seen.size === 1) pass(`pipeline.md: ${label}`);
    else fail(`pipeline.md: ${label} — wanted [${want}], got [${[...seen].join(', ')}]`);
  }
}

// ── 8/9. END-TO-END: two real scan runs over a one-role/three-city board ────
// The unit checks above all pass against a build whose main() never reads the
// config flag, so the wiring has to be observed through the CLI — the same
// reason tests/scan-company-role-dedup.test.mjs ends with an e2e pair.
//
// Fixture and harness are shared with that file: a local-parser board, no
// network, cwd and CAREER_OPS_ROOT pinned to a sandbox so nothing reads the
// developer's real data/.
function runScanTwice(scanHistoryBlock) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-locdedup-e2e-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), EMPTY_TRACKER);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');

    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `${scanHistoryBlock}title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/three-city-board.mjs
`);

    const scan = () => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entries = () => {
      const p = join(dir, 'data', 'pipeline.md');
      if (!existsSync(p)) return [];
      return readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l));
    };

    scan();
    const afterFirst = entries().length;
    scan();
    const afterSecond = entries().length;
    return { afterFirst, afterSecond };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 8. Flag ON — every city survives run 1 and none is re-added on run 2.
{
  try {
    const { afterFirst, afterSecond } = runScanTwice('scan_history:\n  dedup_include_location: true\n');
    if (afterFirst === 3 && afterSecond === 3) {
      pass('dedup_include_location: true — all 3 cities kept on run 1, none duplicated on run 2');
    } else {
      fail(`location-aware dedupe wrong: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 3 and 3)`);
    }
  } catch (err) {
    fail(`e2e scan run (flag on) failed: ${err.message}`);
  }
}

// 9. Flag ABSENT — the deliberate collapse is untouched. This is the
// regression gate on the default: the fix must be inert without the flag.
{
  try {
    const { afterFirst, afterSecond } = runScanTwice('');
    if (afterFirst === 1 && afterSecond === 1) {
      pass('flag absent — the one-entry-per-role collapse is unchanged (no regression)');
    } else {
      fail(`default collapse regressed: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 1 and 1)`);
    }
  } catch (err) {
    fail(`e2e scan run (flag absent) failed: ${err.message}`);
  }
}
