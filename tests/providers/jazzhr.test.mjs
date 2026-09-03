import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jazzhr');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jazzhr.mjs')).href);
  const provider = mod.default;
  const board = 'https://exampleco.applytojob.com/apply';
  if (provider.id === 'jazzhr') pass('jazzhr.id is "jazzhr"'); else fail('wrong provider id');
  if (provider.detect({ name: 'Example', careers_url: board })?.url === board) pass('detects *.applytojob.com/apply board'); else fail('detect failed');
  for (const bad of ['http://exampleco.applytojob.com/apply', 'https://evil.example/apply', 'https://exampleco.applytojob.com/login', null, 7]) {
    if (provider.detect({ name: 'X', careers_url: bad }) === null) pass(`rejects ${String(bad)}`); else fail(`accepted ${String(bad)}`);
  }
  const list = `<ul><li class="list-group-item"><h3 class="list-group-item-heading"><a href="https://exampleco.applytojob.com/apply/A1/Learning-Designer">Learning &amp; Development Designer</a></h3><ul><li><i class="fa fa-map-marker"></i>Toronto, ON</li></ul></li><li class="list-group-item"><h3><a href="/apply/B2/Analyst">Analyst</a></h3><ul><li><i class="fa fa-map-marker"></i>Remote</li></ul></li></ul>`;
  const jobs = mod.parseJazzHRList(list, board, 'Example Co');
  if (jobs.length === 2 && jobs[0].title === 'Learning & Development Designer' && jobs[0].location === 'Toronto, ON') pass('parses list titles, entities, locations, and relative/absolute links'); else fail(`list parse failed ${JSON.stringify(jobs)}`);
  if (jobs[1].url === 'https://exampleco.applytojob.com/apply/B2/Analyst') pass('pins posting URLs to the board host'); else fail('URL pinning failed');
  const detail = `<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Learning & Development Designer',description:'<p>Build &amp; deliver courses.</p>',datePosted:'2026-08-30',jobLocation:{address:{addressLocality:'Toronto',addressRegion:'ON',addressCountry:'CA'}}})}</script>`;
  const enriched = mod.parseJazzHRDetail(detail, { ...jobs[0] });
  if (enriched.description === 'Build & deliver courses.' && enriched.postedAt && enriched.location === 'Toronto, ON, CA') pass('parses JSON-LD description, date, and location'); else fail(`detail parse failed ${JSON.stringify(enriched)}`);
  if (mod.parseJazzHRList('', board, 'X').length === 0 && mod.parseJazzHRList('<html>no openings</html>', board, 'X').length === 0) pass('empty/contentless board returns []'); else fail('empty board failed');
  const calls = [];
  const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return calls.length === 1 ? list : detail; }, sleep: async () => {} };
  const fetched = await provider.fetch({ name: 'Example Co', careers_url: board, jazzhr: { fetchDetails: true, detailLimit: 1 } }, ctx);
  if (fetched.length === 2 && calls.length === 2 && calls.every(c => c.opts.redirect === 'error')) pass('fetches public list and optional detail with redirect:error'); else fail(`fetch contract failed ${JSON.stringify(calls)}`);
  const probeCalls = [];
  await provider.fetch({ name: 'Example Co', careers_url: board, jazzhr: { fetchDetails: true } }, { maxPages: 1, fetchText: async (url, opts) => { probeCalls.push({ url, opts }); return list; } });
  if (probeCalls.length === 1) pass('probe skips optional detail requests'); else fail('probe detail request was not skipped');
  let guarded = false;
  try { await provider.fetch({ name: 'X', careers_url: 'https://evil.example/apply' }, { fetchText: async () => { throw new Error('should not fetch'); } }); } catch { guarded = true; }
  if (guarded) pass('SSRF guard rejects untrusted host before network'); else fail('SSRF guard failed');
} catch (e) { fail(`jazzhr provider tests crashed: ${e.message}`); }
