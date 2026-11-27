// tests/providers/torre.test.mjs — the retired Torre provider shim (#4859).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — torre');

try {
  const torre = (await import(pathToFileURL(join(ROOT, 'providers/torre.mjs')).href)).default;

  if (torre.id === 'torre') pass('torre.id is "torre"');
  else fail(`torre.id is ${JSON.stringify(torre.id)}`);

  if (torre.detect({ provider: 'torre' })?.url === 'https://search.torre.co/opportunities/_search' && torre.detect({ name: 'X' }) === null)
    pass('torre.detect() matches only an explicit provider: torre');
  else fail('torre.detect() should match only provider: torre');

  // -- Retirement (#4859): fetch() throws without touching the network. --

  let networkCalls = 0;
  let fetchErr = null;
  try {
    await torre.fetch(
      { name: 'Torre - cybersecurity', provider: 'torre', search: 'cybersecurity' },
      { fetchJson: async () => { networkCalls++; return { results: [] }; } },
    );
  } catch (err) {
    fetchErr = err;
  }
  if (networkCalls === 0 && fetchErr
      && /torre: this source is unavailable/.test(fetchErr.message)
      && /HTTP 400/.test(fetchErr.message)
      && /#4859/.test(fetchErr.message)
      && /remove `provider: torre`/.test(fetchErr.message))
    pass('torre.fetch() throws a "source unavailable" message naming the cause (#4859) without touching the network');
  else fail(`torre.fetch() should throw a retirement message with zero network calls, got: networkCalls=${networkCalls}, error=${fetchErr ? fetchErr.message : '(did not throw)'}`);

} catch (e) {
  fail(`torre provider tests crashed: ${e.message}`);
}
