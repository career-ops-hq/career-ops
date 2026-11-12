// tests/harvest-buildlist.test.mjs — hostile-input coverage for harvest-buildlist.mjs.
//
// The script's own --self-test (registered in test-all.mjs) covers the parsers
// on well-formed pages. This suite covers what a hostile or broken page, a
// tampered progress file, or a mistyped flag can do. The output is a file the
// user pastes into portals.yml, so the bar is: nothing read off a page can add,
// change or break a YAML entry, and nothing the script does can write
// portals.yml itself.
//
// HERMETIC: page bodies are inline strings, harvest() gets an injected fetch
// and Crawl-delay, and every CLI case is refused before the script makes a
// request. Fictional companies throughout.
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ROOT, NODE, pass, fail, ownRootEnv, rmSync } from './helpers.mjs';
import { fetchTextWithRetry } from '../providers/_http.mjs';
import {
  CHECKPOINT_EVERY, MAX_COMPANIES, boardFromUrl, decodeEntities, dedupeBoards, extractAtsBoards,
  extractCompanyName, harvest, loadTrackedEntries, oneLine, readCheckpoint,
  pacedRetryCtx, renderPortalsYaml, renderSummary, retryPolicy, yamlString,
} from '../harvest-buildlist.mjs';

const SCRIPT = join(ROOT, 'harvest-buildlist.mjs');
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) fail(`${name}: ${problem}`);
    else pass(name);
  } catch (err) {
    fail(`${name}: threw ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    const problem = await fn();
    if (problem) fail(`${name}: ${problem}`);
    else pass(name);
  } catch (err) {
    fail(`${name}: threw ${err.message}`);
  }
}

const page = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const entry = (name, slug, extra = {}) => ({
  name, buildlistSlug: slug, vendor: 'ashby', slug, board: `https://jobs.ashbyhq.com/${slug}`, profile: {}, alternates: [], ...extra,
});
const parsePortals = (text) => yaml.load(`tracked_companies:\n${text}`).tracked_companies || [];
const sitemapOf = (slugs) => `<urlset>${slugs.map(s => `<url><loc>https://buildlist.xyz/${s}</loc></url>`).join('')}</urlset>`;

