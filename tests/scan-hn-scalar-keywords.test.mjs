// tests/scan-hn-scalar-keywords.test.mjs — one hn_hiring keyword written
// without list brackets still filters.
//
// `hn_hiring.keywords: Platform Engineer` is a YAML scalar, not a list.
// scan-hn passed it straight to buildTitleFilter, which reads only a list and
// drops anything else, so the scanner's only positive filter disappeared and
// every HN post matched. (With GEMINI_API_KEY set the same scalar crashed the
// AI branch on `myKeywords.join`.) title_filter's bare-string case at least
// draws a validate-portals warning; hn_hiring has none.
//
// Runs the real scan-hn.mjs in keyword (no-AI) mode with the HN provider's
// fetch replaced by fixtures; any real network request fails the run.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const POSTS = [
  { title: 'Acme | Platform Engineer | Remote', url: 'https://news.ycombinator.com/item?id=900001', company: 'Acme', location: 'Remote' },
  { title: 'Globex | Marketing Manager | New York', url: 'https://news.ycombinator.com/item?id=900002', company: 'Globex', location: 'New York' },
];

/** Run scan-hn with `keywordsYaml` under hn_hiring; return the URLs that reached the pipeline. */
function scan(keywordsYaml) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-hn-scalar-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `hn_hiring:\n  keywords: ${keywordsYaml}\n`);
    writeFileSync(join(dir, 'posts.json'), JSON.stringify(POSTS));
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
    return readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8').match(/https:\/\/news\.ycombinator\.com\/item\?id=\d+/g) ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nscan-hn — a scalar hn_hiring.keywords is one keyword');

ok('`keywords: Platform Engineer` keeps the matching post and drops the other', () => {
  // THE BUG: both posts reached the pipeline.
  assert.deepStrictEqual(scan('Platform Engineer'), [POSTS[0].url]);
});

ok('premise: the list form behaves the same', () => {
  assert.deepStrictEqual(scan('["Platform Engineer"]'), [POSTS[0].url]);
});
