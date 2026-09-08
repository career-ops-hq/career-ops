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
// The halves this file gates:
//   - flag OFF (absent config) → byte-identical keys and identical collapse.
//   - flag ON  → the location joins the key, and a source that records NO
//     location still seeds the bare key, which matches every city. That
//     asymmetry is what keeps an applied role (applications.md usually has no
//     Location column) from resurfacing city by city.
//   - the location component is a canonical SET of places, not the provider's
//     display string (review finding on #3750). That field is free text, it
//     frequently packs several places into one value with inconsistent
//     separators, and nothing pins their order — so a verbatim key turns a
//     re-ordered list into a "new" posting. Sections 3b/3c and the 8b e2e pair
//     gate that, including the control that a real second city is still added.
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

// ── 3b. A value naming SEVERAL places is keyed as a canonical set ──────────
// Review finding on #3750: the provider location field is free text and is not
// reliably one place. On live Greenhouse boards a multi-location value packs
// them with `;`, the word `or`, `|` or `/`, and a single value mixes two of
// them. Our own providers add a fifth separator — greenhouse, ashby, eightfold,
// gem, ibm and echojobs all fold a multi-site role's extra cities into the
// string themselves, `' · '`-joined, in whatever order the upstream array came.
//
// Keying that string verbatim is stable only while the order holds, and nothing
// holds it. Re-ordered, the key changes, the posting reads as new, and it
// re-enters the pipeline on a scan that should have deduped it — the duplicate
// the location key exists to prevent, arriving from the other side.
{
  const key = loc => companyRoleDedupKey(CO, ROLE, undefined, loc);

  // Order independence, one case per separator seen in the wild.
  const ORDERED = [
    ['London, UK; Dublin, IE', 'Dublin, IE; London, UK', 'semicolon'],
    ['London, UK | Dublin, IE', 'Dublin, IE | London, UK', 'pipe'],
    ['London, UK / Dublin, IE', 'Dublin, IE / London, UK', 'slash'],
    ['London, UK or Dublin, IE', 'Dublin, IE or London, UK', 'the word "or"'],
    ['London, UK · Dublin, IE', 'Dublin, IE · London, UK', '" · " (our own providers\' join)'],
  ];
  for (const [a, b, label] of ORDERED) {
    if (key(a) === key(b)) pass(`multi-place value keyed order-independently — ${label}`);
    else fail(`${label}: re-ordering changed the key (${key(a)} vs ${key(b)})`);
  }

  // Mixed separators in one value — the shape that makes verbatim keying
  // hopeless. This exact string is live on Anthropic's board.
  const MESSY = 'Boston, MA; Remote-Friendly (Travel-Required) | San Francisco, CA | Seattle, WA | New York City, NY; Washington, DC';
  const SHUFFLED = 'Washington, DC | Seattle, WA; San Francisco, CA / New York City, NY · Boston, MA; Remote-Friendly (Travel-Required)';
  if (key(MESSY) === key(SHUFFLED)) {
    pass('a value mixing ";" and "|" reduces to the same set however it is written');
  } else {
    fail(`mixed-separator value is order-dependent:\n  ${key(MESSY)}\n  ${key(SHUFFLED)}`);
  }

  // …and it is still a *set of places*, not a blob: every place is present and
  // separately addressable, and a repeat collapses.
  const places = key(MESSY).split('@@')[1].split('+');
  const wantPlaces = ['boston ma', 'new york city ny', 'remote friendly travel required', 'san francisco ca', 'seattle wa', 'washington dc'];
  if (JSON.stringify(places) === JSON.stringify(wantPlaces)) pass('the location component is the sorted set of the places named');
  else fail(`location component = ${JSON.stringify(places)}`);

  if (key('Dublin, IE; Dublin, IE; London, UK') === key('London, UK; Dublin, IE')) {
    pass('a repeated place collapses (boards that list a city twice key the same)');
  } else {
    fail('a repeated place did not collapse');
  }

  // A DIFFERENT set must still key differently — the collapse above must not
  // have been bought by throwing the places away.
  if (key('London, UK; Dublin, IE') !== key('London, UK') && key('London, UK') !== key('Dublin, IE')) {
    pass('a two-city posting, a London posting and a Dublin posting are three keys');
  } else {
    fail('distinct place sets collapsed to one key');
  }

  // "," is the delimiter INSIDE a place, never between two. Splitting on it
  // would shatter every ordinary location and make "London, UK" and
  // "Dublin, UK" share the fragment `uk`.
  if (key('London, UK') !== key('Dublin, UK') && key('London, UK') === 'anthropic::staff software engineer inference@@london uk') {
    pass('"," is not treated as a separator — an ordinary "City, Country" stays one place');
  } else {
    fail(`comma handling wrong: ${key('London, UK')} / ${key('Dublin, UK')}`);
  }
}

