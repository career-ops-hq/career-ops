// tests/scan-url-dedup.test.mjs — the URL dedupe gate must recognize a posting
// it has already seen, whatever query string it arrives with and wherever the URL
// sits in the pipeline.md line that recorded it.
//
// Two halves, one gate:
//
// 1. `normalizeUrlForDedup` — the *value*: two spellings of one posting must
//    produce one key, and two postings must never collapse onto one.
// 2. `collectSeenUrls` over pipeline.md — the *shape*: six line shapes are
//    documented across the modes, and only the one `appendToPipeline` writes
//    leads with the URL. Anchoring the match to the checkbox found that one and
//    missed the rest, so a posting already sitting in the inbox under any other
//    shape was re-added on the next scan. These tests previously covered only
//    part 1, which is how five documented shapes drifted out of support unnoticed.
//
// Both halves guard the same asymmetry: a missed key re-adds a duplicate, but a
// *wrong* key silently hides a real job. Every boundary below — which characters
// end a URL, where the checkbox may sit — is pinned in the hiding direction.
//
// StepStone regenerates its `rltr` parameter on every request, so a dedup key that
// keeps it treats the same posting as new on each scan (one Vonovia posting was
// stored under three URLs across three scans, HDI and Lloyds under four each, and
// every re-add flowed into pipeline.md as a fresh offer to evaluate).
//
// DEDUP_STRIP_PARAMS is an allowlist rather than a blanket strip because the risk
// is asymmetric: an unstripped param leaves a visible duplicate, while stripping an
// identity-bearing one (Greenhouse's `gh_jid`) silently hides a real job. These
// tests pin both sides of that line.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { collectSeenUrls } from '../scan.mjs';

