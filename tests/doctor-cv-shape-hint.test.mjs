import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function cvWarning(t, cv) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-cv-hint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'cv.md'), cv);
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', dir], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000, env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.status, 0, describeSpawn(r));
  return JSON.parse(r.stdout).warnings.find((w) => w.startsWith('cv.md:'));
}

test('a recognized Experience heading with unshaped jobs gets the job-heading hint only', (t) => {
  const warning = cvWarning(t, '# Casey Doe\n\n## Experience\n\n### Data Analyst, Globex (2021 to present)\n- Built dashboards.\n');
  assert.match(warning, /Experience section has no "### Company — Location" entries/);
  assert.match(warning, /Start each job with "### Company — Location"/);
  assert.doesNotMatch(warning, /Name the section/);
});

test('a CV with no recognized Experience heading still gets the heading hint', (t) => {
  const warning = cvWarning(t, '# Casey Doe\n\n## Career\n\n### Globex — Remote\n**Data Analyst**\n2021 to present\n');
  assert.match(warning, /no Experience section the CV checks recognize/);
  assert.match(warning, /Name the section "## Experience"/);
});
