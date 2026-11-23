// tests/check-jd-archive-piped-output.test.mjs — a large result reaches a pipe
// whole, with its exit code.
//
// check-jd-archive.mjs printed its findings and then called process.exit(). A
// write to a pipe can still be queued at that point (it is on macOS), and
// process.exit() drops it, so a result past the 64 KiB pipe buffer arrived cut
// off: the default JSON did not parse. Each finding is about 300 bytes, and
// reports written before JD archiving was required (#2789) all have one, so a
// few hundred old reports are enough. verify-pipeline.mjs sends the user here
// "for details", and an agent reads the output through a pipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = 400;

function runCheck(t, extraArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'jd-archive-pipe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reports = join(dir, 'reports');
  const jds = join(dir, 'jds');
  mkdirSync(reports);
  mkdirSync(jds);
  for (let i = 1; i <= REPORTS; i++) {
    const num = String(i).padStart(3, '0');
    writeFileSync(join(reports, `${num}-company-${i}-2026-01-15.md`),
      `# Evaluation: Company ${i} — Platform Engineer\n\n**Score:** 3.9/5\n**URL:** https://jobs.example.com/${i}\n`);
  }
  // spawnSync reads the child's stdout through a pipe, as an agent's shell does.
  return spawnSync(process.execPath, [
    join(ROOT, 'check-jd-archive.mjs'), '--reports-dir', reports, '--jds-dir', jds, '--no-tracker', ...extraArgs,
  ], { cwd: dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
}

test('the default JSON result over 64 KiB reaches a pipe whole and keeps exit 1', (t) => {
  const r = runCheck(t, []);
  let result;
  assert.doesNotThrow(() => { result = JSON.parse(r.stdout); }, `the JSON arrived cut off at ${Buffer.byteLength(r.stdout)} bytes`);
  assert.equal(result.reportsScanned, REPORTS);
  assert.equal(result.findings.length, REPORTS);
  assert.ok(result.findings.every((f) => f.type === 'missing-jd-archive'));
  assert.equal(r.status, 1, 'a missing archive still fails the run');
  assert.ok(Buffer.byteLength(r.stdout) > 65536, `the fixture must fill more than the pipe buffer (${Buffer.byteLength(r.stdout)} bytes)`);
});
