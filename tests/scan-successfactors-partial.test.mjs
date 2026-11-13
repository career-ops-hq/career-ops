import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

test('a failed SuccessFactors CSB page does not discard a successful sibling or hide partial coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-csb-partial-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'profile.yml'), '{}\n');
    const portals = join(root, 'portals.yml');
    writeFileSync(portals, [
      'tracked_companies:',
      '  - name: Example Careers',
      '    careers_url: https://careers.example.com',
      '    provider: successfactors',
      '    sfVariant: csb',
      'job_boards: []',
      '',
    ].join('\n'));
    const preload = join(root, 'stub-fetch.mjs');
    writeFileSync(preload, `
      globalThis.fetch = async (url, options) => {
        const { hostname, pathname } = new URL(url);
        if (hostname !== 'careers.example.com') throw new Error('Unexpected host: ' + hostname);
        if (pathname === '/search/') return new Response('<a href="/search/?locale=en_US">en</a>');
        if (pathname !== '/services/recruiting/v1/jobs') throw new Error('Unexpected path: ' + pathname);
        const { pageNumber } = JSON.parse(options.body);
        if (pageNumber === 1) return new Response('unavailable', { status: 503 });
        return Response.json({
          totalJobs: 30,
          jobSearchResult: Array.from({ length: 10 }, (_, i) => {
            const id = String(1 + pageNumber * 10 + i);
            return { response: { id, unifiedStandardTitle: 'Engineer ' + id, unifiedUrlTitle: 'Engineer-' + id } };
          }),
        });
      };
    `);
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(preload).href, fileURLToPath(new URL('../scan.mjs', import.meta.url)), '--json', '--quiet',
    ], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PORTALS: portals },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, describeSpawn(result));
    const { found, partial, errors } = JSON.parse(result.stdout);
    const ledger = readFileSync(join(root, 'data', 'portal-health.tsv'), 'utf8').trim().split('\n').at(-1);
    assert.deepEqual({ found, partial, errors, health: ledger.split('\t').at(-1) }, {
      found: 20,
      partial: [{ company: 'Example Careers', reason: 'fetch-error', fetched: 20 }],
      errors: [],
      health: 'partial',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
