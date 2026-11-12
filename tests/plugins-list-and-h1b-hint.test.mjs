// `plugins.mjs available` names who publishes each community plugin, and
// `plugins.mjs run h1b-sponsor` says why it finds nothing instead of printing a
// bare "0 found, 0 new".
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

console.log('\nplugins: community authors and the h1b-sponsor hint');

const { registryAuthor } = await import(pathToFileURL(join(ROOT, 'plugins.mjs')).href);
const { loadRegistry } = await import(pathToFileURL(join(ROOT, 'plugins', '_registry.mjs')).href);

function check(ok, msg, detail = '') {
  if (ok) pass(msg);
  else fail(detail ? `${msg}\n${detail}` : msg);
}

// CAREER_OPS_ROOT stays the scratch root tests/helpers.mjs pins.
function plugins(args) {
  return spawnSync(NODE, [join(ROOT, 'plugins.mjs'), ...args], { cwd: ROOT, env: process.env, encoding: 'utf8' });
}

{
  const cases = [
    [{ author: 'fabrikam-dev', repo: 'https://github.com/contoso/career-ops-plugin-x' }, 'fabrikam-dev'],
    [{ repo: 'https://github.com/contoso/career-ops-plugin-x' }, 'contoso'],
    [{ author: '  ', repo: 'https://github.com/contoso/career-ops-plugin-x.git' }, 'contoso'],
    [{ repo: 'https://gitlab.example/contoso/x' }, null],
    [{}, null],
  ];
  const wrong = cases.filter(([entry, want]) => registryAuthor(entry) !== want);
  check(wrong.length === 0, 'registryAuthor prefers author, then the GitHub repo owner',
    wrong.map(([e, want]) => `  ${JSON.stringify(e)} → ${registryAuthor(e)} (want ${want})`).join('\n'));
}

{
  const r = plugins(['available']);
  check(r.status === 0 && /Community plugins approved/.test(r.stdout) && !/by undefined/.test(r.stdout),
    'available lists community plugins without "by undefined"', r.stdout + r.stderr);
  // Each entry names its publisher, from author or the repo owner, and an
  // entry with neither shows only its version.
  const suffix = (p) => (registryAuthor(p) ? `(by ${registryAuthor(p)}, v${p.version})` : `(v${p.version})`);
  const missing = loadRegistry(ROOT).plugins
    .filter((p) => !r.stdout.split('\n').some((l) => l.includes(`${p.name}  `) && l.includes(suffix(p))))
    .map((p) => p.name);
  check(missing.length === 0, 'available names the publisher of every registry entry', `missing: ${missing.join(', ')}`);
}

// The hook is called directly: a real `plugins.mjs run` pins plugins.lock in
// the code root, which a suite must not write.
const { default: h1b } = await import(pathToFileURL(join(ROOT, 'plugins', 'h1b-sponsor', 'index.mjs')).href);

async function h1bIngest({ index, apiBase }) {
  const dir = mkdtempSync(join(tmpdir(), 'co-h1b-hint-'));
  const saved = process.env.H1B_INDEX_PATH;
  const lines = [];
  try {
    const indexPath = join(dir, index ? 'index.jsonl.gz' : 'no-index');
    if (index) writeFileSync(indexPath, '');
    process.env.H1B_INDEX_PATH = indexPath;
    const env = apiBase ? { H1B_API_BASE: apiBase } : {};
    const jobs = await h1b.ingest({ env, log: (...a) => lines.push(a.join(' ')) });
    return { jobs, out: lines.join('\n') };
  } finally {
    if (saved === undefined) delete process.env.H1B_INDEX_PATH;
    else process.env.H1B_INDEX_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const r = await h1bIngest({ index: false });
  check(r.jobs.length === 0
    && /node plugins\/h1b-sponsor\/install-h1b-index\.mjs/.test(r.out)
    && /node plugins\/h1b-sponsor\/check\.mjs/.test(r.out),
  'h1b-sponsor ingest names check.mjs and the index install command when no index is installed', r.out);
}

{
  const r = await h1bIngest({ index: true });
  check(r.jobs.length === 0 && !/install-h1b-index/.test(r.out) && /node plugins\/h1b-sponsor\/check\.mjs/.test(r.out),
    'h1b-sponsor ingest skips the install hint when an index is present', r.out);
}

{
  const r = await h1bIngest({ index: false, apiBase: 'https://h1b.example' });
  check(r.jobs.length === 0 && !/install-h1b-index/.test(r.out),
    'h1b-sponsor ingest skips the install hint when H1B_API_BASE is set', r.out);
}
