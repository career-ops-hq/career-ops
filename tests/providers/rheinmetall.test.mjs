// tests/providers/rheinmetall.test.mjs — moved verbatim from test-all.mjs (#1549).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — rheinmetall (SSR vacancy-list parser)');
try {
  const rheinmetallModule = await import(pathToFileURL(join(ROOT, 'providers/rheinmetall.mjs')).href);
  const rheinmetall = rheinmetallModule.default;
  const { resolveListUrl, parseVacancies } = rheinmetallModule;

  if (rheinmetall.id === 'rheinmetall') pass('rheinmetall.id is "rheinmetall"');
  else fail(`rheinmetall.id is ${JSON.stringify(rheinmetall.id)}`);

  // resolveListUrl — keeps an explicit vacancies URL, defaults everything else
  // on the rheinmetall.com host to /en, rejects foreign hosts.
  if (resolveListUrl({ api: 'https://www.rheinmetall.com/de/career/vacancies' }) === 'https://www.rheinmetall.com/de/career/vacancies') pass('rheinmetall.resolveListUrl() keeps an explicit locale list URL');
  else fail('rheinmetall.resolveListUrl() should keep /de/career/vacancies');
  if (resolveListUrl({ careers_url: 'https://www.rheinmetall.com/en/career' }) === 'https://www.rheinmetall.com/en/career/vacancies') pass('rheinmetall.resolveListUrl() defaults non-list URLs to /en/career/vacancies');
  else fail('rheinmetall.resolveListUrl() should default to the EN list');
  if (resolveListUrl({ careers_url: 'https://evil.com/x.rheinmetall.com' }) === null) pass('rheinmetall.resolveListUrl() rejects path-spoofed host');
  else fail('rheinmetall.resolveListUrl() should reject path-spoofed host');
  if (rheinmetall.detect({ careers_url: 'https://rheinmetall.com.evil.com/en/career/vacancies' }) === null) pass('rheinmetall.detect() rejects suffix-spoofed host');
  else fail('rheinmetall.detect() should reject suffix-spoofed host');

  // parseVacancies — the tricky part is that ONE card holds THREE anchors to
  // the same job; a cross-card regex would pair card A's trailing anchor with
  // card B's title. Fixture mirrors the live markup shape.
  const card = (id, title, org) =>
    '<div class="flex gap-0.5 group">' +
    `<a href="/en/job/slug_${id}/${id}" target="_blank">img</a>` +
    `<div><a href="/en/job/slug_${id}/${id}"><div class="text-sm font-bold md:text-xl mb-2">${title}</div></a>` +
    `<div class="flex flex-wrap mr-6"> ${org} </div></div>` +
    `<a href="/en/job/slug_${id}/${id}">arrow</a>` +
    '</div>';
  const pageHtml = '<html>' + card('111', 'Fertigungssteuerer (m/w/d)', 'Rheinmetall Landsysteme GmbH | Kassel') + card('222', 'Softwareentwickler &amp; Architekt', 'Rheinmetall Air Defence AG | Z&#252;rich') + '</html>';
  const rows = parseVacancies(pageHtml, 'https://www.rheinmetall.com');
  if (rows.length === 2) pass('rheinmetall.parseVacancies() yields one row per card (3 anchors collapse)');
  else fail(`rheinmetall.parseVacancies() returned ${rows.length}, expected 2`);
  if (rows[0]?.title === 'Fertigungssteuerer (m/w/d)' && rows[1]?.title === 'Softwareentwickler & Architekt') pass('rheinmetall.parseVacancies() pairs each id with ITS OWN title (no cross-card bleed)');
  else fail(`rheinmetall.parseVacancies() titles wrong: ${JSON.stringify(rows.map((r) => r.title))}`);
  if (rows[0]?.location === 'Kassel' && rows[1]?.location === 'Zürich') pass('rheinmetall.parseVacancies() extracts the city from "Company | City" (entities decoded)');
  else fail(`rheinmetall.parseVacancies() locations wrong: ${JSON.stringify(rows.map((r) => r.location))}`);
  if (rows[0]?.url === 'https://www.rheinmetall.com/en/job/slug_111/111') pass('rheinmetall.parseVacancies() builds absolute job URLs');
  else fail(`rheinmetall.parseVacancies() url wrong: ${JSON.stringify(rows[0]?.url)}`);
  if (parseVacancies('<html>no cards</html>', 'https://x').length === 0 && parseVacancies(undefined, 'https://x').length === 0) pass('rheinmetall.parseVacancies() returns [] for card-less / non-string input');
  else fail('rheinmetall.parseVacancies() should return [] without cards');

  // fetch — paginates ?page=N, stops when a page brings no fresh ids (the
  // server clamps past-the-end pages to the last page).
  const rhmPages = [pageHtml, '<html>' + card('333', 'C', 'X GmbH | Kiel') + '</html>', '<html>' + card('333', 'C', 'X GmbH | Kiel') + '</html>'];
  let rhmCalls = 0;
  const rhmSeen = [];
  const rhmCtx = { sleep: async () => {}, fetchText: async (url) => { rhmSeen.push(url); return rhmPages[rhmCalls++] ?? rhmPages[2]; } };
  const rhmJobs = await rheinmetall.fetch({ name: 'Rheinmetall', api: 'https://www.rheinmetall.com/en/career/vacancies' }, rhmCtx);
  if (rhmJobs.length === 3 && rhmCalls === 3) pass('rheinmetall.fetch() paginates and stops on a clamped (no-fresh-ids) page');
  else fail(`rheinmetall.fetch() returned ${rhmJobs.length} jobs after ${rhmCalls} calls`);
  if (rhmSeen[0]?.endsWith('?page=1') && rhmSeen[1]?.endsWith('?page=2')) pass('rheinmetall.fetch() pages via ?page=N (1-based)');
  else fail(`rheinmetall.fetch() paged wrong: ${JSON.stringify(rhmSeen)}`);
} catch (e) {
  fail(`rheinmetall provider tests crashed: ${e.message}`);
}
