// tests/providers/indeed.test.mjs — indeed Publisher API provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — indeed');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/indeed.mjs')).href);
  const indeed = mod.default;

  if (indeed.id === 'indeed') pass('indeed.id is "indeed"');
  else fail(`indeed.id is ${JSON.stringify(indeed.id)}`);

  // detect: only activates when provider is explicitly set to "indeed"
  const hit = indeed.detect({ name: 'Indeed', provider: 'indeed', api: 'https://api.indeed.com/ads/apisearch' });
  if (hit && hit.url === 'https://api.indeed.com/ads/apisearch') {
    pass('indeed.detect() activates for provider: indeed');
  } else {
    fail(`indeed.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: falls back to the default API URL when api is absent
  const defaultHit = indeed.detect({ name: 'Indeed', provider: 'indeed' });
  if (defaultHit && /api\.indeed\.com\/ads\/apisearch/.test(defaultHit.url)) {
    pass('indeed.detect() falls back to the default API URL');
  } else {
    fail(`indeed.detect() default fallback returned ${JSON.stringify(defaultHit)}`);
  }

  // detect: null for entries that do not opt in via provider
  if (indeed.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('indeed.detect() returns null unless provider is explicitly "indeed"');
  } else {
    fail('indeed.detect() must not auto-activate without explicit provider');
  }

  // detect: careers_url is irrelevant — indeed is opt-in only and resolves via api/default
  const ignoreCareers = indeed.detect({ name: 'X', provider: 'indeed', careers_url: 'https://example.com/careers' });
  if (ignoreCareers && /api\.indeed\.com/.test(ignoreCareers.url)) {
    pass('indeed.detect() ignores careers_url and resolves via api/default');
  } else {
    fail(`indeed.detect() careers_url handling returned ${JSON.stringify(ignoreCareers)}`);
  }

  // detect: non-string api falls back to the default API URL (never a crash)
  const nonStringApi = indeed.detect({ name: 'X', provider: 'indeed', api: 7 });
  if (nonStringApi && /api\.indeed\.com\/ads\/apisearch/.test(nonStringApi.url)) {
    pass('indeed.detect() falls back to default URL for non-string api');
  } else {
    fail(`indeed.detect() non-string api returned ${JSON.stringify(nonStringApi)}`);
  }

  // fetch: throws a clear error when the Publisher ID is absent (no network call)
  const prev = process.env.INDEED_PUBLISHER_ID;
  delete process.env.INDEED_PUBLISHER_ID;
  let threw = false;
  try {
    await indeed.fetch({ name: 'Indeed', indeed: { query: 'AI Engineer' } }, {
      fetchJson: async () => ({ results: [] }),
      fetchText: async () => '',
    });
  } catch (err) {
    threw = /INDEED_PUBLISHER_ID/.test(err.message);
  }
  if (prev === undefined) delete process.env.INDEED_PUBLISHER_ID; else process.env.INDEED_PUBLISHER_ID = prev;
  if (threw) pass('indeed.fetch() fails fast without INDEED_PUBLISHER_ID');
  else fail('indeed.fetch() should throw a clear error when the Publisher ID is missing');
} catch (err) {
  fail(`indeed provider test crashed: ${err.message}`);
}
