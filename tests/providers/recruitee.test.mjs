// tests/providers/recruitee.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — recruitee');


try {
  const recruiteeModule = await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href);
  const recruitee = recruiteeModule.default;
  const { parseRecruiteeResponse } = recruiteeModule;

  if (recruitee.id === 'recruitee') pass('recruitee.id is "recruitee"');
  else fail(`recruitee.id is ${JSON.stringify(recruitee.id)}`);

  const hit = recruitee.detect({ name: 'Channable', careers_url: 'https://channable.recruitee.com' });
  if (hit && hit.url === 'https://channable.recruitee.com/api/offers/') {
    pass('recruitee.detect() resolves <slug>.recruitee.com → api offers');
  } else {
    fail(`recruitee.detect() returned ${JSON.stringify(hit)}`);
  }

  if (recruitee.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('recruitee.detect() returns null for non-recruitee URLs');
  } else {
    fail('recruitee.detect() should return null for non-recruitee URLs');
  }

  // parseRecruiteeResponse
  const sample = {
    offers: [
      { title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm', city: 'Utrecht', country: 'Netherlands', remote: false },
      { title: 'Backend Eng', url: 'https://channable.recruitee.com/o/backend', city: 'Amsterdam', country: 'Netherlands', remote: true },
      { title: 'AI Lead', location: 'Remote, EMEA' },
    ],
  };
  const jobs = parseRecruiteeResponse(sample, 'Channable');
  if (jobs.length === 3) pass('parseRecruiteeResponse extracts 3 offers');
  else fail(`parseRecruiteeResponse returned ${jobs.length} offers`);

  if (jobs[0]?.title === 'Senior PM' && jobs[0]?.company === 'Channable' && jobs[0]?.url === 'https://channable.recruitee.com/o/senior-pm') {
    pass('parseRecruiteeResponse prefers careers_url field over url');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Amsterdam, Netherlands, Remote') {
    pass('parseRecruiteeResponse assembles city/country/remote when no location field');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Amsterdam, Netherlands, Remote"`);
  }

  if (jobs[2]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse uses explicit location field when present');
  } else {
    fail(`row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  if (parseRecruiteeResponse({}, 'X').length === 0) pass('empty {} → empty result');
  else fail('empty {} should yield empty result');

  if (parseRecruiteeResponse({ offers: null }, 'X').length === 0) {
    pass('null offers → empty result (no crash)');
  } else {
    fail('null offers should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (recruitee.detect({ name: 'X', careers_url: null }) === null && recruitee.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('recruitee.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('recruitee.detect() should treat non-string careers_url as missing');
  }

  // SSRF: malicious URL with recruitee.com in the PATH (not host) must not be detected.
  if (recruitee.detect({ name: 'Spoof', careers_url: 'https://evil.example/channable.recruitee.com/foo' }) === null) {
    pass('recruitee.detect() rejects path-spoofed URLs');
  } else {
    fail('recruitee.detect() must NOT misdetect path-spoofed URLs');
  }

  // Per-offer URL validation: custom-domain https URLs are KEPT (Recruitee
  // tenants serve postings on their own domain, e.g. careers.hostaway.com);
  // only non-https and malformed/missing URLs are dropped. The per-offer URL
  // is display-only and not host-locked to *.recruitee.com — see #recruitee.
  const offerUrlOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Recruitee domain', careers_url: 'https://channable.recruitee.com/o/good' },
        { title: 'Custom domain', careers_url: 'https://careers.hostaway.com/o/senior-backend' },
        { title: 'Insecure', careers_url: 'http://channable.recruitee.com/o/insecure' },
        { title: 'No URL field' },
      ],
    },
    'Channable',
  );
  if (offerUrlOffers[0]?.url === 'https://channable.recruitee.com/o/good' && offerUrlOffers[1]?.url === 'https://careers.hostaway.com/o/senior-backend' && offerUrlOffers[2]?.url === '' && offerUrlOffers[3]?.url === '') {
    pass('parseRecruiteeResponse keeps custom-domain https URLs, drops non-https and missing');
  } else {
    fail(`URL validation: row0=${JSON.stringify(offerUrlOffers[0]?.url)}, row1=${JSON.stringify(offerUrlOffers[1]?.url)}, row2=${JSON.stringify(offerUrlOffers[2]?.url)}, row3=${JSON.stringify(offerUrlOffers[3]?.url)}`);
  }

  // fetch() — derives the API URL, forwards the SSRF guard (redirect:'error'),
  // and returns parsed offers.
  let fetchedUrl = null;
  let fetchedOpts = null;
  const fetchJobs = await recruitee.fetch(
    { name: 'Channable', careers_url: 'https://channable.recruitee.com/' },
    { fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return { offers: [{ title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm' }] }; } },
  );
  if (fetchedUrl === 'https://channable.recruitee.com/api/offers/' && fetchedOpts?.redirect === 'error' && fetchJobs.length === 1) {
    pass('recruitee.fetch() hits /api/offers/ with redirect:"error" and returns parsed offers');
  } else {
    fail(`recruitee.fetch() url=${JSON.stringify(fetchedUrl)} opts=${JSON.stringify(fetchedOpts)} jobs=${fetchJobs.length}`);
  }

  // fetch() refuses entries whose careers_url can't derive a trusted
  // <slug>.recruitee.com API URL — the guard chain must run before any request.
  try {
    await recruitee.fetch(
      { name: 'Evil', careers_url: 'https://evil.example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('recruitee.fetch() should throw for an untrusted careers_url');
  } catch (e) {
    if (/cannot derive API URL for Evil/.test(e.message)) {
      pass('recruitee.fetch() throws before fetching when the host is untrusted');
    } else {
      fail(`recruitee.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`recruitee provider tests crashed: ${e.message}`);
}

