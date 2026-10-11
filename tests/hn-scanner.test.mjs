import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWithAI } from '../scan-hn.mjs';

test('Hacker News AI Extraction Logic', async (t) => {
  const mockModel = {
    generateContent: async (prompt) => {
      if (prompt.includes('Stripe')) {
        return { response: { text: () => 'company: Stripe\ntitle: Engineer\nlocation: Remote' } };
      }
      if (prompt.includes('MISSING_KEYS')) {
        return { response: { text: () => 'company: null' } }; 
      }
      if (prompt.includes('MALFORMED')) {
        return { response: { text: () => 'company: { [ malformed : yaml }' } };
      }
      return { response: { text: () => 'null' } };
    }
  };

  await t.test('should extract valid data from a standard HN post', async () => {
    const res = await extractWithAI('Stripe post', mockModel);
    assert.strictEqual(res.company, 'Stripe');
    assert.strictEqual(res.title, 'Engineer');
  });

  await t.test('should return null for malformed YAML output', async () => {
    const res = await extractWithAI('MALFORMED data', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should return null for non-job related text', async () => {
    const res = await extractWithAI('Random text', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should let a failed API call reach the caller instead of returning null', async () => {
    // An invalid key, exhausted quota or retired model makes generateContent
    // throw. Returning null for that is indistinguishable from "no match".
    const failingModel = {
      generateContent: async () => { throw new Error('[404 Not Found] models/gemini-1.5-flash is not found'); },
    };
    await assert.rejects(() => extractWithAI('Stripe post', failingModel), /404 Not Found/);
  });

  await t.test('should handle objects missing required keys gracefully', async () => {
    const res = await extractWithAI('MISSING_KEYS', mockModel);
    assert.strictEqual(res.company, '');
    assert.strictEqual(res.title, '');
    assert.strictEqual(res.location, 'Remote/Unknown');
  });
});

// Offline fetch fixture for runs of the real scanner. HN is served from canned
// responses, Gemini fails the way an invalid key does, and any other request is
// recorded in `unexpected` and refused. With `serveHn: false` every request is
// refused, for runs that must not reach the network at all.
function writeFetchFixture(dir, { serveHn = true } = {}) {
  const unexpected = join(dir, 'unexpected-requests');
  const preload = join(dir, 'fetch-fixture.cjs');
  writeFileSync(preload, `
    const { appendFileSync } = require('node:fs');
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
    const serveHn = ${serveHn};
    globalThis.fetch = async (input) => {
      const url = String(input?.url ?? input);
      if (serveHn && url.includes('hn.algolia.com/api/v1/search_by_date')) {
        return json({ hits: [{ objectID: '424242', title: 'Ask HN: Who is hiring? (September 2026)' }] });
      }
      if (serveHn && url.includes('hn.algolia.com/api/v1/items/424242')) {
        return json({ children: [
          { text: 'Stripe | Software Engineer | Remote | https://stripe.com/jobs/1' },
          { text: 'Acme | Software Engineer | Berlin | https://acme.example/jobs/2' },
        ] });
      }
      if (serveHn && url.includes('generativelanguage.googleapis.com')) {
        return json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400);
      }
      appendFileSync(${JSON.stringify(unexpected)}, url + '\\n');
      throw new Error('network forbidden in test: ' + url);
    };
  `);
  return { preload, unexpected };
}

function runScanHn(dir, preload, args, envOverrides = {}) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', ...envOverrides };
  delete env.CAREER_OPS_PORTALS;
  delete env.GEMINI_MODEL;
  return spawnSync(process.execPath, [
    '--require', preload,
    fileURLToPath(new URL('../scan-hn.mjs', import.meta.url)),
    ...args,
  ], { cwd: dir, encoding: 'utf8', timeout: 30000, env });
}

// The test above proves extractWithAI rethrows. This one runs the real scanner,
// so a regression in the caller (the summary line or the exit code) fails here
// too. Every Gemini call fails the way an invalid key does; HN is served from a
// fixture, and any other request is refused.
test('scan-hn reports AI errors and exits non-zero when every Gemini call fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const { preload, unexpected } = writeFetchFixture(dir);

    const r = runScanHn(dir, preload, [], { GEMINI_API_KEY: 'invalid-test-key' });

    assert.equal(r.error, undefined, `scan-hn failed to spawn: ${r.error?.message}`);
    assert.equal(existsSync(unexpected), false, 'scan-hn made a request outside the fixture');
    assert.match(r.stdout, /Postings fetched:\s+2/);
    assert.match(r.stdout, /New offers:\s+0/);
    assert.match(r.stdout, /AI errors:\s+2 of 2/, `summary line missing:\n${r.stdout}`);
    assert.match(r.stderr, /2 of 2 Gemini extractions failed/);
    assert.match(r.stderr, /API key not valid/);
    assert.equal(r.status, 1, `expected exit 1 when every Gemini call fails, got ${r.status}\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// --help used to run the live scan, and so did any flag this script never had
// (#4598). Both must stop before the first fetch: nothing served, nothing
// written.
test('scan-hn --help prints usage and an unknown flag is refused, neither runs the scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const { preload, unexpected } = writeFetchFixture(dir, { serveHn: false });

    const help = runScanHn(dir, preload, ['--help']);
    assert.equal(help.error, undefined, `scan-hn failed to spawn: ${help.error?.message}`);
    assert.equal(help.status, 0, `expected --help to exit 0, got ${help.status}\n${help.stderr}`);
    assert.match(help.stdout, /Usage:\n\s+node scan-hn\.mjs/);
    assert.match(help.stdout, /data\/pipeline\.md/, 'usage should say what the scan writes');

    const bogus = runScanHn(dir, preload, ['--dry-run']);
    assert.equal(bogus.status, 1, `expected an unknown flag to exit 1, got ${bogus.status}\n${bogus.stdout}`);
    assert.match(bogus.stderr, /unrecognized flag\(s\): --dry-run/);

    assert.equal(existsSync(unexpected), false, 'a flag-only run reached the network');
    assert.equal(existsSync(join(dir, 'data', 'pipeline.md')), false, 'a flag-only run wrote data/pipeline.md');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A portals.yml that exists but does not parse used to be swallowed, and the
// scan ran on the default "Software Engineer" instead of the user's
// hn_hiring.keywords (#4921). The fixture thread only carries Software Engineer
// postings, so the valid file is the control: its keywords are read and match
// nothing. The broken one must stop before the first fetch, as scan.mjs does.
test('scan-hn refuses a portals.yml that does not parse instead of scanning with the default keyword', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const portals = join(dir, 'portals.yml');
    const keywords = 'hn_hiring:\n  keywords:\n    - Registered Nurse\n';

    const served = writeFetchFixture(dir);
    writeFileSync(portals, keywords);
    const valid = runScanHn(dir, served.preload, [], { GEMINI_API_KEY: '' });
    assert.equal(valid.error, undefined, `scan-hn failed to spawn: ${valid.error?.message}`);
    assert.equal(valid.status, 0, `expected a valid portals.yml to exit 0, got ${valid.status}\n${valid.stderr}`);
    assert.match(valid.stdout, /Postings fetched:\s+2/);
    assert.match(valid.stdout, /New offers:\s+0/, 'hn_hiring.keywords should replace the default');

    const refused = writeFetchFixture(dir, { serveHn: false });
    writeFileSync(portals, `${keywords}title_filter:\n  positive: ["unclosed\n`);
    const broken = runScanHn(dir, refused.preload, [], { GEMINI_API_KEY: '' });
    assert.equal(broken.status, 1, `expected a parse error to exit 1, got ${broken.status}\n${broken.stdout}`);
    assert.match(broken.stderr, /Error: failed to parse .*portals\.yml: /);
    assert.doesNotMatch(broken.stdout, /Match:/);
    assert.equal(existsSync(refused.unexpected), false, 'a run with an unparseable portals.yml reached the network');
    assert.equal(existsSync(join(dir, 'data', 'pipeline.md')), false, 'a run with an unparseable portals.yml wrote data/pipeline.md');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
