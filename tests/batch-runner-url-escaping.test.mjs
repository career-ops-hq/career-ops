// tests/batch-runner-url-escaping.test.mjs — the offer URL survives the sed
// interpolation into the worker prompt, query strings included.
//
// THE BUG THIS PINS
//
// process_offer() in batch/batch-runner.sh interpolates the offer URL into the
// worker prompt with `sed -e "s|{{URL}}|${esc_url}|g"`. It escapes `\` and `|`
// in the URL, but in a sed REPLACEMENT `&` also means "the whole match". An
// unescaped `&` in a query-string URL (…?utm_source=a&utm_medium=b) therefore
// splices the literal `{{URL}}` back in, corrupting every offer whose URL
// carries query parameters — which is most tracked postings.
//
// This test extracts the REAL esc_url escaping out of batch/batch-runner.sh and
// runs it through the same `s|{{URL}}|…|g` substitution, rather than restating
// it, so the two cannot drift apart.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — offer URL escaping');

// Pull the real escaping lines and the substitution clause out of the script.
const escUrlLines = [...SRC.matchAll(/^\s*esc_url=.*$/gm)].map((m) => m[0].trim());
const sedClause = SRC.match(/-e "(s\|\{\{URL\}\}\|\$\{esc_url\}\|g)"/);

if (escUrlLines.length < 2) {
  fail('could not find the esc_url escaping in batch/batch-runner.sh — this test needs updating');
} else if (!sedClause) {
  fail('could not find the {{URL}} sed substitution in batch/batch-runner.sh — this test needs updating');
} else {
  // Guard: the & escaping is what this test exists to defend.
  if (escUrlLines.some((l) => /esc_url=.*&.*\\&/.test(l))) {
    pass('esc_url escapes & (the sed "whole match" metacharacter)');
  } else {
    fail('esc_url does not escape & — a query-string URL will corrupt the {{URL}} interpolation');
  }

  // End to end, using the REAL escaping + the REAL substitution clause.
  const work = mkdtempSync(join(tmpdir(), 'cops-urlesc-'));
  try {
    const script = join(work, 'check.sh');
    // A URL that exercises all three escaped metacharacters: & (query string),
    // | (the sed delimiter), and \ (a literal backslash).
    const url = 'https://ex.com/j?utm_source=a&utm_medium=b&q=x|y\\z';
    writeFileSync(script, [
      '#!/usr/bin/env bash',
      'set -u',
      `url='https://ex.com/j?utm_source=a&utm_medium=b&q=x|y\\z'`,
      ...escUrlLines,
      `printf '%s\\n' 'X {{URL}} Y' | sed -e "${sedClause[1]}"`,
    ].join('\n'));

    const out = execFileSync(getBash(), [script], { encoding: 'utf-8', timeout: 30000 }).trim();
    const expected = `X ${url} Y`;

    if (out === expected) {
      pass('a query-string URL survives the interpolation byte-for-byte');
    } else {
      fail(`URL corrupted by interpolation:\n  expected: ${expected}\n  got:      ${out}`);
    }

    // The specific corruption the missing escape caused: & replaced by the match.
    if (!out.includes('{{URL}}')) {
      pass('no {{URL}} token leaks back into the output via an unescaped &');
    } else {
      fail('an unescaped & spliced {{URL}} back into the output');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
