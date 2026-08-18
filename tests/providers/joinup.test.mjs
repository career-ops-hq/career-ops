// tests/providers/joinup.test.mjs — direct provider-contract tests (PR #825).
// joinup.ch server-renders the newest results page into __NEXT_DATA__, so the
// parser must fail CLOSED on both a missing and an unparseable payload: a
// silent zero would look like an empty board and quietly drop the source from
// every scan. Also covers hostname-anchored detection and redirect:'error'.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — joinup');

try {
  const joinup = (await import(pathToFileURL(join(ROOT, 'providers/joinup.mjs')).href)).default;

  if (joinup.id === 'joinup') pass('joinup.id is "joinup"');
  else fail(`joinup.id is ${JSON.stringify(joinup.id)}`);

  if (joinup.detect({ name: 'J', careers_url: 'https://joinup.ch/browse/jobs' })?.url === 'https://joinup.ch/browse/jobs') {
    pass('joinup.detect() claims a joinup.ch careers_url');
  } else {
    fail('joinup.detect() should claim joinup.ch');
  }

  // SSRF: path-spoofed / off-host careers_url must not be detected as joinup.
  if (joinup.detect({ name: 'Spoof', careers_url: 'https://evil.example/joinup.ch' }) === null
      && joinup.detect({ name: 'Other', careers_url: 'https://example.com/jobs' }) === null) {
    pass('joinup.detect() rejects path-spoofed / off-host URLs (SSRF)');
  } else {
    fail('joinup.detect() must only claim the joinup.ch hostname');
  }

  // fetch() passes redirect:'error' and parses __NEXT_DATA__.
  const nextData = JSON.stringify({ props: { pageProps: { serverState: { initialResults: { jobs: { results: [{ hits: [{ title: 'Head of Finance', startup: 'Acme', slug: 'acme-hof', location: 'Zurich', created: '2026-01-02' }] }] } } } } } });
  let joinupOpts = null;
  const joinupJobs = await joinup.fetch({ name: 'J', careers_url: 'https://joinup.ch/browse/jobs' }, {
    fetchText: async (_url, opts) => { joinupOpts = opts; return `<script id="__NEXT_DATA__" type="application/json">${nextData}</script>`; },
  });
  if (joinupOpts?.redirect === 'error') pass('joinup.fetch() passes redirect:"error"');
  else fail(`joinup.fetch() should pass redirect:"error", got ${JSON.stringify(joinupOpts)}`);
  if (joinupJobs.length === 1 && joinupJobs[0].url === 'https://joinup.ch/job/acme-hof' && joinupJobs[0].company === 'Acme') {
    pass('joinup.fetch() maps a __NEXT_DATA__ hit to a job');
  } else {
    fail(`joinup.fetch() row = ${JSON.stringify(joinupJobs[0])}`);
  }

  if (joinupJobs[0]?.postedAt === Date.parse('2026-01-02')) pass('joinup.fetch() maps an ISO `created` to postedAt');
  else fail(`joinup.fetch() postedAt = ${JSON.stringify(joinupJobs[0]?.postedAt)}`);

  // Missing __NEXT_DATA__ fails closed (throws, not silent zero).
  let joinupThrew = false;
  try {
    await joinup.fetch({ name: 'J', careers_url: 'https://joinup.ch/browse/jobs' }, { fetchText: async () => '<html>no data here</html>' });
  } catch (e) { joinupThrew = /__NEXT_DATA__/.test(e.message); }
  if (joinupThrew) pass('joinup.fetch() throws on missing __NEXT_DATA__ (fails closed)');
  else fail('joinup.fetch() should throw when __NEXT_DATA__ is absent');

  // Present but UNPARSEABLE __NEXT_DATA__ must also fail closed — the script
  // tag existing is not evidence the payload is usable.
  let joinupBadJson = false;
  try {
    await joinup.fetch(
      { name: 'J', careers_url: 'https://joinup.ch/browse/jobs' },
      { fetchText: async () => '<script id="__NEXT_DATA__" type="application/json">{"props": {oops,,}</script>' },
    );
  } catch (e) { joinupBadJson = /__NEXT_DATA__/.test(e.message); }
  if (joinupBadJson) pass('joinup.fetch() throws on malformed __NEXT_DATA__ JSON (fails closed)');
  else fail('joinup.fetch() should throw when __NEXT_DATA__ holds invalid JSON');

  // A structurally valid payload with no hits is a genuinely empty board.
  const emptyNext = JSON.stringify({ props: { pageProps: { serverState: { initialResults: { jobs: { results: [{ hits: [] }] } } } } } });
  const joinupEmpty = await joinup.fetch({ name: 'J', careers_url: 'https://joinup.ch/browse/jobs' }, {
    fetchText: async () => `<script id="__NEXT_DATA__" type="application/json">${emptyNext}</script>`,
  });
  if (Array.isArray(joinupEmpty) && joinupEmpty.length === 0) pass('joinup.fetch() returns [] for an empty board');
  else fail(`joinup.fetch() empty board = ${JSON.stringify(joinupEmpty)}`);
} catch (e) {
  fail(`joinup provider tests crashed: ${e.message}`);
}
