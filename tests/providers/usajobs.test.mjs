// tests/providers/usajobs.test.mjs — USAJOBS public API provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — usajobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/usajobs.mjs')).href);
  const usajobs = mod.default;

  if (usajobs.id === 'usajobs') pass('usajobs.id is "usajobs"');
  else fail(`usajobs.id is ${JSON.stringify(usajobs.id)}`);

  // detect: only activates when provider is explicitly set to "usajobs"
  const hit = usajobs.detect({ name: 'USAJOBS', provider: 'usajobs', api: 'https://data.usajobs.gov/api/search' });
  if (hit && hit.url === 'https://data.usajobs.gov/api/search') {
    pass('usajobs.detect() activates for provider: usajobs');
  } else {
    fail(`usajobs.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: falls back to the default API URL when api is absent
  const defaultHit = usajobs.detect({ name: 'USAJOBS', provider: 'usajobs' });
  if (defaultHit && /data\.usajobs\.gov\/api\/search/.test(defaultHit.url)) {
    pass('usajobs.detect() falls back to the default API URL');
  } else {
    fail(`usajobs.detect() default fallback returned ${JSON.stringify(defaultHit)}`);
  }

  // detect: null for entries that do not opt in via provider
  if (usajobs.detect({ name: 'X', careers_url: 'https://www.usajobs.gov/search' }) === null) {
    pass('usajobs.detect() returns null unless provider is explicitly "usajobs"');
  } else {
    fail('usajobs.detect() must not auto-activate without explicit provider');
  }

  // fetch: throws a clear error when the API key is absent (no network call)
  const prev = process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_API_KEY;
  let threw = false;
  try {
    await usajobs.fetch({ name: 'USAJOBS', usajobs: { query: 'AI Engineer' } }, {
      fetchJson: async () => ({ SearchResult: { SearchResultItems: [] } }),
      fetchText: async () => '',
    });
  } catch (err) {
    threw = /USAJOBS_API_KEY/.test(err.message);
  }
  if (prev === undefined) delete process.env.USAJOBS_API_KEY; else process.env.USAJOBS_API_KEY = prev;
  if (threw) pass('usajobs.fetch() fails fast without USAJOBS_API_KEY');
  else fail('usajobs.fetch() should throw a clear error when the API key is missing');
} catch (err) {
  fail(`usajobs provider test crashed: ${err.message}`);
}