// ── 3c. Round trip: a re-ordered history row still dedupes ─────────────────
// The seed side and the scan side share normalizeLocationForDedup, so the
// property above has to survive the file boundary: a scan-history row written
// when the board listed "London | Dublin" must still suppress the same posting
// after the board starts saying "Dublin | London".
{
  const WRITTEN = 'London, UK | Dublin, IE';
  const NOW_SAYS = 'Dublin, IE | London, UK';
  const history = `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\t${ROLE}\t${CO}\tadded\t${WRITTEN}\n`;
  const seen = collectSeenCompanyRoles({ scanHistoryText: history }, {}, undefined, { includeLocation: true });
  if (seen.has(companyRoleDedupKey(CO, ROLE, undefined, NOW_SAYS))) {
    pass('a scan-history row survives the board re-ordering its city list (no duplicate on the next scan)');
  } else {
    fail(`re-ordered location missed its own history row — seeded [${[...seen].join(', ')}]`);
  }
  // And a genuinely different city set is still NOT suppressed by it.
  if (!seen.has(companyRoleDedupKey(CO, ROLE, undefined, 'Dublin, IE'))) {
    pass('the Dublin-only twin is still eligible against a "London | Dublin" history row');
  } else {
    fail('a two-city history row wrongly suppressed the single-city twin');
  }
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
//
// Which cells count as labeled is an ALLOW-LIST of the four labels the two
// writers actually emit (`posted:`/`trust:`/`note:` from formatPipelineOffer,
// `rank:` from rank-pipeline.mjs's appendRankAnnotation), not the shape
// "any word, then a colon" (#3751 review). Locations are free text and
// routinely take that shape — the `Remote: …` rows below are copied from live
// Neo4j postings in the reporter's own data/pipeline.md, where the broad
// pattern mis-read 5 of them. A mis-read location falls back to the bare
// wildcard key, which then suppresses every city-specific variant of that
// role: the exact collapse this flag exists to prevent, arriving through the
// parser instead of the key. Both directions are gated here.
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
    // The other three emitted labels — each must still be rejected.
    ['- [ ] https://ex.com/p/6 | Acme Corp | Site Reliability Engineer | trust: 60 missing_apply_url,suspicious_domain',
      null, 'labeled `trust:` segment in the 4th cell is not a location'],
    ['- [ ] https://ex.com/p/7 | Acme Corp | Product Designer | note: curated list',
      null, 'labeled `note:` segment in the 4th cell is not a location'],
    ['- [ ] https://ex.com/p/8 | Acme Corp | ML Engineer | rank: 4.2/5 — Strong match',
      null, 'labeled `rank:` segment (rank-pipeline.mjs) in the 4th cell is not a location'],
    // …and the live shapes the broad pattern swallowed. These ARE locations.
    ['- [ ] https://ex.com/p/9 | Acme Corp | Graph Data Scientist | Remote: EMEA',
      'Remote: EMEA', 'a `Remote: EMEA` cell is a location, not metadata'],
    ['- [ ] https://ex.com/p/10 | Acme Corp | Field Engineer | Remote: Southeast US',
      'Remote: Southeast US', 'a `Remote: Southeast US` cell is a location, not metadata'],
    ['- [ ] https://ex.com/p/11 | Acme Corp | Cloud Architect | Remote: San Mateo area',
      'Remote: San Mateo area', 'a `Remote: San Mateo area` cell is a location, not metadata'],
  ];

  for (const [line, location, label] of CASES) {
    const seen = collectSeenCompanyRoles({ pipelineText: `${line}\n` }, {}, undefined, { includeLocation: true });
    const [, company, role] = line.match(/\|\s*(Acme Corp)\s*\|\s*([^|]+?)\s*\|/) ?? [];
    const want = companyRoleDedupKey(company ?? 'Acme Corp', role ?? '', undefined, location ?? undefined);
    if (seen.has(want) && seen.size === 1) pass(`pipeline.md: ${label}`);
    else fail(`pipeline.md: ${label} — wanted [${want}], got [${[...seen].join(', ')}]`);
  }
}

// ── 7b. The reverse-wildcard index (#3751 review) ───────────────────────────
// A bare key is a wildcard, and a wildcard has to work in BOTH directions.
// `seen.has(baseKey)` covers seed-bare → candidate-located. The reverse —
// history holds `company::role@@london`, a provider now returns the same role
// with an empty location, so the candidate's own key IS the bare key — matches
// no stored entry at all, and the role is re-added.
//
// collectSeenCompanyRoles answers it by recording, as it builds each key, the
// bare key of every row that seeded a located one. That is O(1) per candidate
// at lookup time; scanning the key set for a `${baseKey}@@` prefix instead
// would walk every historical posting for every candidate on every run.
{
  const history = [
    HISTORY_HEADER,
    `https://ex.com/j/1\t2026-07-01\tgreenhouse\t${ROLE}\t${CO}\tadded\tLondon, UK`,
  ].join('\n');

  const locatedBases = new Set();
  const seen = collectSeenCompanyRoles(
    { scanHistoryText: history }, {}, undefined, { includeLocation: true, locatedBases },
  );

  // The seeded key is located, so the bare key is NOT in the key set…
  if (!seen.has(BARE)) pass('a located seed does not put the bare key in the key set');
  else fail('a located seed leaked a bare key into the key set');

  // …and the companion index is what makes it resolvable anyway.
  if (locatedBases.has(BARE)) {
    pass('a located seed records its bare key in the reverse index');
  } else {
    fail(`reverse index missing the bare key: [${[...locatedBases].join(', ')}]`);
  }

  // The index keys on the BARE form, so a different role at the same company
  // does not borrow it.
  if (!locatedBases.has(companyRoleDedupKey(CO, 'Staff Software Engineer, AI Reliability'))) {
    pass('the reverse index does not collapse two distinct roles at one company');
  } else {
    fail('the reverse index matched an unrelated role');
  }
}

