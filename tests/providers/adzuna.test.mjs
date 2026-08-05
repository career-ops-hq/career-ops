// tests/providers/adzuna.test.mjs — adzuna provider (public Job Search API).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adzuna');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adzuna.mjs')).href);
  const adzuna = mod.default;

  if (adzuna.id === 'adzuna') pass('adzuna.id is "adzuna"');
  else fail(`adzuna.id is ${JSON.stringify(adzuna.id)}`);

  // detect: adzuna.com host
  const hit = adzuna.detect({ name: 'Adzuna', api: 'https://api.adzuna.com/v1/api/jobs' });
  if (hit && hit.url === 'https://api.adzuna.com/v1/api/jobs') {
    pass('adzuna.detect() matches api.adzuna.com');
  } else {
    fail(`adzuna.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: subdomain (www.adzuna.com)
  if (adzuna.detect({ name: 'Adzuna', careers_url: 'https://www.adzuna.com/jobs' })?.url) {
    pass('adzuna.detect() matches www.adzuna.com');
  } else {
    fail('adzuna.detect() should match www.adzuna.com');
  }

  // detect: null for non-adzuna URLs
  if (adzuna.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('adzuna.detect() returns null for non-adzuna URLs');
  } else {
    fail('adzuna.detect() should return null for non-adzuna URLs');
  }

  // detect: null for non-string URLs
  if (adzuna.detect({ name: 'X', careers_url: null }) === null && adzuna.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('adzuna.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('adzuna.detect() should treat non-string careers_url as missing');
  }

  // SSRF: adzuna.com in the PATH (not host) must not be detected.
  if (adzuna.detect({ name: 'Spoof', careers_url: 'https://evil.example/adzuna.com/foo' }) === null) {
    pass('adzuna.detect() rejects path-spoofed URLs');
  } else {
    fail('adzuna.detect() must reject path-spoofed URLs');
  }

  // fetch: throws a clear error when credentials are absent (no network call)
  const prevId = process.env.ADZUNA_APP_ID;
  const prevKey = process.env.ADZUNA_APP_KEY;
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  let threw = false;
  try {
    await adzuna.fetch({ name: 'Adzuna', adzuna: { what_keywords: ['AI Engineer'] } }, {
      fetchJson: async () => ({ results: [] }),
      fetchText: async () => '',
    });
  } catch (err) {
    threw = /ADZUNA_APP_ID/.test(err.message);
  }
  if (prevId === undefined) delete process.env.ADZUNA_APP_ID; else process.env.ADZUNA_APP_ID = prevId;
  if (prevKey === undefined) delete process.env.ADZUNA_APP_KEY; else process.env.ADZUNA_APP_KEY = prevKey;
  if (threw) pass('adzuna.fetch() fails fast without ADZUNA_APP_ID/ADZUNA_APP_KEY');
  else fail('adzuna.fetch() should throw a clear error when credentials are missing');
} catch (err) {
  fail(`adzuna provider test crashed: ${err.message}`);
}
