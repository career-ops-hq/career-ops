// tests/scan-hn-posted-date.test.mjs — scan-hn records an HN post's own date,
// not the day it was scanned.
//
// providers/hackernews.mjs sets each post's postedAt from the comment's
// created_at. scan-hn then overwrote it with Date.now() in both of its
// branches, so scan-history's posted_at column said every Who-is-hiring post
// went up the day it was scanned, weeks after many of them did. A guessed date
// is worse than an absent one (modes/oferta.md): it reads as a fresh req.
//
// Keyword (no-AI) mode, with the HN provider's fetch replaced by fixtures; any
// real network request fails the run.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const POST = {
  title: 'Acme | Software Engineer | Remote', url: 'https://news.ycombinator.com/item?id=910001',
  company: 'Acme', location: 'Remote', postedAt: Date.parse('2026-09-01T12:00:00Z'),
};

console.log('\nscan-hn — posted_at is the post\'s own date');

ok('scan-history records the comment date the provider read, not the scan date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-hn-posted-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, 'hn_hiring:\n  keywords: ["Software Engineer"]\n');
    writeFileSync(join(dir, 'posts.json'), JSON.stringify([POST]));
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, [
      "import { readFileSync } from 'node:fs';",
      `import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'hackernews.mjs')).href)};`,
      "const posts = JSON.parse(readFileSync(new URL('./posts.json', import.meta.url), 'utf-8'));",
      'provider.fetch = async () => posts;',
      "globalThis.fetch = async () => { throw new Error('Unexpected network request'); };",
      '',
    ].join('\n'));
    const { GEMINI_API_KEY: _key, ...env } = process.env;
    const r = spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan-hn.mjs')], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: portals },
    });
    assert.strictEqual(r.status, 0, `scan-hn exited ${r.status}: ${r.stdout}${r.stderr}`);
    const lines = readFileSync(join(dir, 'data', 'scan-history.tsv'), 'utf-8').trim().split('\n');
    const header = lines[0].split('\t');
    const row = lines.slice(1).map((l) => l.split('\t')).find((c) => c[0].includes('910001'));
    assert.ok(row, `no history row for the post: ${lines.join(' / ')}`);
    assert.strictEqual(row[header.indexOf('posted_at')], '2026-09-01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
