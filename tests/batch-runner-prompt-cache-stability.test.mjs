// tests/batch-runner-prompt-cache-stability.test.mjs: the resolved system
// prompt batch-runner.sh writes for --append-system-prompt-file must be
// byte-identical across offers, so a prompt-caching-aware CLI can reuse the
// entire cached prefix instead of only the few KB before the first
// placeholder.
//
// THE BUG THIS PINS
//
// process_offer() used to sed-substitute each offer's own URL, JD file,
// report number, date, and batch ID into batch-prompt.md. The first
// placeholder sits early in the file, so from that byte on the resolved
// system prompt differed for every single offer, defeating prompt caching for
// the rest of a ~41 KB prompt. The fix resolves every placeholder to a fixed,
// stable label instead (e.g. `<URL from the job message>`): the concrete
// values travel separately, in the per-job user prompt appended after the
// system prompt, so the resolved system prompt is now the same file for
// every offer in a batch.
//
// This test runs the REAL batch-runner.sh against two offers with different
// URLs, report numbers, dates and batch IDs, captures the exact file each
// invocation passed via --append-system-prompt-file (before the runner
// deletes it), and asserts the two captures are byte-for-byte identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';

const SRC = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('two offers with different URLs/report numbers/dates/IDs resolve to a byte-identical system prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-cache-stability-'));
  try {
    const batchDir = join(dir, 'batch');
    const binDir = join(dir, 'bin');
    const captureDir = join(dir, 'captures');
    mkdirSync(batchDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(captureDir, { recursive: true });
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });

    writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
    chmodSync(join(batchDir, 'batch-runner.sh'), 0o755);

    // A fixture prompt exercising every placeholder, with real body text
    // before and after each one (mirroring the real batch-prompt.md's shape,
    // placeholders scattered through a much longer template) closely enough
    // that this test would catch a partial fix (e.g. only the first
    // occurrence of a placeholder resolved to a stable label).
    writeFileSync(join(batchDir, 'batch-prompt.md'), [
      '# Fixture batch worker prompt',
      '',
      'Some fixed preamble text that should be identical for every offer,',
      'the same way the real batch-prompt.md opens with shared instructions.',
      '',
      '## Orchestrator Placeholders',
      '',
      'URL: {{URL}}',
      'JD file: {{JD_FILE}}',
      'Report number: {{REPORT_NUM}}',
      'Date: {{DATE}}',
      'Batch ID: {{ID}}',
      '',
      '## Later section reusing the same placeholders',
      '',
      'Archive the JD from {{JD_FILE}} for {{URL}}, report {{REPORT_NUM}},',
      'dated {{DATE}}, batch {{ID}}.',
      '',
    ].join('\n'));

    // Two offers, deliberately different in every value that used to be
    // sed-substituted, plus one URL carrying sed/regex metacharacters that
    // used to require esc_url escaping.
    writeFileSync(join(batchDir, 'batch-input.tsv'), [
      'id\turl\tsource\tnotes',
      '1\thttps://example.com/one?utm_source=a&utm_medium=b\tfixture\t-',
      '2\thttps://example.com/two\tfixture\t-',
    ].join('\n') + '\n');

    // Report numbers must differ between the two offers too, so the test
    // cannot pass by accident on a fixture that happens to reuse "001".
    writeFileSync(join(dir, 'reserve-report-num.mjs'), [
      "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
      "if (!process.argv.includes('--release')) {",
      "  const f = 'counter.txt';",
      "  const n = (existsSync(f) ? parseInt(readFileSync(f, 'utf8'), 10) : 0) + 1;",
      "  writeFileSync(f, String(n));",
      "  console.log(String(n).padStart(3, '0'));",
      "}",
    ].join('\n') + '\n');

    for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
      writeFileSync(join(dir, `${script}.mjs`), '// No external integrations in this fixture.\n');
    }

    // curl fails immediately so JD prefetch short-circuits without a network
    // call; the worker's JD content plays no role in this test.
    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');

    // The claude stub captures the exact file passed via
    // --append-system-prompt-file, keyed by the offer's Batch ID (read out of
    // the per-job prompt, its last argument), before batch-runner.sh deletes
    // it. It then exits non-zero: this test only cares about the resolved
    // system prompt, not a fabricated successful evaluation.
    writeFileSync(join(binDir, 'claude'), [
      '#!/usr/bin/env bash',
      'promptfile=""',
      'prev=""',
      'last=""',
      'for arg in "$@"; do',
      '  if [[ "$prev" == "--append-system-prompt-file" ]]; then',
      '    promptfile="$arg"',
      '  fi',
      '  prev="$arg"',
      '  last="$arg"',
      'done',
      'id=$(printf \'%s\' "$last" | grep -oE \'Batch ID: [0-9]+\' | grep -oE \'[0-9]+\')',
      'if [[ -n "$promptfile" && -n "$id" ]]; then',
      '  cp "$promptfile" "$CAPTURE_DIR/prompt-${id}.md"',
      'fi',
      'exit 1',
    ].join('\n') + '\n');
    chmodSync(join(binDir, 'claude'), 0o755);
    chmodSync(join(binDir, 'curl'), 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH}`,
      CAPTURE_DIR: captureDir,
    };

    execFileSync(getBash(), [join(batchDir, 'batch-runner.sh'), '--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });

    const capture1 = join(captureDir, 'prompt-1.md');
    const capture2 = join(captureDir, 'prompt-2.md');
    assert.ok(existsSync(capture1), 'offer 1 did not capture a resolved system prompt');
    assert.ok(existsSync(capture2), 'offer 2 did not capture a resolved system prompt');

    const prompt1 = readFileSync(capture1, 'utf8');
    const prompt2 = readFileSync(capture2, 'utf8');

    // Sanity: the two offers really were assigned different report numbers,
    // so an identical-prompts result cannot be an artifact of a fixture that
    // handed them the same value.
    const reportNums = [...new Set([prompt1, prompt2].flatMap((p) => [...p.matchAll(/Report number: (<[^\n]+>)/g)].map((m) => m[1])))];
    assert.equal(reportNums.length, 1, `expected both prompts to carry the same stable report-number label, got: ${JSON.stringify(reportNums)}`);
    assert.equal(reportNums[0], '<report number from the job message>',
      'the resolved prompt should carry the stable label "<report number from the job message>", not a concrete report number');

    assert.equal(prompt1, prompt2, 'resolved system prompt differs between two offers with different URL/report number/date/ID: prompt caching cannot reuse the prefix');

    // None of the offer-specific concrete values may appear anywhere in the
    // resolved system prompt: they belong exclusively to the per-job prompt.
    for (const leaked of ['example.com/one', 'example.com/two', 'utm_source=a']) {
      assert.ok(!prompt1.includes(leaked), `resolved system prompt leaked a concrete offer value: ${leaked}`);
    }

    // The stable labels must be present in their place.
    for (const label of [
      '<URL from the job message>',
      '<JD file from the job message>',
      '<report number from the job message>',
      '<date from the job message>',
      '<batch ID from the job message>',
    ]) {
      assert.ok(prompt1.includes(label), `resolved system prompt is missing the stable label: ${label}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
