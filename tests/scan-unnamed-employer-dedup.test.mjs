// tests/scan-unnamed-employer-dedup.test.mjs — postings whose board cannot name
// the employer are deduplicated by URL, never by an empty company+title key.
//
// providers/_types.js documents that `company` "may be empty when the source
// can't expose it at the list-page level", and builtin, platsbanken, justjoin
// and vdab return `company: ''` for such cards. scan.mjs built the company+role
// key from it anyway: companyRoleDedupKey('', title) is `::{title}`, one key
// for every unnamed employer. The first "Senior Software Engineer" claimed it,
// and the next one, from a different company at a different URL, was counted
// in "Duplicates: N skipped" and never reached pipeline.md or scan-history.
// The seeding side already refuses to key a row with no company
// (collectSeenCompanyRoles: `if (!c || !r) return;`); the scan side now
// matches it.
//
// Runs the real scan.mjs with the builtin provider's fetch replaced by a
// fixture, the preload technique scan-remote-title-fallback-e2e.test.mjs
// uses. Any real network request fails the run.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

/** Scan one builtin board whose fetch returns `jobs`; return the URLs that reached pipeline.md. */
function scan(jobs) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-unnamed-employer-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, [
      'title_filter:',
      '  positive: [Engineer]',
      'job_boards:',
      '  - name: Built In',
      '    provider: builtin',
      '    builtin:',
      '      queries: ["software engineer"]',
      '    enabled: true',
      '',
    ].join('\n'));
    // The fixtures travel as a JSON file the preload reads, not as source text
    // spliced into the preload: data never becomes code.
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify(jobs));
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, [
      "import { readFileSync } from 'node:fs';",
      `import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'builtin.mjs')).href)};`,
      "const jobs = JSON.parse(readFileSync(new URL('./jobs.json', import.meta.url), 'utf-8'));",
      'provider.fetch = async () => jobs;',
      '// Fail closed if the fixture ever starts making real requests.',
      "globalThis.fetch = async () => { throw new Error('Unexpected network request'); };",
      '',
    ].join('\n'));
    const r = spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan.mjs')], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: portals },
    });
    assert.strictEqual(r.status, 0, `scan.mjs exited ${r.status}: ${r.stderr}`);
    const pipeline = join(dir, 'data', 'pipeline.md');
    return existsSync(pipeline)
      ? readFileSync(pipeline, 'utf-8').split('\n').map(l => l.match(/^- \[[ x]\]\s+(https?:\/\/\S+)/)?.[1]).filter(Boolean)
      : [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const job = (n, company) => ({
  title: 'Senior Software Engineer',
  url: `https://builtin.com/job/senior-software-engineer/${n}`,
  company,
  location: 'Remote',
  description: '',
});

console.log('\nscan.mjs — an unnamed employer is deduplicated by URL only');

ok('two unnamed employers with the same title both reach the pipeline', () => {
  // THE BUG: the second was counted as a duplicate of the first.
  const urls = scan([job(1001, ''), job(2002, '')]);
  assert.deepStrictEqual(urls.sort(), [job(1001, '').url, job(2002, '').url]);
});

ok('the same URL from an unnamed employer is still one entry', () => {
  // URL dedup still applies: dropping the key must not let a repeat through.
  const urls = scan([job(1001, ''), job(1001, '')]);
  assert.deepStrictEqual(urls, [job(1001, '').url]);
});

ok('a NAMED employer posting the same title twice is still collapsed', () => {
  // Control: company+role dedup itself is unchanged where there is a company.
  const urls = scan([job(1001, 'Acme'), job(2002, 'Acme')]);
  assert.strictEqual(urls.length, 1, JSON.stringify(urls));
});
