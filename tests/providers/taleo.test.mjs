// tests/providers/taleo.test.mjs — pure resolve/parse tests, no network.
import { pass, fail, run, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleo');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'adapters/node/providers/taleo.mjs')).href);
  const { resolveSite, parseSearchPage, parseTaleoResponse } = mod;

  // resolveSite: classic taleo.net tenant
  const hit = resolveSite({ name: 'SCB', careers_url: 'https://scb.taleo.net/careersection/ex/jobsearch.ftl?lang=en' });
  if (hit && hit.section === 'ex' && /taleo\.net$/.test(hit.origin)) pass('taleo resolveSite parses taleo.net career section');
  else fail(`taleo resolveSite=${JSON.stringify(hit)}`);

  // resolveSite: non-taleo host -> null
  if (resolveSite({ name: 'X', careers_url: 'https://example.com/careersection/ex/jobsearch.ftl' }) === null) pass('taleo resolveSite null for foreign host');
  else fail('taleo resolveSite should reject foreign host');

  // resolveSite: busy port -> null
  if (resolveSite({ name: 'X', careers_url: 'https://scb.taleo.net:8080/careersection/ex/jobsearch.ftl' }) === null) pass('taleo resolveSite null for unsafe port');
  else fail('taleo resolveSite should reject non-https/port');

  // parseSearchPage extracts portal id
  const page = parseSearchPage('<script>var data = { portalNo: "6789" };</script><table id="jobs"><tr><th>Icons</th><th>Job</th><th>Posting Date</th></tr></table>');
  if (page.portal === '6789') pass('taleo parseSearchPage extracts portal id');
  else fail(`taleo parseSearchPage portal=${page.portal}`);

  // parseTaleoResponse happy path
  const json = {
    requisitionList: [{
      contestNo: '200123',
      linkedColumn: 1,
      column: { 0: '["Shanghai"]', 1: 'Software Engineer', 2: '09/08/2026' },
      locationsColumns: [0],
    }],
  };
  const jobs = parseTaleoResponse(json, { origin: 'https://scb.taleo.net', section: 'ex' }, 'SCB', 2);
  if (jobs.length === 1 && jobs[0].title === 'Software Engineer' && jobs[0].location === 'Shanghai'
      && jobs[0].url.includes('/careersection/ex/jobdetail.ftl?job=200123')) {
    pass('taleo parseTaleoResponse normalizes a requisition');
  } else fail(`taleo parseTaleoResponse=${JSON.stringify(jobs)}`);

  // parseTaleoResponse rejects unavailable board
  try {
    const bad = parseTaleoResponse({ careerSectionUnAvailable: true }, {}, 'SCB', -1);
    fail(`taleo should throw on unavailable, got ${JSON.stringify(bad)}`);
  } catch { pass('taleo parseTaleoResponse throws on unavailable board'); }

  // parseTaleoResponse rejects malformed requisition
  try {
    parseTaleoResponse({ requisitionList: [{ contestNo: '', column: {} }] }, {}, 'SCB', -1);
    fail('taleo should throw on malformed requisition');
  } catch { pass('taleo parseTaleoResponse throws on malformed row'); }

} catch (e) {
  fail(`taleo provider tests crashed: ${e.message}`);
}
