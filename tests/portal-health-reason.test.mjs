// verify-portals and audit-portals reported three different configs with one
// sentence: "no provider matched" / "scan.mjs drops it into an unnamed skip".
// A working local parser, an unknown provider id, and a URL nothing claims
// all looked the same. The parser was never run (a health check must not
// exec a command from portals.yml). The unknown-provider error was dropped.
//
// Offline. Stub providers only. fetchJson throws if a test reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let parserRuns = 0;
const localParser = {
  id: 'local-parser',
  detect: (e) => (e.parser?.command ? { url: e.careers_url } : null),
  fetch: async () => { parserRuns += 1; return [{ title: 'Role', url: 'https://self-hosted.example.com/j/1' }]; },
};

const parserEntry = {
  name: 'Parser Co',
  careers_url: 'https://self-hosted.example.com/jobs',
  parser: { command: 'node', script: 'tests/fixtures/three-city-board.mjs' },
  enabled: true,
};
const typoEntry = {
  name: 'Typo Co',
  careers_url: 'https://boards.example.com/typo',
  provider: 'greenhose',
  enabled: true,
};
const silentEntry = {
  name: 'Silent Co',
  careers_url: 'https://boards.example.com/silent',
  enabled: true,
};

const providers = new Map([['local-parser', localParser]]);
const deny = async () => { throw new Error('network is not allowed in this test'); };

test('audit names an unknown provider and does not call a local parser unclaimed', async () => {
  const { auditCompanies } = await import(pathToFileURL(join(ROOT, 'audit-portals.mjs')).href);
  parserRuns = 0;
  const rows = await auditCompanies([parserEntry, typoEntry, silentEntry], {
    providers, httpCtx: { fetchJson: deny, fetchText: deny }, concurrency: 1,
  });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(parserRuns, 0, 'audit must not execute the local parser');
  assert.equal(byName['Parser Co'].verdict, 'ok');
  assert.match(byName['Parser Co'].detail, /does not run/);
  assert.equal(byName['Typo Co'].verdict, 'error');
  assert.match(byName['Typo Co'].detail, /unknown provider: greenhose/);
  assert.equal(byName['Silent Co'].verdict, 'no-provider');
});

test('verify reports the unknown provider and says it does not run a local parser', async () => {
  const { verifyCompanies } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);
  parserRuns = 0;
  const rows = await verifyCompanies([parserEntry, typoEntry, silentEntry], {
    providers, fetchJson: deny, fetchText: deny, httpCtx: { fetchJson: deny, fetchText: deny },
  });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(parserRuns, 0, 'verify must not execute the local parser');
  assert.equal(byName['Parser Co'].status, 'skipped');
  assert.match(byName['Parser Co'].reason, /does not run/);
  assert.equal(byName['Typo Co'].status, 'missing');
  assert.match(byName['Typo Co'].reason, /unknown provider: greenhose/);
  assert.equal(byName['Silent Co'].status, 'skipped');
  assert.match(byName['Silent Co'].reason, /scan_method: websearch/);
  assert.match(byName['Silent Co'].reason, /does not verify/);
});

test('an unknown provider on a Greenhouse URL is missing and is not probed', async () => {
  const { verifyCompanies } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);
  let fetches = 0;
  const fetchJson = async () => {
    fetches += 1;
    return { jobs: [{ id: 1 }] };
  };
  const rows = await verifyCompanies([{
    name: 'Typo Greenhouse',
    careers_url: 'https://boards.greenhouse.io/typo',
    provider: 'greenhose',
    enabled: true,
  }], {
    providers, fetchJson, fetchText: deny, httpCtx: { fetchJson, fetchText: deny },
  });
  assert.equal(fetches, 0, 'the recognizable URL must not be probed');
  assert.equal(rows[0].status, 'missing');
  assert.match(rows[0].reason, /unknown provider: greenhose/);
});

test('a known provider still probes a recognizable ATS URL', async () => {
  const { verifyCompanies } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);
  let fetches = 0;
  const fetchJson = async () => {
    fetches += 1;
    return { jobs: [{ id: 1 }] };
  };
  const withGreenhouse = new Map(providers);
  withGreenhouse.set('greenhouse', { id: 'greenhouse', detect: () => null, fetch: async () => [] });
  const rows = await verifyCompanies([{
    name: 'Live Co',
    careers_url: 'https://boards.greenhouse.io/liveco',
    provider: 'greenhouse',
    enabled: true,
  }], {
    providers: withGreenhouse, fetchJson, fetchText: deny, httpCtx: { fetchJson, fetchText: deny },
  });
  assert.equal(fetches, 1);
  assert.equal(rows[0].status, 'live');
  assert.equal(rows[0].ats, 'greenhouse');
});
