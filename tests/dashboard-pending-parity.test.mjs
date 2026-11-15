// The dashboard's Inbox tab (#5269) reads data/pipeline.md in Go. Two things
// it restates by hand must stay in step with the Node side:
//
// - the Pending/Processed headings, a Go copy of SECTION_PAIRS in
//   lib/pipeline-sections.mjs, and the accent fold applied to them;
// - the row grammar of the web inbox's parseInbox, held to it by one fixture
//   that dashboard/internal/data/pending_test.go also reads.
//
// The web half runs only when web/src exists (a core-only install has none).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ndashboard Inbox: Go reader in step with the Node pipeline readers');

function check(name, fn) {
  try { fn(); pass(name); }
  catch (error) { fail(`${name}: ${error.message}`); }
}

const goSource = readFileSync(join(ROOT, 'dashboard', 'internal', 'data', 'pending.go'), 'utf8');
const jsSource = readFileSync(join(ROOT, 'lib', 'pipeline-sections.mjs'), 'utf8');

check('the Go section table lists the same heading pairs as lib/pipeline-sections.mjs, in order', () => {
  const js = jsSource.match(/const SECTION_PAIRS = \[([\s\S]*?)\n\];/);
  assert.ok(js, 'SECTION_PAIRS not found in lib/pipeline-sections.mjs');
  const jsPairs = [...js[1].matchAll(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)].map(m => [m[1], m[2]]);
  const go = goSource.match(/var pendingSectionPairs = \[\]\[2\]string\{([\s\S]*?)\n\}/);
  assert.ok(go, 'pendingSectionPairs not found in dashboard/internal/data/pending.go');
  const goPairs = [...go[1].matchAll(/\{\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\}/g)].map(m => [m[1], m[2]]);
  assert.ok(jsPairs.length > 0, 'no pairs read from lib/pipeline-sections.mjs');
  assert.deepEqual(goPairs, jsPairs);
});

check('the Go heading fold maps each Latin letter as NFD and dropping U+0300-U+036F do', () => {
  const from = goSource.match(/headingFoldFrom = "([^"]*)"/);
  const to = goSource.match(/headingFoldTo\s+= "([^"]*)"/);
  assert.ok(from && to, 'headingFoldFrom / headingFoldTo not found in pending.go');
  const goFold = new Map([...from[1]].map((ch, i) => [ch, [...to[1]][i]]));
  assert.equal([...from[1]].length, [...to[1]].length, 'the two fold strings differ in length');
  for (let cp = 0xc0; cp <= 0x17f; cp++) {
    const ch = String.fromCodePoint(cp);
    const node = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (node === ch) {
      assert.ok(!goFold.has(ch), `Go folds ${ch} (U+${cp.toString(16).toUpperCase()}), Node keeps it`);
    } else {
      assert.equal(goFold.get(ch), node, `fold of ${ch} (U+${cp.toString(16).toUpperCase()})`);
    }
  }
});

check('every heading in lib/pipeline-sections.mjs uses only letters the Go fold can match', () => {
  // The fold table above covers U+00C0-U+017F. A heading with another letter
  // that NFD decomposes (Vietnamese, Cyrillic й) would pass the pair check and
  // still fail to match a hand-typed variant in Go. Hangul syllables decompose
  // too, but both sides compare them as typed, so they are allowed.
  const from = new Set([...goSource.match(/headingFoldFrom = "([^"]*)"/)[1]]);
  const js = jsSource.match(/const SECTION_PAIRS = \[([\s\S]*?)\n\];/)[1];
  for (const [, a, b] of js.matchAll(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)) {
    for (const ch of a + b) {
      const cp = ch.codePointAt(0);
      if (ch.normalize('NFD') === ch || from.has(ch) || (cp >= 0xac00 && cp <= 0xd7a3)) continue;
      assert.fail(`heading "${a}"/"${b}" uses ${ch} (U+${cp.toString(16).toUpperCase()}), which the Go fold in pending.go does not cover`);
    }
  }
});

const fixtureDir = join(ROOT, 'dashboard', 'internal', 'data', 'testdata');
const webTable = join(ROOT, 'web', 'src', 'lib', 'pipeline-table.mjs');
const webRank = join(ROOT, 'web', 'src', 'lib', 'core', 'inbox-rank.mjs');

if (!existsSync(join(ROOT, 'web', 'src'))) {
  pass('web/ not installed; the parseInbox fixture check is skipped (the Go half still runs in go test)');
} else {
  const { parseInbox } = await import(pathToFileURL(webTable).href);
  const { parseRankStamp } = await import(pathToFileURL(webRank).href);
  check('web parseInbox reads the shared fixture as the Go reader is held to', () => {
    const md = readFileSync(join(fixtureDir, 'pending-parity.md'), 'utf8');
    const expected = JSON.parse(readFileSync(join(fixtureDir, 'pending-parity.json'), 'utf8'));
    const got = parseInbox(md)
      .filter(row => !row.done)
      .map(row => ({
        url: row.url,
        company: row.company,
        role: row.role,
        location: row.location ?? '',
        posted: row.postedAt ?? '',
        rank: parseRankStamp(row.rankStamp)?.score ?? null,
      }));
    assert.ok(expected.length > 0, 'the fixture expects no rows');
    assert.deepEqual(got, expected);
  });
}