console.log('\nscan.mjs — normalizeUrlForDedup() ignores tracking params, preserves identity');
try {
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // The reported bug: one StepStone posting, two scans, two `rltr` values.
  const SS = 'https://www.stepstone.de/stellenangebote--AI-Engineer-Berlin-Acme--12345-inline.html';
  const a = normalizeUrlForDedup(`${SS}?rltr=23_23_25_seorl_a_0_0_0_0_1_0`);
  const b = normalizeUrlForDedup(`${SS}?rltr=42_17_25_seorl_r_0_0_0_0_1_0`);
  if (a === b && a === normalizeUrlForDedup(SS)) pass('rltr variants collapse onto the bare posting key');
  else fail(`rltr = ${JSON.stringify({ a, b, bare: normalizeUrlForDedup(SS) })}`);

  // utm_* are analytics only.
  const utm = normalizeUrlForDedup('https://jobs.example.com/j/7?utm_source=x&utm_medium=y&utm_campaign=z');
  if (utm === 'https://jobs.example.com/j/7') pass('utm_* parameters are stripped');
  else fail(`utm = ${utm}`);

  // Identity-bearing params MUST survive: collapsing two real postings would
  // silently hide a job, which is worse than re-adding a duplicate.
  const gh1 = normalizeUrlForDedup('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
  const gh2 = normalizeUrlForDedup('https://boards.greenhouse.io/acme/jobs/1?gh_jid=2');
  if (gh1 !== gh2) pass('identity params (gh_jid) stay distinct');
  else fail(`collapsed distinct gh_jid postings onto ${gh1}`);

  // A tracking param must not take a real one with it.
  const mixed = normalizeUrlForDedup('https://jobs.example.com/j?gh_jid=9&rltr=abc&utm_source=feed');
  if (mixed === 'https://jobs.example.com/j?gh_jid=9') pass('only tracking params are dropped from a mixed query');
  else fail(`mixed query = ${mixed}`);

  // Untracked URLs must keep matching what is already in scan-history.
  const plain = 'https://jobs.ashbyhq.com/acme/abc-123';
  if (normalizeUrlForDedup(plain) === plain) pass('a tracking-free URL is left unchanged');
  else fail(`plain = ${normalizeUrlForDedup(plain)}`);

  // pipeline.md supports `local:jds/foo.md`. `local:` is a valid URL scheme, so this
  // parses and round-trips unchanged rather than hitting the catch — either way the
  // key must equal the input, or a local JD would be re-added on every scan.
  const local = 'local:jds/acme-ai-engineer.md';
  if (normalizeUrlForDedup(local) === local) pass('local: pipeline entries round-trip unchanged');
  else fail(`local = ${normalizeUrlForDedup(local)}`);

  // A genuinely unparseable value (no scheme) is what the catch actually handles.
  const bare = 'jds/acme-ai-engineer.md';
  if (normalizeUrlForDedup(bare) === bare) pass('scheme-less values pass through unchanged');
  else fail(`scheme-less = ${normalizeUrlForDedup(bare)}`);

  // Empty and nullish input is returned as-is, so a blank history cell never
  // becomes the shared key that every other blank cell dedups against.
  if (normalizeUrlForDedup('') === '' && normalizeUrlForDedup(null) === null && normalizeUrlForDedup(undefined) === undefined) {
    pass('empty/nullish input is returned unchanged');
  } else {
    fail('empty/nullish input should be returned unchanged');
  }
} catch (err) {
  fail(`scan.mjs normalizeUrlForDedup tests crashed: ${err && err.message}`);
}

console.log('\nscan.mjs — collectSeenUrls() finds the URL in every documented pipeline.md shape');
try {
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // Transcribed from the docs that specify each shape, so these fail if the
  // documented format changes. Only the first leads with the URL.
  const SHAPES = [
    // modes/pipeline.md → "Format of pipeline.md" (what appendToPipeline writes).
    ['- [ ] https://boards.greenhouse.io/acme/jobs/1 | Acme Corp | Staff Engineer',
      'https://boards.greenhouse.io/acme/jobs/1', 'pending entry (URL first)'],
    // modes/pipeline.md → workflow step 2f and the "Processed" example.
    ['- [x] #143 | https://jobs.example.com/posting/2 | Acme Corp | AI PM | 4.2/5 | PDF ✅',
      'https://jobs.example.com/posting/2', 'processed entry led by a report number'],
    // reconcile-pipeline.mjs → the line it writes when moving an entry to Processed.
    // The report link is not a URL, so the gate must not stop at the first `(`…`)`.
    ['- [x] [144](reports/144-acme-2026-01-01.md) | https://jobs.example.com/posting/3 | Acme Corp | Solutions Architect | 3.1/5 | PDF ❌',
      'https://jobs.example.com/posting/3', 'processed entry led by a report link'],
    // modes/pipeline.md → pre-screen gate.
    ['- [x] #-- | https://jobs.example.com/posting/4 | skipped (pre-screen mismatch: not a North Star archetype)',
      'https://jobs.example.com/posting/4', 'pre-screen discard'],
    // modes/pipeline.md → liveness sweep step 3. The `~~` wrapper must not be
    // absorbed into the URL, or the key would never match the live posting.
    ['- [x] ~~https://jobs.example.com/posting/5 | Acme Corp | Backend Engineer~~ — posting expired (liveness sweep)',
      'https://jobs.example.com/posting/5', 'expired entry with a URL'],
    // modes/oferta.md → liveness gate; modes/auto-pipeline.md → Step 0.5 / 0.6.
    // No URL at all — nothing to seed, and nothing to crash on.
    ['- [x] ~~Acme Corp | Data Engineer~~ — oferta nieaktywna', null, 'expired entry without a URL'],
  ];

  // `collectSeenUrls` takes the source texts directly (#2382), so pipeline.md
  // parsing is testable without touching the filesystem at all.
  const seenUrlsFor = (pipelineText) => collectSeenUrls({ pipelineText }).seen;

  const seen = seenUrlsFor(SHAPES.map(([line]) => line).join('\n') + '\n');

  for (const [, url, label] of SHAPES) {
    if (!url) continue;
    if (seen.has(normalizeUrlForDedup(url))) pass(`pipeline.md: ${label} reaches the URL gate`);
    else fail(`pipeline.md: ${label} did not reach the URL gate — ${url} is missing`);
  }

  // Exact size, not just membership: a truncated or over-greedy match would add a
  // near-miss key alongside the right one and still pass every check above.
  const expected = SHAPES.filter(([, url]) => url).length;
  if (seen.size === expected) pass(`pipeline.md: ${expected} URL-bearing shapes seed exactly ${expected} keys`);
  else fail(`expected ${expected} keys, got ${seen.size}: [${[...seen].join(', ')}]`);

  // Where the checkbox may sit. Matching the URL anywhere in the line only works
  // if the checkbox itself is anchored: pipeline.md is hand-edited, and a note
  // that merely contains checkbox syntax must not seed the link it mentions —
  // a false dedupe hides a live posting, which is the costlier direction of
  // error. Indented entries still count, as they did when the URL had to sit
  // immediately after the checkbox.
  const prose = 'Reminder: - [ ] chase the recruiter, posting is https://jobs.example.com/posting/9 (still open)';
  if (seenUrlsFor(prose + '\n').size === 0) pass('pipeline.md: mid-line checkbox syntax in prose seeds nothing');
  else fail(`prose line seeded a URL: [${[...seenUrlsFor(prose + '\n')].join(', ')}]`);

  const indented = '  - [ ] https://jobs.example.com/posting/10 | Acme Corp | Staff Engineer';
  if (seenUrlsFor(indented + '\n').has(normalizeUrlForDedup('https://jobs.example.com/posting/10'))) {
    pass('pipeline.md: an indented entry still reaches the URL gate');
  } else {
    fail('indented entry did not reach the URL gate');
  }

  // Where the URL may END. Only whitespace and `|` terminate it: `|` cannot
  // appear unencoded in a URL and is this format's separator. Excluding any
  // legal URL character instead truncates the key, which is the expensive
  // direction twice over — the entry stops deduping, *and* the truncated prefix
  // enters the seen-set, so every other posting on that host false-dedupes
  // against it. `~` is RFC 3986 unreserved (`~user` paths) and `)` is a
  // sub-delim (parenthesised region suffixes); both are ordinary URL characters.
  for (const [url, label] of [
    ['https://jobs.example.com/~acme/jobs/11', 'a tilde path survives intact'],
    ['https://jobs.example.com/jobs/12(eu)', 'a parenthesised suffix survives intact'],
  ]) {
    const got = seenUrlsFor(`- [ ] ${url} | Acme Corp | Staff Engineer\n`);
    if (got.size === 1 && got.has(normalizeUrlForDedup(url))) pass(`pipeline.md: ${label}`);
    else fail(`${label} — expected [${normalizeUrlForDedup(url)}], got [${[...got].join(', ')}]`);
  }
} catch (err) {
  fail(`scan.mjs collectSeenUrls tests crashed: ${err && err.message}`);
}