// The index must stay EMPTY with the flag off, or the extra lookup in main()
// could change the default path — the one thing this feature may never do.
{
  const history = [
    HISTORY_HEADER,
    `https://ex.com/j/1\t2026-07-01\tgreenhouse\t${ROLE}\t${CO}\tadded\tLondon, UK`,
  ].join('\n');

  const locatedBases = new Set();
  collectSeenCompanyRoles({ scanHistoryText: history }, {}, undefined, { locatedBases });
  if (locatedBases.size === 0) {
    pass('flag off — the reverse index stays empty, so the extra lookup is inert');
  } else {
    fail(`flag off — reverse index was populated: [${[...locatedBases].join(', ')}]`);
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

// 8b. END-TO-END: a re-listed posting whose cities were re-ordered ─────────
// The unit checks in 3b/3c prove the key is a set. This proves the whole scan
// behaves that way: the board re-lists ONE role at a NEW url (so url dedupe
// cannot help) with the SAME two cities written the other way round. Nothing
// about the posting changed, so nothing may be added.
//
// The control in the same harness is the point — a genuinely different city at
// the new url MUST still be added, or "no duplicate" was bought by deduping
// everything, which is the bug this flag exists to fix.
//
// Provider-agnostic on purpose: this runs through local-parser, not Greenhouse.
// The location field is free text for every provider, and several of ours build
// a multi-city string from an upstream array, so the property cannot live in
// one provider.
function runScanRelist(relistMode, script = 'tests/fixtures/reordering-multi-city-board.mjs') {
  const dir = mkdtempSync(join(tmpdir(), 'scan-relist-e2e-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), EMPTY_TRACKER);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');

    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `scan_history:
  dedup_include_location: true
title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: ${script}
`);

    const scan = (relist) => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals, FIXTURE_RELIST: relist },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entries = () => {
      const f = join(dir, 'data', 'pipeline.md');
      if (!existsSync(f)) return [];
      return readFileSync(f, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l));
    };

    scan('');
    const afterFirst = entries().length;
    scan(relistMode);
    return { afterFirst, afterSecond: entries().length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  try {
    const { afterFirst, afterSecond } = runScanRelist('reordered');
    if (afterFirst === 1 && afterSecond === 1) {
      pass('a re-listed posting with its cities re-ordered is not re-added (set-valued location key)');
    } else {
      fail(`re-ordered re-list leaked: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 1 and 1)`);
    }
  } catch (err) {
    fail(`e2e re-list scan (reordered) failed: ${err.message}`);
  }
}

{
  try {
    const { afterFirst, afterSecond } = runScanRelist('different');
    if (afterFirst === 1 && afterSecond === 2) {
      pass('control: a genuinely different city at a new url IS still added');
    } else {
      fail(`control wrong: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 1 and 2)`);
    }
  } catch (err) {
    fail(`e2e re-list scan (different) failed: ${err.message}`);
  }
}

// 8c. END-TO-END: the reverse wildcard direction (#3751 review) ─────────────
// Run 1 seeds the role in London. Run 2 re-lists the SAME role at a NEW url
// (url dedupe cannot help) with NO location, so the candidate's own key is the
// bare wildcard and matches neither the located seed nor any bare seed. Before
// the reverse index it was added — an already-surfaced role coming back a
// second time, which is precisely what the wildcard exists to stop.
//
// Its control is the run below it: a real second city at the same new url must
// STILL be added, or the symmetry was bought by deduping everything.
const LOCATIONLESS_BOARD = 'tests/fixtures/locationless-relist-board.mjs';

{
  try {
    const { afterFirst, afterSecond } = runScanRelist('locationless', LOCATIONLESS_BOARD);
    if (afterFirst === 1 && afterSecond === 1) {
      pass('a located seed suppresses a later locationless re-list (wildcard holds in both directions)');
    } else {
      fail(`reverse wildcard leaked: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 1 and 1)`);
    }
  } catch (err) {
    fail(`e2e locationless re-list scan failed: ${err.message}`);
  }
}

{
  try {
    const { afterFirst, afterSecond } = runScanRelist('different', LOCATIONLESS_BOARD);
    if (afterFirst === 1 && afterSecond === 2) {
      pass('control: two located candidates in different cities are still kept separate');
    } else {
      fail(`distinct-city control wrong: ${afterFirst} entries after run 1, ${afterSecond} after run 2 (want 1 and 2)`);
    }
  } catch (err) {
    fail(`e2e locationless-board control scan failed: ${err.message}`);
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
