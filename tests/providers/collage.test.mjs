import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — collage');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/collage.mjs')).href);
  const p = mod.default;
  if (p.id === 'collage') pass('collage.id is "collage"'); else fail('wrong provider id');
  const hit = p.detect({ name: 'Example Collage Co', api: 'https://api.collage.co/v1/positions/exampleco' });
  if (hit?.url === 'https://api.collage.co/v1/positions/exampleco') pass('detect accepts explicit API URL'); else fail(`detect=${JSON.stringify(hit)}`);
  const careers = p.detect({ name: 'Example Collage Co', careers_url: 'https://secure.collage.co/jobs/exampleco' });
  if (careers?.url === 'https://api.collage.co/v1/positions/exampleco') pass('detect derives address from explicit Collage careers URL'); else fail(`careers=${JSON.stringify(careers)}`);
  if (p.detect({ name: 'Spoof', careers_url: 'https://evil.example/pheedloop' }) === null) pass('detect rejects non-Collage URL'); else fail('accepted spoofed careers URL');
  if (p.detect({ name: 'Bad', api: 'https://evil.example/v1/positions/acme' }) === null) pass('detect rejects untrusted API host'); else fail('accepted untrusted API host');
  const sample = { positions: [
    { title: 'Learning Designer', location: 'Toronto, ON', department: 'People', commitment: 'Full-time', employmentType: 'Permanent', descriptionPlain: 'Build learning.', createdDate: '2026-09-01T12:00:00Z', hostedUrl: 'https://secure.collage.co/jobs/exampleco/1', applyUrl: 'https://apply.example/1' },
    { title: 'No URL' },
  ] };
  const jobs = mod.parseCollageResponse(sample, 'PheedLoop');
  if (jobs.length === 1) pass('parser drops rows without title or stable URL'); else fail(`parser returned ${jobs.length}`);
  if (jobs[0]?.description.includes('Department: People') && jobs[0]?.description.includes('Build learning.')) pass('parser carries plain JD and structured metadata'); else fail('description mapping failed');
  if (jobs[0]?.postedAt === Date.parse('2026-09-01T12:00:00Z')) pass('parser converts createdDate'); else fail(`postedAt=${jobs[0]?.postedAt}`);
  const relative = mod.parseCollageResponse({ positions: [{ title: 'Relative URL', hostedUrl: '/jobs/1', applyUrl: 'jobs/1' }] }, 'X');
  if (relative.length === 0) pass('parser drops relative job URLs'); else fail('parser accepted a relative job URL');
  try { if (mod.parseCollageResponse({ positions: [] }, 'X').length === 0) pass('empty positions envelope returns []'); else fail('empty positions envelope failed'); } catch { fail('empty positions envelope should be valid'); }
  try {
    mod.parseCollageResponse({}, 'X');
    fail('unknown envelope should throw');
  } catch (e) {
    if (/positions array|collage: unrecognized response envelope/i.test(e.message)) pass('unknown response envelope throws descriptively');
    else fail(`unknown envelope error was not descriptive: ${e.message}`);
  }
  let fetchedUrl = ''; let fetchedOpts;
  const fetched = await p.fetch({ name: 'Example Collage Co', api: 'https://api.collage.co/v1/positions/exampleco' }, { fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return sample; } });
  if (fetchedUrl === 'https://api.collage.co/v1/positions/exampleco' && fetchedOpts?.redirect === 'error' && fetched.length === 1) pass('fetch pins API host and uses redirect:error'); else fail(`fetch=${fetchedUrl} ${JSON.stringify(fetchedOpts)}`);
  let calls = 0;
  for (const bad of ['https://evil.example/v1/positions/acme', 'http://api.collage.co/v1/positions/acme']) {
    let rejected = false;
    try { await p.fetch({ name: 'Bad', api: bad }, { fetchJson: async () => { calls += 1; return sample; } }); } catch { rejected = true; }
    if (rejected) pass(`fetch rejects unsafe API URL: ${bad}`); else fail(`fetch accepted unsafe API URL: ${bad}`);
  }
  if (calls === 0) pass('fetch SSRF guards run before fetchJson'); else fail(`fetchJson called ${calls} times for rejected URLs`);
} catch (e) { fail(`collage provider tests crashed: ${e.message}`); }
