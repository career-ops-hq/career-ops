// tests/providers/generic-careers.test.mjs — smart career-page auto-detector.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — generic-careers');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/generic-careers.mjs')).href);
  const gc = mod.default;

  if (gc.id === 'generic-careers') pass('generic-careers.id is "generic-careers"');
  else fail(`generic-careers.id is ${JSON.stringify(gc.id)}`);

  // detect: activates when the user explicitly set provider: generic-careers
  const explicit = gc.detect({ name: 'Acme', provider: 'generic-careers', careers_url: 'https://acme.com/careers' });
  if (explicit && explicit.url === 'https://acme.com/careers') {
    pass('generic-careers.detect() activates for explicit provider: generic-careers');
  } else {
    fail(`generic-careers.detect() explicit returned ${JSON.stringify(explicit)}`);
  }

  // detect: activates as a last-resort fallback for bare careers_url entries
  const fallback = gc.detect({ name: 'Acme', careers_url: 'https://acme.com/careers' });
  if (fallback && fallback.url === 'https://acme.com/careers') {
    pass('generic-careers.detect() activates for bare careers_url (fallback)');
  } else {
    fail(`generic-careers.detect() fallback returned ${JSON.stringify(fallback)}`);
  }

  // detect: does NOT hijack entries that carry an api URL (specific provider wins)
  if (gc.detect({ name: 'Acme', careers_url: 'https://acme.com/careers', api: 'https://api.example.com/jobs' }) === null) {
    pass('generic-careers.detect() defers to entries with an explicit api URL');
  } else {
    fail('generic-careers.detect() should not hijack api-backed entries');
  }

  // detect: null when there is nothing to fetch
  if (gc.detect({ name: 'X' }) === null && gc.detect({ name: 'X', provider: 'greenhouse' }) === null) {
    pass('generic-careers.detect() returns null without a careers_url / api / explicit opt-in');
  } else {
    fail('generic-careers.detect() should return null when there is nothing to fetch');
  }

  // fetch: throws a clear error when no URL is present
  let threw = false;
  try {
    await gc.fetch({ name: 'Acme' }, {
      fetchJson: async () => ({}),
      fetchText: async () => '',
    });
  } catch (err) {
    threw = /no careers_url or api URL/.test(err.message);
  }
  if (threw) pass('generic-careers.fetch() throws a clear error without a URL');
  else fail('generic-careers.fetch() should throw when no URL is configured');
} catch (err) {
  fail(`generic-careers provider test crashed: ${err.message}`);
}
