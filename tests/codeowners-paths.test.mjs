// tests/codeowners-paths.test.mjs — every CODEOWNERS entry names a path that
// exists, and the agent-facing files that protect the same paths agree with it.
//
// A CODEOWNERS pattern that matches nothing fails silently: GitHub requests no
// review and reports no error. `/plugins-registry.json` sat there for months
// after the registry was split into one file per plugin under plugins-registry/
// (#1401), so a PR that re-pinned a plugin — the SHA that decides which
// third-party code users install — was routed to no owner, while the line read
// as if the trust root were covered. The skill router had the same gap from the
// other side: all seven CLI skill directories symlink to
// .agents/skills/career-ops/SKILL.md, a path no owner entry or label glob named.
import { pass, fail, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { join, dirname, basename, resolve, relative, sep } from 'node:path';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const patterns = read('.github/CODEOWNERS').split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split(/\s+/)[0]);

// Anchored patterns only use a `*` in the last segment here; that is all this
// needs to resolve, and anything fancier fails loudly instead of passing unread.
function matchesSomething(pattern) {
  assert.ok(pattern.startsWith('/'), `${pattern}: only root-anchored patterns are understood by this test`);
  const rel = pattern.slice(1).replace(/\/$/, '');
  if (!rel.includes('*')) {
    if (!existsSync(join(ROOT, rel))) return false;
    // A trailing slash claims a directory.
    return !pattern.endsWith('/') || lstatSync(join(ROOT, rel)).isDirectory();
  }
  const dir = dirname(rel);
  assert.ok(!dir.includes('*'), `${pattern}: a wildcard outside the last segment is not understood by this test`);
  if (!existsSync(join(ROOT, dir))) return false;
  const re = new RegExp('^' + basename(rel).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return readdirSync(join(ROOT, dir)).some(name => re.test(name));
}

// web/ ships in the release tag but is not in update-system.mjs's manifest
// (#3269), so an install updated with `apply` has no web/ directory. Its
// CODEOWNERS entry is still correct for a full checkout; only the existence
// check has to tolerate the documented absence, the way the web-dependent
// suites do (#1675, #3563, #3608, #4165, #4706). When web/ is present the
// check stays strict, so a pattern that stops matching is still caught.
const webInstalled = existsSync(join(ROOT, 'web'));
const absentOptionalPath = (p) => p === '/web/' && !webInstalled;

ok('every CODEOWNERS pattern matches a path that exists', () => {
  assert.ok(patterns.length > 10, 'CODEOWNERS parsed');
  assert.ok(patterns.includes('/web/'), 'web/ is still owned');
  assert.deepEqual(patterns.filter(p => !absentOptionalPath(p) && !matchesSomething(p)), []);
});

ok('the plugin registry directory is owned, not the deleted single file', () => {
  assert.ok(existsSync(join(ROOT, 'plugins-registry')) && !existsSync(join(ROOT, 'plugins-registry.json')),
    'the registry is the plugins-registry/ directory');
  assert.ok(patterns.includes('/plugins-registry/'));
  assert.ok(!patterns.includes('/plugins-registry.json'));
});

// The router is whatever the CLI skill entrypoints actually link to, read from
// the links themselves so a moved router fails here rather than going unowned.
// A checkout without symlink support (Windows, core.symlinks=false) holds each
// link as a one-line file naming its target, so read that form too. An install
// updated with `update-system.mjs apply` on such a system holds each entrypoint
// as a regular file with the router's full content instead (#2259, #2272), so
// a file whose content equals the router's counts as linking to it.
const ROUTER = join(ROOT, '.agents', 'skills', 'career-ops', 'SKILL.md');
const routerText = existsSync(ROUTER) ? readFileSync(ROUTER, 'utf-8') : null;
function linkTarget(p) {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return null;
  if (lstatSync(abs).isSymbolicLink()) return readlinkSync(abs);
  const text = readFileSync(abs, 'utf-8');
  if (text.length < 200 && /^[^\n]+SKILL\.md\s*$/.test(text)) return text.trim();
  if (abs !== ROUTER && text === routerText) return relative(dirname(abs), ROUTER);
  return null;
}
const skillLinks = readdirSync(ROOT)
  .map(d => join(d, 'skills', 'career-ops', 'SKILL.md'))
  .filter(p => linkTarget(p) !== null);
const routers = new Set(skillLinks.map(p =>
  relative(ROOT, resolve(join(ROOT, dirname(p)), linkTarget(p))).split(sep).join('/')));

ok('the skill router every CLI entrypoint links to has a code owner', () => {
  assert.ok(skillLinks.length >= 2, 'CLI skill symlinks found');
  assert.deepEqual([...routers], ['.agents/skills/career-ops/SKILL.md'], 'one router');
  for (const router of routers) assert.ok(patterns.includes(`/${router}`), `/${router} is not in CODEOWNERS`);
});

ok('every root CLI wrapper named in copilot-instructions has a code owner', () => {
  const wrappers = [...read('.github/copilot-instructions.md').matchAll(/`([A-Z]+\.md)`/g)]
    .map(m => m[1]).filter(f => /^(CLAUDE|AGENTS|CODEX|OPENCODE|KIMI|GEMINI)\.md$/.test(f));
  assert.ok(wrappers.includes('KIMI.md'));
  assert.deepEqual([...new Set(wrappers)].filter(f => !patterns.includes(`/${f}`)), []);
});

ok('copilot-instructions protects plugins-registry/, not the deleted file', () => {
  const doc = read('.github/copilot-instructions.md');
  assert.ok(!doc.includes('plugins-registry.json'), 'names the deleted plugins-registry.json');
  const controlFiles = doc.split('\n').find(l => l.includes('**control files**'));
  assert.ok(controlFiles && controlFiles.includes('`plugins-registry/`'), 'control files list names plugins-registry/');
});

ok('the agent-behavior label fires on the router, not only on its symlinks', () => {
  const labeler = read('.github/labeler.yml');
  const block = labeler.slice(labeler.indexOf('agent-behavior'), labeler.indexOf('"🔧 scripts"'));
  for (const router of routers) {
    const glob = `${router.split('/').slice(0, 2).join('/')}/**`;
    assert.ok(block.includes(`- ${glob}`), `${glob} missing from the agent-behavior globs`);
  }
  // Each symlink directory is a path a PR can also touch (retargeting the link).
  for (const link of skillLinks) {
    const glob = `${link.split(sep).slice(0, 2).join('/')}/**`;
    assert.ok(block.includes(`- ${glob}`), `${glob} missing from the agent-behavior globs`);
  }
});
