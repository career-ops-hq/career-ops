// harvest-buildlist.mjs must not call process.exit() once its requests have
// run: on Windows, Node 24 aborts on process.exit() right after a request
// (nodejs/node#56645, the crash in #3788; discover-ats.mjs avoids it the same
// way). The entry point ended every run, failed or not, with process.exit().
// The preload stubs fetch with a one-company BuildList and turns any
// process.exit() call into exit 99, which fails on every platform. robotsAllows
// looks up the robots.txt host before it asks for the file, and refuses when
// the lookup fails, so the preload answers that lookup too: the test needs no
// network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// robots.txt allows everything, the sitemap lists one company, and its page
// links an Ashby board. `sitemapStatus` other than 200 fails the run there.
function runHarvest(args, { sitemapStatus = 200 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harvest-buildlist-exit-'));
  try {
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
const answer = { address: '93.184.215.14', family: 4 };
dnsPromises.lookup = async (_host, options) => (options?.all ? [answer] : answer);
syncBuiltinESMExports();
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
let requests = 0;
globalThis.fetch = async (input) => {
  requests++;
  const url = String(input?.url ?? input);
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\\nAllow: /\\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  if (url.includes('/sitemaps/companies.xml')) {
    if (${sitemapStatus} !== 200) return new Response('', { status: ${sitemapStatus} });
    return new Response('<?xml version="1.0"?><urlset><url><loc>https://buildlist.xyz/acme-robotics</loc></url></urlset>', { status: 200, headers: { 'content-type': 'application/xml' } });
  }
  return new Response('<html><body><h1>Acme Robotics</h1><a href="https://jobs.ashbyhq.com/acmerobotics/123">Apply</a></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
};
process.on('exit', () => { if (requests === 0) writeSync(2, 'no request was made\\n'); });
`);
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, 'tracked_companies: []\n');
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    delete env.CAREER_OPS_DATA_DIR;
    delete env.CAREER_OPS_PORTALS;
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'harvest-buildlist.mjs'),
      '--limit', '1', '--portals-file', portals, ...args], { cwd: dir, encoding: 'utf8', timeout: 30000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a run that resolved a board exits 0 with its JSON, without calling process.exit', () => {
  const result = runHarvest(['--json']);
  assert.equal(result.status, 0, describeSpawn(result));
  const { resolved } = JSON.parse(result.stdout);
  assert.deepEqual(resolved.map((r) => r.board), ['https://jobs.ashbyhq.com/acmerobotics']);
  assert.doesNotMatch(result.stderr, /process\.exit called|no request was made/, describeSpawn(result));
});

test('the default YAML run exits 0 with its entries, without calling process.exit', () => {
  const result = runHarvest([]);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /^ {2}- name: Acme Robotics\n {4}careers_url: https:\/\/jobs\.ashbyhq\.com\/acmerobotics$/m);
  assert.doesNotMatch(result.stderr, /process\.exit called|no request was made/, describeSpawn(result));
});

test('a request that fails exits 1 with its message, without calling process.exit', () => {
  const result = runHarvest(['--json'], { sitemapStatus: 404 });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'harvest-buildlist: HTTP 404');
});
