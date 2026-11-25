// tests/labeler-globs.test.mjs — the "🌐 i18n" and "📦 dependencies" rules in
// .github/labeler.yml name every path they are meant to cover.
//
// actions/labeler cannot import JavaScript, so its globs are a static copy of
// what lib/mode-sets.mjs and the tracked manifests already say. Both copies had
// drifted: i18n named five of twenty translation directories, and dependencies
// named a root package-lock.json that has been gitignored since d01925e9 while
// missing web/, scaffolder/ and dashboard/ (a Dependabot web bump, #6648, went
// out without the 📦 label).
import { pass, fail, warn, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isLanguageModeSet, MARKET_MODE_SETS } from '../lib/mode-sets.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const labeler = readFileSync(join(ROOT, '.github/labeler.yml'), 'utf-8');

/** The `- glob` entries under one top-level label, comments dropped. */
function globsFor(label) {
  const start = labeler.indexOf(`"${label}":`);
  assert.ok(start !== -1, `label "${label}" not found`);
  const rest = labeler.slice(start + 1);
  const next = rest.search(/^"/m);
  const block = next === -1 ? rest : rest.slice(0, next);
  return block.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') && !l.startsWith('- changed-files') && !l.startsWith('- any-glob'))
    .map((l) => l.slice(2).replace(/^"(.*)"$/, '$1'));
}

ok('the i18n label names every translation directory and no market set', () => {
  const modesDir = join(ROOT, 'modes');
  const langs = readdirSync(modesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isLanguageModeSet(e.name) && existsSync(join(modesDir, e.name, 'README.md')))
    .map((e) => `modes/${e.name}/**`)
    .sort();
  const listed = globsFor('🌐 i18n').filter((g) => g.startsWith('modes/')).sort();
  assert.deepStrictEqual(listed, langs);
  for (const m of MARKET_MODE_SETS) assert.ok(!listed.includes(`modes/${m}/**`), `market set modes/${m}/ under i18n`);
});

ok('the dependencies label names exactly the tracked manifests and lockfiles', () => {
  const git = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' });
  if (git.status !== 0) {
    warn('not a git checkout: skipped the dependencies-label check against tracked files');
    return;
  }
  const manifest = /(^|\/)(package\.json|package-lock\.json|go\.mod|go\.sum)$/;
  // Fixtures and test trees carry manifests of their own that no dependency
  // bump touches; only a root or first-level project counts.
  const tracked = git.stdout.split('\0')
    .filter((p) => manifest.test(p) && p.split('/').length <= 2)
    .sort();
  assert.deepStrictEqual(globsFor('📦 dependencies').sort(), tracked);
});
