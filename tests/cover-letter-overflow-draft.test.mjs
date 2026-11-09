// generate-cover-letter.mjs prints the output path as the cover letter's PDF
// after rendering. A render over a warn-only page budget returns the sibling
// .overflow.pdf draft it wrote and leaves the output path as it was (#6377),
// so that line would hand over a file that was never written (#6493).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COVER_PDF_REGISTER = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-register.mjs')).href;

function runCover(env) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-overflow-'));
  mkdirSync(join(dir, 'output'));
  writeFileSync(join(dir, 'cv.md'), 'Avery Quinn builds ledger services.\n');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify({
    candidate: { name: 'Avery Quinn', email: 'avery.quinn@example.com' },
    letter: { role_title: 'Engineer', opening: 'I build ledger services.', profile_intro: 'I build ledger services.' },
    output_path: 'output/letter.pdf',
  }));
  const result = spawnSync(process.execPath, [
    '--import', COVER_PDF_REGISTER,
    join(ROOT, 'generate-cover-letter.mjs'),
    '--payload', payloadPath,
  ], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60_000,
    // An inherited CAREER_OPS_PROFILE would point the script at a real profile
    // and its template choice; the test must see the temporary root only.
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '', ...env },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test('a cover letter over its page budget is reported as not written, naming the draft', () => {
  const result = runCover({ CAREER_OPS_TEST_COVER_OVERFLOW: '1' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Cover letter over its page budget: nothing was written to .*[\\/]output[\\/]letter\.pdf; the draft is .*[\\/]output[\\/]letter\.overflow\.pdf\. Trim and rerun\./);
  assert.doesNotMatch(result.stdout, /Cover letter PDF:/);
});

test('a cover letter inside its page budget still reports its PDF', () => {
  const result = runCover({ CAREER_OPS_TEST_COVER_OVERFLOW: '' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Cover letter PDF: .*[\\/]output[\\/]letter\.pdf/);
  assert.doesNotMatch(result.stdout, /over its page budget/);
});
