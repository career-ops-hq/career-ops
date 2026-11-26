// tests/mode-sets.test.mjs — lib/mode-sets.mjs names the market sets the
// README titles describe, and the two tools that read it agree with it.
//
// A directory name cannot tell `modes/sg/` (English modes for Singapore) from
// `modes/de/` (a German translation). Both tools that used a name pattern
// misfiled the market sets: i18n-drift.mjs scored them as a third translated,
// and validate-untrusted-content-coverage.mjs skipped their ingesting modes.
// The list is explicit, so this suite is what keeps it current.
import { pass, fail, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MARKET_MODE_SETS, isLanguageModeSet, isLanguageMirrorPath, isMarketModeSet } from '../lib/mode-sets.mjs';
import { discoverLangs } from '../i18n-drift.mjs';
import { deriveIngestingModes } from '../validate-untrusted-content-coverage.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const modesDir = join(ROOT, 'modes');
const setDirs = readdirSync(modesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(modesDir, e.name, 'README.md')))
  .map((e) => e.name);
const title = (dir) => readFileSync(join(modesDir, dir, 'README.md'), 'utf-8').split('\n')[0];

ok('MARKET_MODE_SETS is exactly the set of modes/ READMEs titled "market mode"', () => {
  const titled = setDirs.filter((d) => /\bmarket mode\b/i.test(title(d))).sort();
  assert.deepStrictEqual([...MARKET_MODE_SETS].sort(), titled);
});

ok('market sets are not language sets, and the README-backed language dirs are', () => {
  for (const m of MARKET_MODE_SETS) assert.ok(!isLanguageModeSet(m), `${m} classified as a language`);
  for (const lang of ['de', 'zh-TW', 'pt']) assert.ok(isLanguageModeSet(lang), `${lang} not classified as a language`);
  for (const group of ['interview', 'pdf', 'regional', 'heuristics']) {
    assert.ok(!isLanguageModeSet(group) && !isMarketModeSet(group), `${group} classified as a mode set`);
  }
});

ok('isLanguageMirrorPath covers translation files only', () => {
  assert.ok(isLanguageMirrorPath('modes/de/angebot.md'));
  assert.ok(isLanguageMirrorPath('modes/zh-TW/oferta.md'));
  assert.ok(!isLanguageMirrorPath('modes/sg/pipeline.md'));
  assert.ok(!isLanguageMirrorPath('modes/pipeline.md'));
  assert.ok(!isLanguageMirrorPath('modes/de'));
});

ok('i18n-drift discovers no market set as a language', () => {
  const langs = discoverLangs(ROOT);
  for (const m of MARKET_MODE_SETS) assert.ok(!langs.includes(m), `${m} reported as a language`);
  assert.ok(langs.includes('de') && langs.includes('zh-TW'), `expected translations missing: ${langs.join(', ')}`);
});

ok('the untrusted-content validator requires the market sets\' ingesting modes', () => {
  const rels = MARKET_MODE_SETS.flatMap((m) => ['_shared.md', 'pipeline.md'].map((f) => `modes/${m}/${f}`));
  const required = deriveIngestingModes(rels, (rel) => readFileSync(join(ROOT, rel), 'utf-8'));
  assert.deepStrictEqual(required, [...rels].sort());
});
