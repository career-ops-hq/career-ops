// Verify pinned PCSX routing, posting URLs, and page coverage without network.
import assert from 'node:assert/strict';
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — pcsx');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'adapters/node/providers/pcsx.mjs')).href);
  const { parsePcsxResponse } = mod;
  const provider = mod.default;

  if (provider.id === 'pcsx') pass('pcsx.id correct');
  else fail(`pcsx.id=${provider.id}`);

  // detect on a jobs.careers.microsoft.com URL resolves to PCS API
  const hit = provider.detect({ name: 'Microsoft', careers_url: 'https://jobs.careers.microsoft.com/global/en/search' });
  if (hit && hit.url.includes('/api/pcsx/search') && hit.url.includes('domain=microsoft.com')) {
    pass('pcsx detect() maps Microsoft jobs host to its API');
  } else fail(`pcsx detect=${JSON.stringify(hit)}`);

  const qualcomm = provider.detect({ name: 'Qualcomm', careers_url: 'https://careers.qualcomm.com/careers' });
  if (qualcomm?.url === 'https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com') {
    pass('pcsx detect() pins Qualcomm to its own official domain');
  } else fail(`pcsx Qualcomm detect=${JSON.stringify(qualcomm)}`);

  const ericsson = provider.detect({ name: 'Ericsson', careers_url: 'https://jobs.ericsson.com/careers' });
  if (ericsson?.url === 'https://jobs.ericsson.com/api/pcsx/search?domain=ericsson.com') {
    pass('pcsx detect() pins Ericsson to its official domain');
  } else fail(`pcsx Ericsson detect=${JSON.stringify(ericsson)}`);

  const kering = provider.detect({ name: 'Kering', api: 'https://careers.kering.com/api/pcsx/search?domain=kering.com' });
  if (kering?.url === 'https://careers.kering.com/api/pcsx/search?domain=kering.com') {
    pass('pcsx detect() pins Kering to its official group API');
  } else fail(`pcsx Kering detect=${JSON.stringify(kering)}`);

  // detect rejects foreign host
  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) pass('pcsx rejects foreign host');
  else fail('pcsx should reject foreign host');

  // One shared response shape with employer-specific trusted posting origins.
  const json = {
    status: 200,
    data: {
      count: 1,
      positions: [{
        name: 'Software Engineer',
        positionUrl: '/careers/job/123456',
        locations: ['Beijing', 'Shanghai'],
        postedTs: 1700000000,
      }],
    },
  };
  const jobs = parsePcsxResponse(json, 'Microsoft', 'https://apply.careers.microsoft.com');
  if (jobs.length === 1 && jobs[0].title === 'Software Engineer'
      && jobs[0].url === 'https://apply.careers.microsoft.com/careers/job/123456'
      && jobs[0].location === 'Beijing; Shanghai' && jobs[0].postedAt === 1700000000 * 1000) {
    pass('pcsx normalizes a Microsoft position');
  } else fail(`pcsx parse=${JSON.stringify(jobs)}`);

  const qualcommJobs = parsePcsxResponse(json, 'Qualcomm', 'https://careers.qualcomm.com');
  if (qualcommJobs[0]?.url === 'https://careers.qualcomm.com/careers/job/123456') {
    pass('pcsx keeps Qualcomm posting links on its official host');
  } else fail('pcsx built a wrong Qualcomm posting link');

  const ericssonJobs = parsePcsxResponse(json, 'Ericsson', 'https://jobs.ericsson.com');
  if (ericssonJobs[0]?.url === 'https://jobs.ericsson.com/careers/job/123456') {
    pass('pcsx keeps Ericsson posting links on its official host');
  } else fail('pcsx built a wrong Ericsson posting link');

  const keringJobs = parsePcsxResponse(json, 'Kering', 'https://careers.kering.com');
  if (keringJobs[0]?.url === 'https://careers.kering.com/careers/job/123456') {
    pass('pcsx keeps Kering posting links on its official host');
  } else fail('pcsx built a wrong Kering posting link');

  // parse rejects error envelope
  try {
    parsePcsxResponse({ status: 500 }, 'Microsoft', 'https://apply.careers.microsoft.com');
    fail('pcsx should throw on error envelope');
  } catch { pass('pcsx throws on error envelope'); }

  // parse rejects untrusted position URL
  try {
    parsePcsxResponse({ status: 200, data: { count: 1, positions: [{ name: 'X', positionUrl: 'https://evil.com/job/1' }] } }, 'Microsoft', 'https://apply.careers.microsoft.com');
    fail('pcsx should throw on untrusted URL');
  } catch { pass('pcsx throws on untrusted position URL'); }

  const capped = await provider.fetch(
    { name: 'Microsoft', careers_url: 'https://jobs.careers.microsoft.com/global/en/search' },
    { maxPages: 1, fetchJson: async () => ({ ...json, data: { ...json.data, count: 2 } }) },
  );
  if (capped.length === 1 && capped.collectionTruncated === true && capped.collectionTruncationKind === 'page_cap') {
    pass('pcsx reports an incomplete page-capped collection');
  } else fail('pcsx silently accepted a page-capped collection');

  const position = id => ({ name: 'Software Engineer', positionUrl: `/careers/job/${id}` });
  for (const { count, tail } of [
    { count: 5, tail: [position(1), position(2)] },
    { count: 3, tail: [position(2)] },
  ]) {
    let page = 0;
    const shifted = await provider.fetch(
      { name: 'Qualcomm', careers_url: 'https://careers.qualcomm.com/careers' },
      { sleep: async () => {}, fetchJson: async () => ({ status: 200, data: {
        count, positions: page++ === 0 ? [position(1), position(2)] : tail,
      } }) },
    );
    if (shifted.length === 2 && shifted.collectionTruncated === true
        && shifted.collectionTruncationKind === 'coverage_gap') {
      pass('pcsx keeps fetched rows and reports a coverage gap when pages overlap');
    } else fail('pcsx lost rows or marked overlapping pages complete');
  }

  let requestedPages = 0;
  const interrupted = await provider.fetch(
    { name: 'Qualcomm', careers_url: 'https://careers.qualcomm.com/careers' },
    { sleep: async () => {}, fetchJson: async () => {
      if (++requestedPages === 2) throw Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 });
      return { status: 200, data: { count: 20, positions: [position(1), position(2)] } };
    } },
  );
  if (requestedPages === 2 && interrupted.length === 2 && interrupted.collectionTruncated === true
      && interrupted.collectionTruncationKind === 'auth') {
    pass('pcsx preserves earlier pages when a later page is forbidden');
  } else fail('pcsx discarded earlier pages after a later HTTP error');
  await assert.rejects(provider.fetch(
    { name: 'Qualcomm', careers_url: 'https://careers.qualcomm.com/careers' },
    { fetchJson: async () => { throw Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 }); } },
  ), /HTTP 403/);

  let attempts = 0;
  const retried = await provider.fetch(
    { name: 'Qualcomm', careers_url: 'https://careers.qualcomm.com/careers' },
    { maxPages: 1, sleep: async () => {}, fetchJson: async () => {
      if (++attempts === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
      return json;
    } },
  );
  if (attempts === 2 && retried.length === 1) pass('pcsx retries a transient 429');
  else fail(`pcsx retry attempts=${attempts} jobs=${retried.length}`);

} catch (e) {
  fail(`pcsx provider tests crashed: ${e.message}`);
}
