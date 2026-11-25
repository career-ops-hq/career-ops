// tests/providers/echojobs.test.mjs — the retired EchoJobs provider shim (#2976).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — echojobs');

try {
  const echojobs = (await import(pathToFileURL(join(ROOT, 'providers/echojobs.mjs')).href)).default;

  if (echojobs.id === 'echojobs') pass('echojobs.id is "echojobs"');
  else fail(`echojobs.id is ${JSON.stringify(echojobs.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = echojobs.detect({ name: 'EchoJobs', provider: 'echojobs' });
  if (hit && hit.url === 'https://echojobs.io/api/jobs') pass('echojobs.detect() resolves provider:echojobs → feed URL');
  else fail(`echojobs.detect() returned ${JSON.stringify(hit)}`);
  if (echojobs.detect({ name: 'X' }) === null) pass('echojobs.detect() returns null without provider:echojobs');
  else fail('echojobs.detect() should require provider:echojobs');

  // fetch() — retired (#2976): throws immediately, names the cause, and never
  // touches the network (the feed sits behind a bot-protection checkpoint, and
  // career-ops does not work around bot protection).
  let networkCalls = 0;
  const ctx = {
    transport: 'http',
    fetchJson: async (url) => {
      networkCalls++;
      throw new Error(`fetchJson should not be called, got: ${url}`);
    },
    fetchText: async () => {
      networkCalls++;
      throw new Error('fetchText should not be called');
    },
  };
  let fetchErr = null;
  try {
    await echojobs.fetch({ name: 'EchoJobs', provider: 'echojobs' }, ctx);
  } catch (e) {
    fetchErr = e;
  }
  if (networkCalls === 0 && fetchErr && /this feed is gone/i.test(fetchErr.message) && /#2976/.test(fetchErr.message)) {
    pass('echojobs.fetch() throws a retirement message naming the cause (#2976) without touching the network');
  } else {
    fail(`echojobs.fetch() should throw a retirement message with zero network calls, got: networkCalls=${networkCalls}, error=${fetchErr ? fetchErr.message : '(did not throw)'}`);
  }

} catch (e) {
  fail(`echojobs provider tests crashed: ${e.message}`);
}