const dir = mkdtempSync(join(tmpdir(), 'co-harvest-buildlist-'));
try {
  // --- Reading a board off a link ---------------------------------------------

  check('a lookalike greenhouse host is not read as Greenhouse', () => {
    const b = extractAtsBoards('https://jobs.evilgreenhouse.io/globex https://greenhouse.io.evil.example/globex');
    return b.length ? `got ${JSON.stringify(b)}` : null;
  });

  check('a ?for= board carrying an encoded newline and a forged entry is rejected', () => {
    const forged = 'globex%0A%20%20%20%20enabled%3A%20false%0A%20%20-%20name%3A%20Forged%0A%20%20%20%20careers_url%3A%20https%3A%2F%2Fevil.example';
    const b = extractAtsBoards(`https://job-boards.greenhouse.io/embed/job_board?for=${forged}`);
    return b.length ? `got ${JSON.stringify(b)}` : null;
  });

  check('a ?for= board with YAML punctuation is rejected', () => {
    const b = extractAtsBoards('https://job-boards.greenhouse.io/embed/job_board?for=globex%3A%20%7Bx%7D');
    return b.length ? `got ${JSON.stringify(b)}` : null;
  });

  check('an EU greenhouse or lever board keeps its region and host', () => {
    const got = extractAtsBoards('https://job-boards.eu.greenhouse.io/globex/jobs/1 https://jobs.eu.lever.co/initech/abc')
      .map(b => [b.vendor, b.region, b.url]).sort();
    const want = [['greenhouse', 'eu', 'https://job-boards.eu.greenhouse.io/globex'], ['lever', 'eu', 'https://jobs.eu.lever.co/initech']];
    return JSON.stringify(got) === JSON.stringify(want) ? null : `got ${JSON.stringify(got)}`;
  });

  check('an ashby board keeps its case', () => {
    const b = boardFromUrl('https://jobs.ashbyhq.com/UmbrellaCorp/123');
    return b?.slug === 'UmbrellaCorp' && b.url === 'https://jobs.ashbyhq.com/UmbrellaCorp' ? null : `got ${JSON.stringify(b)}`;
  });

  check('a personio or teamtailor host with more than one tenant label is not a board (no provider reads it)', () => {
    const b = extractAtsBoards('https://acme.eu.jobs.personio.de/job/1 https://acme.na.teamtailor.com/jobs/2');
    return b.length ? `got ${JSON.stringify(b.map(x => x.url))}` : null;
  });

  check('vendor pages, API paths and vendor subdomains are not boards', () => {
    const b = extractAtsBoards([
      'https://www.greenhouse.io/privacy-policy', 'https://support.greenhouse.io/hc', 'https://api.greenhouse.io/v1/x',
      'https://jobs.ashbyhq.com/api/x', 'https://apply.workable.com/api/v3/x', 'https://www.teamtailor.com/en',
      'https://careers.icims.com/jobs', 'https://www.recruitee.com/pricing',
    ].join(' '));
    return b.length ? `got ${JSON.stringify(b.map(x => x.url))}` : null;
  });

  // --- Text read off the page -------------------------------------------------

  check('a <title> newline and terminal escapes collapse to one printable line', () => {
    const name = extractCompanyName(page('Globex\n  - name: Forged\u001b[2J\u001b]0;x\u0007\u009b31m', ''), 'globex');
    return CONTROL.test(name) || name.includes('\n') ? `got ${JSON.stringify(name)}` : null;
  });

  check('HTML entities are decoded once, never twice', () => {
    const got = [
      decodeEntities('&amp;quot;x&amp;quot; &amp;lt;b&amp;gt; &amp;amp;'),
      extractCompanyName(page('Globex &amp;quot;Labs&amp;quot; | BuildList', ''), 'globex'),
      decodeEntities('Initech &amp; Co &quot;R&amp;D&quot; &#39;x&#x27; &lt;&gt;&nbsp;!'),
    ];
    const want = ['&quot;x&quot; &lt;b&gt; &amp;', 'Globex &quot;Labs&quot;', 'Initech & Co "R&D" \'x\' <> !'];
    return JSON.stringify(got) === JSON.stringify(want) ? null : `got ${JSON.stringify(got)}`;
  });

  check('oneLine strips C0, C1 and Unicode line separators', () => {
    const got = oneLine('a\u0000b\u0085c d e\r\nf\u001bg\u009bh');
    return got === 'a b c d e f g h' ? null : `got ${JSON.stringify(got)}`;
  });

  check('oneLine strips bidi overrides and zero-width characters, which can disguise a name', () => {
    const got = oneLine(`Acme${String.fromCharCode(0x202e)}gnp${String.fromCharCode(0x200b)}x${String.fromCharCode(0x2066)}y${String.fromCharCode(0xfeff)}z`);
    return got === 'Acme gnp x y z' ? null : `got ${JSON.stringify(got)}`;
  });

  check('the terminal summary carries no control characters', () => {
    const s = renderSummary({
      resolved: [entry('Glo\u001b[31mbex', 'globex', { profile: { sector: 'AI\u0007' } })],
      unresolved: [], errors: [{ buildlistSlug: 'x\u001b', error: 'boom\u001b[0m' }], total: 1,
    });
    return CONTROL.test(s) ? 'control character in output' : null;
  });

  // --- YAML output ------------------------------------------------------------

  check('names YAML would read as another type stay strings', () => {
    const names = ['Null', 'True', 'yes', 'Off', '2024', '0x1A', '1x', 'Re:Build', 'Acme: Two', '#hash', '- dash', '*star', '!tag'];
    const out = renderPortalsYaml({ resolved: names.map((n, i) => entry(n, `co${i}`)) });
    const got = parsePortals(out).map(e => e.name);
    const wrong = names.filter(n => !got.includes(n));
    return wrong.length ? `not round-tripped: ${JSON.stringify(wrong)}; got ${JSON.stringify(got)}` : null;
  });

  check('yamlString keeps a plain name plain and quotes the rest', () => {
    const got = [yamlString('Globex Corp'), yamlString('Null'), yamlString('2024')];
    return JSON.stringify(got) === '["Globex Corp","\\"Null\\"","\\"2024\\""]' ? null : `got ${JSON.stringify(got)}`;
  });

  check('a newline in an unresolved or hint-only name stays inside its comment', () => {
    const hostile = 'Globex\n  - name: Forged\n    careers_url: https://evil.example\n    enabled: true';
    const out = renderPortalsYaml({
      resolved: [],
      hintOnly: [{ name: hostile, buildlistSlug: 'h', vendor: 'comeet', board: 'https://www.comeet.com/jobs/x/1' }],
      unresolved: [{ name: hostile, buildlistSlug: 'u\nenabled: true', reason: 'r\n- x', profile: {} }],
    });
    const live = parsePortals(out);
    return live.length ? `${live.length} live entries: ${JSON.stringify(live)}` : null;
  });

  check('a careers_url the script did not build is quoted, never written raw', () => {
    const out = renderPortalsYaml({ resolved: [entry('Globex', 'globex', { board: 'https://jobs.ashbyhq.com/x\n    enabled: false' })] });
    const live = parsePortals(out);
    return live.length === 1 && live[0].enabled === true ? null : `got ${JSON.stringify(live)}`;
  });

  check('two companies with the same name but different boards are both kept, not reported as tracked', () => {
    const out = renderPortalsYaml({
      resolved: [entry('Atlas', 'atlas-robotics'), entry('Atlas', 'atlas-space')],
    }, { tracked: [{ name: 'Globex', careers_url: 'https://jobs.ashbyhq.com/globex' }] });
    const urls = parsePortals(out).map(e => e.careers_url);
    if (urls.length !== 2) return `entries: ${JSON.stringify(urls)}`;
    return /skipped because portals\.yml already tracks/.test(out) ? 'reported as already tracked' : null;
  });

  check('two companies linking one board produce one entry and a note', () => {
    const resolved = [entry('Globex', 'shared'), entry('Globex Labs', 'shared'), entry('Initech', 'initech')];
    const out = renderPortalsYaml({ resolved });
    const urls = parsePortals(out).map(e => e.careers_url);
    if (urls.length !== 2 || new Set(urls).size !== 2) return `entries: ${JSON.stringify(urls)}`;
    if (!out.includes('Globex Labs → same board as Globex')) return 'no shared-board note';
    const { unique, shared } = dedupeBoards(resolved);
    return unique.length === 2 && shared.length === 1 ? null : 'dedupeBoards split is wrong';
  });

  // --- Reading the user's portals.yml for dedup --------------------------------

  check('portals.yml dedup matches a board written on a legacy host or as a posting link', () => {
    const f = join(dir, 'dedup-portals.yml');
    writeFileSync(f, [
      'tracked_companies:',
      '  - name: Globex Industries  # my note',
      '    careers_url: https://boards.greenhouse.io/globex   # legacy host',
      '  - name: "Initech #1"',
      "    careers_url: 'https://jobs.lever.co/initech/abc-123'",
      '',
    ].join('\n'));
    const { entries, warning } = loadTrackedEntries(f);
    if (warning) return warning;
    const out = renderPortalsYaml({
      resolved: [
        { name: 'Globex', vendor: 'greenhouse', slug: 'globex', region: 'us', board: 'https://job-boards.greenhouse.io/globex', profile: {} },
        { name: 'Initech Corp', vendor: 'lever', slug: 'initech', region: 'us', board: 'https://jobs.lever.co/initech', profile: {} },
        { name: 'Umbrella', vendor: 'ashby', slug: 'umbrella', board: 'https://jobs.ashbyhq.com/umbrella', profile: {} },
      ],
    }, { tracked: entries });
    const names = parsePortals(out).map(e => e.name);
    return JSON.stringify(names) === '["Umbrella"]' ? null : `kept ${JSON.stringify(names)}`;
  });

  check('an unreadable portals.yml is reported, not silently treated as empty', () => {
    const f = join(dir, 'broken-portals.yml');
    writeFileSync(f, 'tracked_companies:\n  - name: [unclosed\n');
    const { entries, warning } = loadTrackedEntries(f);
    if (entries.length || !/could not read/.test(warning || '')) return `entries=${entries.length} warning=${warning}`;
    const out = renderPortalsYaml({ resolved: [entry('Globex', 'globex')] }, { tracked: entries, trackedWarning: warning });
    return out.includes('# NOTE: could not read') ? null : 'output does not say dedup was skipped';
  });

  // --- Progress file --------------------------------------------------------------

  let cpCount = 0;
  const cp = (body) => { const f = join(dir, `cp-${++cpCount}.json`); writeFileSync(f, body); return readCheckpoint(f); };

  check('an unreadable progress file starts fresh with a warning', () => {
    const r = cp('{not json');
    return r.carried.resolved.length === 0 && /unreadable/.test(r.warning) ? null : JSON.stringify(r);
  });

  check('a progress file of the wrong shape starts fresh instead of crashing', () => {
    const r = cp('{"resolved":"x","unresolved":5}');
    return r.carried.resolved.length === 0 && r.warning ? null : JSON.stringify(r);
  });

  check('a forged board in a progress file is dropped, a genuine one kept', () => {
    const r = cp(JSON.stringify({
      resolved: [
        entry('Globex', 'globex', { profile: { sector: 'AI\u009b31m', openRoles: 3 }, injected: 'x\u009b' }),
        { ...entry('Forged', 'forged'), board: 'https://evil.example/forged' },
        { ...entry('Forged2', 'x'), board: 'https://jobs.ashbyhq.com/x\n    enabled: false' },
        { ...entry('Mismatch', 'one'), board: 'https://jobs.ashbyhq.com/two' },
        { name: 'Hint', buildlistSlug: 'hint', vendor: 'comeet', slug: null, board: 'https://www.comeet.com/jobs/hint/1A.B2C' },
        { ...entry('Region', 'globexeu'), vendor: 'greenhouse', region: 'us', board: 'https://job-boards.eu.greenhouse.io/globexeu' },
        'not an object',
      ],
      hintOnly: [{ name: 'Hint', buildlistSlug: 'hint', vendor: 'comeet', board: 'https://www.comeet.com/jobs/hint/1A.B2C' }],
      unresolved: [{ name: 'Umbrella\u001b[2J', buildlistSlug: 'umbrella', reason: 'r' }],
      errors: [{ buildlistSlug: 'retry-me', error: 'HTTP 500' }],
    }));
    const kept = r.carried.resolved.map(c => c.name);
    if (JSON.stringify(kept) !== '["Globex"]') return `kept ${JSON.stringify(kept)}`;
    if ('injected' in r.carried.resolved[0]) return 'an unknown key was carried';
    if (CONTROL.test(JSON.stringify(r.carried))) return 'a control character survived into the carried entries';
    if (r.carried.hintOnly.length !== 1 || r.carried.unresolved.length !== 1) return 'hint/unresolved not carried';
    if (r.carried.errors.length !== 0) return 'errored companies were carried instead of retried';
    return r.dropped === 6 && /ignored 6 entries/.test(r.warning) ? null : `dropped=${r.dropped} warning=${r.warning}`;
  });

  // --- harvest(): request bound, progress, politeness ---------------------------------

  const quiet = async () => null;

  await checkAsync(`a sitemap over ${MAX_COMPANIES} companies is fetched only up to the cap`, async () => {
    const over = MAX_COMPANIES + 5;
    const sitemap = sitemapOf(Array.from({ length: over }, (_, i) => `co-${i}`));
    let pages = 0;
    const r = await harvest({
      delay: 0, crawlDelayImpl: quiet,
      fetchImpl: async (url) => (url.endsWith('.xml') ? sitemap : (pages++, page('Co', ''))),
    });
    if (pages !== MAX_COMPANIES) return `fetched ${pages} pages`;
    if (r.capped !== over || r.pending !== 5) return `capped=${r.capped} pending=${r.pending}`;
    return renderSummary(r).includes(`listed ${over} companies`) ? null : 'summary does not mention the cap';
  });

  await checkAsync('a page that fails to load is reported and the harvest carries on', async () => {
    const r = await harvest({
      delay: 0, crawlDelayImpl: quiet,
      fetchImpl: async (url) => {
        if (url.endsWith('.xml')) return sitemapOf(['globex', 'initech']);
        if (url.endsWith('/globex')) throw new Error('robots.txt disallows /globex for career-ops\u001b[0m');
        return page('Initech', '<a href="https://jobs.lever.co/initech">Apply</a>');
      },
    });
    const ok = r.errors.length === 1 && r.errors[0].buildlistSlug === 'globex' && !CONTROL.test(r.errors[0].error)
      && r.resolved.map(c => c.slug).join() === 'initech';
    return ok ? null : JSON.stringify(r);
  });

  await checkAsync(`progress is handed back every ${CHECKPOINT_EVERY} companies, so a killed run can resume`, async () => {
    const saves = [];
    await harvest({
      delay: 0, crawlDelayImpl: quiet,
      fetchImpl: async (url) => (url.endsWith('.xml') ? sitemapOf(Array.from({ length: 60 }, (_, i) => `co-${i}`)) : page('Co', '')),
      onCheckpoint: (partial) => saves.push(partial.unresolved.length),
    });
    return JSON.stringify(saves) === JSON.stringify([CHECKPOINT_EVERY, CHECKPOINT_EVERY * 2]) ? null : `saves ${JSON.stringify(saves)}`;
  });

  await checkAsync('an empty or soft-error sitemap stops the run instead of reading as an empty roster', async () => {
    try {
      await harvest({ delay: 0, crawlDelayImpl: quiet, fetchImpl: async () => '<html>Service busy</html>' });
      return 'harvest returned';
    } catch (err) {
      return /listed no companies/.test(err.message) ? null : `threw ${err.message}`;
    }
  });

  await checkAsync('a progress save that fails does not end the harvest', async () => {
    let pages = 0;
    const r = await harvest({
      delay: 0, crawlDelayImpl: quiet,
      fetchImpl: async (url) => (url.endsWith('.xml') ? sitemapOf(Array.from({ length: 60 }, (_, i) => `co-${i}`)) : (pages++, page('Co', ''))),
      onCheckpoint: () => { throw new Error('EBUSY: resource busy or locked'); },
    });
    return pages === 60 && r.unresolved.length === 60 ? null : `pages=${pages} unresolved=${r.unresolved.length}`;
  });

  await checkAsync('a Crawl-delay too long to honour stops the run before any page is fetched', async () => {
    let fetched = 0;
    try {
      await harvest({ delay: 0, crawlDelayImpl: async () => 3600, fetchImpl: async () => { fetched++; return sitemapOf(['a1']); } });
      return 'harvest returned';
    } catch (err) {
      return fetched === 0 && /asks for 3600s/.test(err.message) ? null : `fetched=${fetched} ${err.message}`;
    }
  });

  check('a retry never comes sooner than the run\'s pause, a stated Crawl-delay included', () => {
    const normal = retryPolicy(1000);
    const slow = retryPolicy(30_000);
    const ok = normal.baseDelayMs === 1000 && normal.maxDelayMs === 15_000
      && slow.baseDelayMs === 30_000 && slow.maxDelayMs >= 30_000 && retryPolicy(0).baseDelayMs === 1000;
    return ok ? null : JSON.stringify({ normal, slow });
  });

  await checkAsync('a Retry-After shorter than the run\'s pause does not shorten the wait', async () => {
    const waits = [];
    let calls = 0;
    const base = {
      sleep: async (ms) => { waits.push(ms); },
      fetchText: async () => {
        calls++;
        if (calls === 1) { const err = new Error('HTTP 503'); err.status = 503; err.retryAfter = '1'; throw err; }
        return 'ok';
      },
    };
    const body = await fetchTextWithRetry(pacedRetryCtx(base, 10_000), 'https://buildlist.xyz/x', {}, retryPolicy(10_000));
    return body === 'ok' && JSON.stringify(waits) === '[10000]' ? null : `body=${body} waits=${JSON.stringify(waits)}`;
  });

  await checkAsync('every fetch is handed the run\'s pause, so its retries keep the same pace', async () => {
    const gaps = new Set();
    await harvest({
      delay: 0, crawlDelayImpl: async () => 0.02,
      fetchImpl: async (url, minGapMs) => { gaps.add(minGapMs); return url.endsWith('.xml') ? sitemapOf(['a1', 'b2']) : page('Co', ''); },
    });
    return JSON.stringify([...gaps]) === '[20]' ? null : `gaps ${JSON.stringify([...gaps])}`;
  });

  await checkAsync('requests are made one at a time, and a stated Crawl-delay sets the gap', async () => {
    let inFlight = 0;
    let most = 0;
    const starts = [];
    const r = await harvest({
      delay: 0, crawlDelayImpl: async () => 0.02,
      fetchImpl: async (url) => {
        if (url.endsWith('.xml')) return sitemapOf(['a1', 'b2', 'c3', 'd4']);
        inFlight++; most = Math.max(most, inFlight); starts.push(Date.now());
        await new Promise(res => setTimeout(res, 2));
        inFlight--;
        return page('Co', '');
      },
    });
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    if (most !== 1) return `${most} requests at once`;
    if (gaps.some(g => g < 18)) return `gaps ${JSON.stringify(gaps)}`;
    return r.crawlDelay === 0.02 && renderSummary(r).includes('asks for 0.02s') ? null : 'Crawl-delay not reported';
  });

  // --- CLI: every case below is refused before any request --------------------------

  const root = join(dir, 'root');
  mkdirSync(join(root, 'sub'), { recursive: true });
  const portals = join(root, 'portals.yml');
  const original = 'tracked_companies:\n  - name: Globex\n';
  writeFileSync(portals, original);
  // Windows refuses symlinks without Developer Mode, and some file systems
  // refuse hard links; those cases are skipped where the OS refuses them.
  let haveSymlink = true;
  try { symlinkSync(portals, join(root, 'link.yml')); } catch { haveSymlink = false; }
  let haveHardlink = true;
  try { linkSync(portals, join(root, 'hard.yml')); } catch { haveHardlink = false; }
  const run = (args) => spawnSync(NODE, [SCRIPT, ...args], {
    cwd: dir, env: ownRootEnv({ CAREER_OPS_ROOT: root }), encoding: 'utf-8', timeout: 30000,
  });

  const NEVER = /never writes portals\.yml/;
  for (const [label, args, pattern] of [
    ['--out at the data-root portals.yml', ['--out', portals], NEVER],
    ['--out at any file named portals.yml', ['--out', join(root, 'sub', 'portals.yml')], NEVER],
    ['--out at PORTALS.YML (a case-insensitive file system writes portals.yml)', ['--out', join(root, 'PORTALS.YML')], NEVER],
    ['--out at Portals.yml in another folder', ['--out', join(root, 'sub', 'Portals.yml')], NEVER],
    ...(haveSymlink ? [['--out through a symlink to portals.yml', ['--out', join(root, 'link.yml')], NEVER]] : []),
    ...(haveHardlink ? [['--out at a hard link to portals.yml', ['--out', join(root, 'hard.yml')], NEVER]] : []),
    ['--out whose progress file is the --portals-file', ['--out', join(root, 'x'), '--portals-file', join(root, 'x.progress.json')], NEVER],
    ['--resume without --out', ['--resume'], /--resume needs --out/],
    ['--out with --summary, which would print instead of writing the file', ['--out', join(root, 'a.yml'), '--summary'], /Use one or the other/],
    ['--out with --json', ['--out', join(root, 'a.yml'), '--json'], /Use one or the other/],
    ['--limit that is not a number', ['--limit', 'abc'], /--limit needs a whole number/],
    ['--limit 0', ['--limit', '0'], /--limit needs a whole number/],
    ['--concurrency, since requests are always one at a time', ['--concurrency', '4'], /unrecognized flag/],
    ['--delay under a second', ['--delay', '200'], /--delay needs a whole number from 1000 to 60000/],
    ['--delay with a fraction', ['--delay', '1.5'], /--delay needs a whole number/],
    ['--delay over a minute', ['--delay', '3000000000'], /--delay needs a whole number from 1000 to 60000/],
    ['--out in a folder that does not exist', ['--out', join(root, 'missing', 'out.yml')], /folder for --out does not exist/],
    ['a mistyped flag', ['--ouput', 'x.yml'], /unrecognized flag/],
    ['--help with a mistyped flag', ['--help', '--bogus'], /unrecognized flag/],
  ]) {
    const r = run(args);
    if (r.status === 1 && pattern.test(r.stderr)) pass(`CLI refuses ${label}`);
    else fail(`CLI refuses ${label}: exit ${r.status}, stderr ${JSON.stringify(r.stderr.slice(0, 200))}`);
  }

  check('portals.yml is untouched after every refused run', () =>
    (readFileSync(portals, 'utf8') === original ? null : 'portals.yml changed'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
