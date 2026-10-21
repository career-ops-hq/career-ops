// Fictional responses only; every fetch is stubbed. No ATS requests.
import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import provider, { parseSmartRecruitersResponse } from '../../providers/smartrecruiters.mjs';

console.log('\nSmartRecruiters fallback URL encoding');

const entry = {
  name: 'Example Research',
  careers_url: 'https://careers.smartrecruiters.com/ExampleLabs42',
};
const posting = { id: '12345', name: 'Research Engineer' };
const publicBase = 'https://jobs.smartrecruiters.com/ExampleLabs42/';

async function check(label, fn) {
  try { await fn(); pass(label); }
  catch (e) { fail(`${label}: ${e.message}`); }
}

for (const [label, id, encoded] of [
  ['slash', 'part/123', 'part%2F123'],
  ['query', 'part?123', 'part%3F123'],
  ['fragment', 'part#123', 'part%23123'],
  ['space', 'part 123', 'part%20123'],
  ['literal percent escape', 'part%2F123', 'part%252F123'],
  ['Unicode', 'caf\u00e9-\ud83d\ude80', 'caf%C3%A9-%F0%9F%9A%80'],
  ['numeric ID', 12345, '12345'],
]) {
  await check(`SmartRecruiters fallback keeps ${label} inside the posting ID`, () => {
    const [job] = parseSmartRecruitersResponse({ content: [{ ...posting, id }] }, entry.name, 'ExampleLabs42');
    assert.equal(job.url, `${publicBase}${encoded}-research-engineer`);
    const url = new URL(job.url);
    assert.equal(url.pathname.split('/').length, 3);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.equal(job.id, String(id)); // Detail enrichment still needs the raw ID.
  });
}

await check('SmartRecruiters legacy display-name fallback also encodes the posting ID', () => {
  const [job] = parseSmartRecruitersResponse({ content: [{ ...posting, id: 'part/123' }] }, entry.name);
  assert.equal(job.url, 'https://jobs.smartrecruiters.com/example-research/part%2F123-research-engineer');
});

await check('SmartRecruiters an encoded ID with no title has no trailing hyphen', () => {
  const [job] = parseSmartRecruitersResponse({ content: [{ id: 'part/123' }] }, entry.name, 'ExampleLabs42');
  assert.equal(job.url, `${publicBase}part%2F123`);
});

for (const [label, id] of [['high', 'bad\ud800'], ['low', 'bad\udc00']]) {
  await check(`SmartRecruiters drops only the fallback row with a lone ${label} surrogate`, () => {
    const rows = [{ ...posting, id: 'before' }, { ...posting, id }, { ...posting, id: 'after' }];
    const jobs = parseSmartRecruitersResponse({ content: rows }, entry.name, 'ExampleLabs42');
    assert.deepEqual(jobs.map(j => j.url), [`${publicBase}before-research-engineer`, `${publicBase}after-research-engineer`]);
  });
}

await check('SmartRecruiters a usable ref wins even when the raw fallback ID is malformed', () => {
  const [job] = parseSmartRecruitersResponse({ content: [{
    ...posting, id: 'bad\ud800',
    ref: 'https://api.smartrecruiters.com/v1/companies/OtherTenant/postings/part%2F123',
  }] }, entry.name, 'ExampleLabs42');
  assert.equal(job.url, 'https://jobs.smartrecruiters.com/OtherTenant/part%2F123-research-engineer');
});

// resolveSlug returns a URL.pathname segment, which is already escaped. Encoding
// it a second time would change the company addressed by both list and job URLs.
for (const slug of ['Example%20Labs', 'Example%2FLabs', 'Example%25Labs', 'Caf%C3%A9Labs']) {
  await check(`SmartRecruiters preserves configured slug ${slug} across list, fallback, ref and detail URLs`, async () => {
    const config = { ...entry, careers_url: `https://careers.smartrecruiters.com/${slug}`, smartrecruiters: { fetchDetails: true } };
    const apiBase = `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;
    const calls = [];
    assert.equal(provider.detect(config).url, `${apiBase}?limit=100&offset=0&status=PUBLIC`);
    const jobs = await provider.fetch(config, {
      fetchJson: async (url, opts) => {
        calls.push(url);
        assert.equal(opts.redirect, 'error');
        if (url === `${apiBase}?limit=100&offset=0&status=PUBLIC`) {
          return { content: [{ ...posting, id: 'part/123' }] };
        }
        assert.equal(url, `${apiBase}/part%2F123`);
        return { jobAd: { sections: { jobDescription: { text: '<p>Example description</p>' } } } };
      },
    });
    assert.deepEqual(calls, [`${apiBase}?limit=100&offset=0&status=PUBLIC`, `${apiBase}/part%2F123`]);
    assert.equal(jobs[0].url, `https://jobs.smartrecruiters.com/${slug}/part%2F123-research-engineer`);
    assert.equal(jobs[0].description, 'Example description');
    assert.equal('id' in jobs[0], false);
    const [withRef] = parseSmartRecruitersResponse({ content: [{ ...posting, ref: `${apiBase}/part%2F123` }] }, entry.name, slug);
    assert.equal(withRef.url, jobs[0].url);
  });
}

await check('SmartRecruiters URL parsing escapes a raw space in the configured company slug once', async () => {
  const config = { ...entry, careers_url: 'https://careers.smartrecruiters.com/Example Labs' };
  const jobs = await provider.fetch(config, { fetchJson: async () => ({ content: [posting] }) });
  assert.equal(jobs[0].url, 'https://jobs.smartrecruiters.com/Example%20Labs/12345-research-engineer');
});

// Filtering a malformed row must not make a full API page look like the last
// page, or every subsequent posting disappears from the scan.
for (const badCount of [1, 100]) {
  await check(`SmartRecruiters fetches the next full page after dropping ${badCount} malformed IDs`, async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ ...posting, id: i < badCount ? `bad\ud800${i}` : `good-${i}` }));
    const offsets = [];
    const jobs = await provider.fetch(entry, {
      fetchJson: async (url, opts) => {
        assert.equal(opts.redirect, 'error');
        const offset = Number(new URL(url).searchParams.get('offset'));
        offsets.push(offset);
        assert.ok(offset === 0 || offset === 100);
        return { content: offset === 0 ? firstPage : [{ ...posting, id: 'next-page' }] };
      },
    });
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(jobs.length, 101 - badCount);
    assert.equal(jobs.at(-1).url, `${publicBase}next-page-research-engineer`);
    assert.ok(jobs.every(j => !j.url.includes('bad')));
  });
}

await check('SmartRecruiters maxPages still caps a full page of malformed IDs', async () => {
  let calls = 0;
  const jobs = await provider.fetch(entry, {
    maxPages: 1,
    fetchJson: async () => { calls++; return { content: Array.from({ length: 100 }, () => ({ ...posting, id: 'bad\ud800' })) }; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(jobs, []);
});

await check('SmartRecruiters a short page of malformed IDs still ends pagination', async () => {
  let calls = 0;
  const jobs = await provider.fetch(entry, {
    fetchJson: async () => { assert.equal(++calls, 1); return { content: [{ ...posting, id: 'bad\ud800' }] }; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(jobs, []);
});
