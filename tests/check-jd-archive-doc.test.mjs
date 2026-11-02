// tests/check-jd-archive-doc.test.mjs — the check-jd-archive section of
// docs/SCRIPTS.md names every flag the script accepts and every finding type
// it emits.
//
// The section once named only missing-jd-archive and four of the seven flags,
// so it never mentioned the tracker join that decides whether a miss fails the
// run (--tracker, --no-tracker, jd-archive-review-due) or the sent applications
// reported with no archive at all (application-no-archive).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';

const SCRIPT = join(ROOT, 'check-jd-archive.mjs');

function docSection() {
  const doc = readFileSync(join(ROOT, 'docs', 'SCRIPTS.md'), 'utf8');
  const start = doc.indexOf('## check-jd-archive');
  assert.notEqual(start, -1, 'docs/SCRIPTS.md has no "## check-jd-archive" section');
  const rest = doc.slice(start + 1);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

test('docs/SCRIPTS.md lists every flag check-jd-archive.mjs --help prints', () => {
  const usage = execFileSync(NODE, [SCRIPT, '--help'], { encoding: 'utf8', windowsHide: true });
  const flags = [...new Set(usage.match(/--[a-z][a-z-]*/g))];
  assert.ok(flags.length >= 7, `expected at least 7 flags in --help, got ${flags.join(' ')}`);
  const section = docSection();
  const missing = flags.filter((flag) => !section.includes(`check-jd-archive.mjs ${flag}`));
  assert.deepEqual(missing, [], `flags in --help but not in docs/SCRIPTS.md: ${missing.join(' ')}`);
});

test('docs/SCRIPTS.md names every finding type check-jd-archive.mjs emits', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const types = [...new Set([...source.matchAll(/type: '([a-z-]*archive[a-z-]*)'/g)].map((m) => m[1]))];
  assert.ok(types.length >= 3, `expected at least 3 finding types in the source, got ${types.join(' ')}`);
  const section = docSection();
  const missing = types.filter((type) => !section.includes(`\`${type}\``));
  assert.deepEqual(missing, [], `finding types not named in docs/SCRIPTS.md: ${missing.join(' ')}`);
});
