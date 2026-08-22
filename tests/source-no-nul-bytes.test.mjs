// tests/source-no-nul-bytes.test.mjs — no tracked TEXT file may contain a raw
// NUL byte.
//
// Why this is worth a test rather than a style note: a NUL byte makes the whole
// file "binary" to the tools we search it with, and the failure is silent.
// `grep PATTERN file` prints nothing and exits 1 — byte-for-byte the same answer
// as "that pattern is not in this file". Tools that pass `-I` (ripgrep and
// ugrep do by default, and several editor/agent search paths do too) skip the
// file entirely and report zero matches with a clean exit code.
//
// So a single invisible byte turns every future search of that file into a
// confident false negative, and there is nothing on screen to suggest it. That
// is the expensive part: not the byte, but that an absence of evidence and
// evidence of absence become indistinguishable.
//
// Found in dedup-tracker.mjs (2026-08-07): `const BLIND_KEY = '<NUL>blind-via:'`
// used a raw NUL as an uncollidable key prefix. Written as the `\u0000` escape
// it is the identical string at runtime (verified: the escape form `===` the
// raw form, length 11, codePointAt(0) === 0) and the file stays greppable.
//
// The rule is therefore "escape it, don't embed it", never "don't use NUL".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Extensions whose contents we read, search and diff as text. Deliberately an
// allowlist: a new genuinely-binary asset with an unfamiliar extension should
// not fail this test, whereas a new source file with a familiar one should be
// covered from the moment it lands.
const TEXT_EXTENSIONS = new Set([
  '.mjs', '.js', '.ts', '.tsx', '.go', '.sh', '.nix',
  '.md', '.txt', '.tex', '.html', '.css', '.svg',
  '.json', '.yml', '.yaml', '.tsv', '.cff', '.mod', '.sum', '.example', '.lock',
]);

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' });
  return out.split('\0').filter(Boolean).filter((f) => TEXT_EXTENSIONS.has(extname(f).toLowerCase()));
}

test('no tracked text file contains a raw NUL byte', () => {
  const files = trackedTextFiles();

  // Guard the guard: if the file list ever comes back empty (wrong cwd, git
  // missing, a listing flag that changed), this test would "pass" by checking
  // nothing — the exact silent-absence failure it exists to catch.
  assert.ok(files.length > 100, `expected to scan the tracked source tree, got ${files.length} files`);

  const offenders = [];
  for (const f of files) {
    const abs = join(ROOT, f);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue; // listed but absent (submodule, sparse checkout)
    }
    const buf = readFileSync(abs);
    const at = buf.indexOf(0);
    if (at !== -1) {
      const line = buf.subarray(0, at).toString('utf-8').split('\n').length;
      offenders.push(`${f}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `raw NUL byte in tracked text file(s): ${offenders.join(', ')}\n`
      + 'A NUL makes the file "binary": grep reports no match for every pattern in it, '
      + 'silently and with the same exit code as a real absence. '
      + 'Write it as the \\u0000 escape instead — identical value at runtime, file stays greppable.',
  );
});

test('the check actually detects a NUL (control)', () => {
  // Without this, a bug in the scan above would make the first test pass on an
  // offending tree. Uses the same detection path against a known-bad buffer.
  const bad = Buffer.from([0x61, 0x00, 0x62]);
  assert.equal(bad.indexOf(0), 1, 'the detection used above must find an embedded NUL');

  const good = Buffer.from('a\\u0000b', 'utf-8'); // the escape, as source text
  assert.equal(good.indexOf(0), -1, 'the escape form must NOT trip the check');
});
