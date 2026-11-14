// tests/outcome-placeholder-employer-capture.test.mjs — outcome.mjs keeps the
// posting it archives for a row whose employer is the `?` placeholder.
//
// For a row with no capture, outcome.mjs runs archive-posting.mjs with
// --company=?. captureSlug('?') is empty, so the capture was written as
// `015-{date}__platform-engineer_{hash}.pdf`, and the lookup that follows,
// which uses `unknown` for a company with no slug, matched nothing: the run
// filed a "posting missing" stub, and the next run archived the posting again.
// archive-posting.mjs now names that company `unknown`, as it does when no
// company was detected at all.
//
// Both CLIs run for real. A fake `playwright`, loaded through NODE_OPTIONS so
// that the archive-posting child gets it too, serves the posting, so nothing
// opens a browser or touches the network.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

console.log('\noutcome.mjs — the posting archived for a `?` employer is found and kept');

const root = mkdtempSync(join(tmpdir(), 'outcome-placeholder-employer-'));
try {
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'jds'), { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| 8 | 2026-10-01 | ? | Platform Engineer | 4.2/5 | Applied | ❌ | [15](../reports/015-unknown-2026-10-01.md) | via agency | https://job-boards.greenhouse.io/acme/jobs/7009 |',
    '',
  ].join('\n'));

  const body = 'Platform Engineer\n\n' + 'You will run the infrastructure behind our client\'s payments platform, from provisioning to deployment. '.repeat(10);
  const fake = join(root, 'fake-playwright.mjs');
  writeFileSync(fake, `
const page = {
  _url: null,
  async goto(url) { page._url = url; return { status: () => 200 }; },
  url() { return page._url; },
  async waitForTimeout() {},
  async title() { return 'Platform Engineer | Recruiting Partner'; },
  async $eval() { return 'Platform Engineer'; },
  async evaluate() { return ${JSON.stringify(body)}; },
  async pdf() { return Buffer.from('%PDF-fake posting capture'); },
};
export const chromium = {
  launch: async () => ({
    newContext: async () => ({ newPage: async () => page, route: async () => {}, close: async () => {} }),
    close: async () => {},
  }),
};
`);
  const hooks = join(root, 'hooks.mjs');
  writeFileSync(hooks, `
const FAKE = ${JSON.stringify(pathToFileURL(fake).href)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') return { url: FAKE, shortCircuit: true };
  return nextResolve(specifier, context);
}
`);
  const register = join(root, 'register.mjs');
  writeFileSync(register, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CAREER_OPS_|NODE_OPTIONS$)/.test(k)));
  Object.assign(env, { CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, NODE_OPTIONS: `--import=${pathToFileURL(register).href}` });
  const record = () => {
    const r = spawnSync(NODE, [join(ROOT, 'outcome.mjs'), '8', 'rejected', '--json'], { cwd: root, encoding: 'utf-8', timeout: 120000, env });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* reported below */ }
    return { status: r.status, json, out: `${r.stdout}${r.stderr}` };
  };

  const first = record();
  const captures = readdirSync(join(root, 'jds'));
  if (first.status === 0 && captures.length === 1 && /^015-\d{4}-\d{2}-\d{2}_unknown_platform-engineer_[0-9a-f]{16}\.pdf$/.test(captures[0])) {
    pass('the capture for a `?` employer is filed under `unknown`, keyed to the report');
  } else {
    fail(`capture name: exit ${first.status}, jds ${JSON.stringify(captures)}\n${first.out.slice(-600)}`);
  }

  const posting = first.json ? join(first.json.outcomeDir, 'posting.pdf') : '';
  if (first.json?.postingArchived === true && existsSync(posting) && readFileSync(posting, 'utf-8') === '%PDF-fake posting capture') {
    pass('outcome.mjs finds the posting it just archived and keeps it as the record');
  } else {
    fail(`postingArchived ${JSON.stringify(first.json?.postingArchived)}, posting.pdf ${existsSync(posting) ? 'present' : 'missing'}`);
  }

  const second = record();
  const after = readdirSync(join(root, 'jds'));
  if (second.status === 0 && second.json?.postingArchived === true && after.length === 1) {
    pass('a second outcome reuses that capture instead of archiving the posting again');
  } else {
    fail(`second run: exit ${second.status}, postingArchived ${JSON.stringify(second.json?.postingArchived)}, jds ${JSON.stringify(after)}`);
  }
} catch (e) {
  fail(`placeholder-employer capture test crashed: ${e.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
