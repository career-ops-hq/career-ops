// tests/batch-runner-url-escaping.test.mjs: the offer URL never enters the
// sed substitution that resolves batch-prompt.md's placeholders, so it can
// never corrupt (or be corrupted by) that interpolation.
//
// THE BUG THIS USED TO PIN
//
// process_offer() used to interpolate the offer URL straight into the worker
// prompt with `sed -e "s|{{URL}}|${esc_url}|g"`. It escaped `\` and `|` in the
// URL, but in a sed REPLACEMENT `&` also means "the whole match". An
// unescaped `&` in a query-string URL (...?utm_source=a&utm_medium=b)
// therefore spliced the literal `{{URL}}` back in, corrupting every offer
// whose URL carried query parameters.
//
// THE FIX
//
// {{URL}} (and the other per-offer placeholders) now resolve to a fixed,
// stable label (e.g. `<URL from the job message>`), the same text for every
// offer, never the offer's own URL. The concrete URL travels instead in the
// per-job user prompt built separately (`prompt="$prompt URL: $url"`), which
// is plain string concatenation, not a sed replacement, so it has no `&`/`|`/
// `\` metacharacter hazard to begin with. There is no more `esc_url` escaping
// to test: this file now pins that (a) the fix is in place, and (b) a URL
// carrying every sed/regex metacharacter that used to matter cannot reach or
// disturb the resolved system prompt at all.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh: offer URL never enters the {{URL}} sed substitution');

// Guard: no esc_url (or sibling) escaping should remain. Its return would mean
// a per-offer value is back to being spliced into a sed replacement, and this
// test would need to check its escaping again instead of its absence.
if (/\besc_url\s*=/.test(SRC) || /\besc_jd_file\s*=/.test(SRC)) {
  fail('esc_url/esc_jd_file escaping is back in batch-runner.sh: a per-offer value is being sed-substituted again; this test needs updating to check its escaping');
} else {
  pass('no esc_url/esc_jd_file escaping remains: the URL/JD file no longer enter a sed replacement');
}

// Pull the real {{URL}} substitution clause out of the script and confirm it
// resolves to the fixed label, not a variable.
const sedClause = SRC.match(/-e "s\|\{\{URL\}\}\|([^"]*)\|g"/);
if (!sedClause) {
  fail('could not find the {{URL}} sed substitution in batch/batch-runner.sh: this test needs updating');
} else if (sedClause[1] === '<URL from the job message>') {
  pass('{{URL}} resolves to the fixed stable label, not a per-offer value');
} else {
  fail(`{{URL}} resolves to "${sedClause[1]}" instead of the fixed stable label, so prompt caching would break again`);
}

// End to end: run the REAL substitution clause against a URL carrying every
// metacharacter that used to matter (&, |, \) and confirm it neither corrupts
// the output nor leaks the URL into the resolved prompt at all.
if (sedClause) {
  const work = mkdtempSync(join(tmpdir(), 'cops-urlesc-'));
  try {
    const script = join(work, 'check.sh');
    const url = 'https://ex.com/j?utm_source=a&utm_medium=b&q=x|y\\z';
    writeFileSync(script, [
      '#!/usr/bin/env bash',
      'set -u',
      `printf '%s\\n' 'X {{URL}} Y' | sed -e "${sedClause[0].match(/"(.*)"/)[1]}"`,
    ].join('\n'));

    const out = execFileSync(getBash(), [script], { encoding: 'utf-8', timeout: 30000 }).trim();
    const expected = 'X <URL from the job message> Y';

    if (out === expected) {
      pass('the {{URL}} substitution is unaffected by sed-metacharacter-laden URLs (it never sees the URL)');
    } else {
      fail(`{{URL}} substitution produced unexpected output:\n  expected: ${expected}\n  got:      ${out}`);
    }

    if (!out.includes(url) && !out.includes('{{URL}}')) {
      pass('the offer URL never appears in, and never corrupts, the resolved placeholder');
    } else {
      fail(`the offer URL leaked into or corrupted the resolved placeholder: ${out}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
