// tests/status-aliases-from-states.test.mjs — analyze-patterns and
// tracker-sync-check resolve statuses through templates/states.yml.
//
// Both carried a hand-copied alias table whose comment said it mirrored
// verify-pipeline.mjs, which has derived its own from states.yml for a long
// time. The copies had drifted from states.yml (no Turkish alias in either) and
// from each other (tracker-sync-check lacked the hired aliases analyze-patterns
// had). A localized interview, offer or hire row was counted as "pending" by the
// pattern analysis, and compared as an unrecognized status by the sync check.
//
// Every assertion below iterates states.yml itself, so an alias added there is
// covered here without touching this file.
import { pass, fail, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const load = (file) => import(pathToFileURL(join(ROOT, file)).href);

const { loadCanonicalStates, resolveCanonicalStateId } = await load('tracker-utils.mjs');
const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
// Every spelling states.yml accepts for a state: its id, label and aliases.
const spellings = (s) => [s.id, s.label, ...s.aliases];

ok('resolveCanonicalStateId maps every states.yml spelling to its id', () => {
  for (const s of states) {
    for (const text of spellings(s)) {
      assert.equal(resolveCanonicalStateId(text, states), s.id, `"${text}"`);
    }
  }
  assert.equal(resolveCanonicalStateId('**Mülakat** 2026-06-01', states), 'interview', 'bold and a trailing date are stripped');
  assert.equal(resolveCanonicalStateId('TEKLİF', states), 'offer', 'Turkish dotted capital I folds');
  assert.equal(resolveCanonicalStateId('not a status', states), null);
  assert.equal(resolveCanonicalStateId('', states), null);
});

ok('neither script carries its own alias table', () => {
  for (const file of ['analyze-patterns.mjs', 'tracker-sync-check.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    assert.match(src, /resolveCanonicalStateId\(/, `${file} resolves through states.yml`);
    assert.match(src, /loadCanonicalStates\(/, `${file} loads states.yml`);
    // An alias is by definition not an id; a quoted one outside the self-test
    // fixtures is a table growing back.
    const body = src.split(/\n(?:async )?function runSelfTest\b/)[0];
    for (const s of states) {
      for (const alias of s.aliases.filter(a => !states.some(o => o.id === a))) {
        assert.ok(!body.includes(`'${alias}':`), `${file} hardcodes the alias '${alias}'`);
      }
    }
  }
});

const { classifyOutcome } = await load('analyze-patterns.mjs');
ok('analyze-patterns buckets every states.yml spelling like its canonical label', () => {
  for (const s of states) {
    for (const text of spellings(s)) {
      assert.equal(classifyOutcome(text), classifyOutcome(s.label), `"${text}" vs "${s.label}"`);
    }
  }
  assert.equal(classifyOutcome('Mülakat'), 'positive');
  assert.equal(classifyOutcome('işe alındı'), 'positive');
  assert.equal(classifyOutcome('reddedildi'), 'negative');
  assert.equal(classifyOutcome('başvuruldu 2026-06-01'), 'awaiting');
});

const sync = await load('tracker-sync-check.mjs');
ok('tracker-sync-check normalizes every states.yml spelling to its id', () => {
  for (const s of states) {
    for (const text of spellings(s)) {
      assert.equal(sync.normalizeStatus(text), s.id, `"${text}"`);
    }
  }
  // The hired aliases were missing from this script's copy even though
  // analyze-patterns had them.
  assert.equal(sync.normalizeStatus('contratado'), 'hired');
  assert.equal(sync.compareLifecycle(sync.normalizeStatus('Mülakat'), sync.normalizeStatus('Evaluated')).cmp, 1);
  assert.equal(sync.normalizeStatus('Some Unknown'), 'some unknown', 'an unknown status keeps its own text');
});
