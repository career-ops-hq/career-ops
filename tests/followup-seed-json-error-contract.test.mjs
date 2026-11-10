// #5198: followup-seed.mjs had two failWith call sites, and only the post-parse
// one read the parsed `opts.json`; the parse-failure site already read the raw
// argv. The two disagree whenever `--json` is consumed as another flag's value:
// `--date --json` leaves opts.json false even though the caller plainly asked
// for JSON, so the error arrived on stderr with an empty stdout. The file now
// binds one makeCliFailWith, from the raw argv, as the issue prescribes. These
// tests pin the shared error contract, and the last block is the control that
// keeps them about the flag rather than about errors.
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

const NODE = process.execPath;
const SCRIPT = join(ROOT, 'followup-seed.mjs');

// A throwaway sandbox: the invalid-date error is raised before any tracker is
// opened, and pointing every path at a temp dir keeps the real workspace out of
// the way. CAREER_OPS_ROOT and CAREER_OPS_PROFILE are pinned for the same
// reason tests/helpers.mjs blanks CAREER_OPS_TRACKER: followup-seed.mjs resolves
// the data root at module load (getCareerOpsRoot, line 88), so a developer whose
// shell already exports one would have this child read their real data root and
// profile. Pinning ROOT also outranks CAREER_OPS_DATA_DIR, the other alias that
// resolver honours. Returns { code, stdout, stderr }, like the other CLI suites.
function run(args) {
  const dir = mkdtempSync(join(tmpdir(), 'co-seed-json-'));
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_PROFILE: join(dir, 'profile.yml'),
    CAREER_OPS_TRACKER: join(dir, 'applications.md'),
    CAREER_OPS_FOLLOWUPS: join(dir, 'follow-ups.md'),
    CAREER_OPS_FOLLOWUPS_LOCK: join(dir, `career-ops-followups-json-${Math.random().toString(36).slice(2)}.lock`),
  };
  try {
    const stdout = execFileSync(NODE, [SCRIPT, ...args], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30_000 });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Test 1: --json is honoured even when --date swallows it as a value ──
{
  const res = run(['1', '--date', '--json']);
  if (res.code === 1) pass('1. --date --json exits 1 on the invalid date');
  else fail(`1. --date --json exits 1 (got ${res.code})\n${res.stdout}${res.stderr}`);

  let payload = null;
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    payload = null;
  }
  if (
    payload !== null && typeof payload === 'object' &&
    payload.code === 'INVALID_DATE' &&
    typeof payload.error === 'string' && payload.error.length > 0
  ) {
    pass('2. the JSON error payload still reaches stdout when --json is a flag value');
  } else {
    fail(`2. expected { code: "INVALID_DATE", error } on stdout, got ${JSON.stringify(res.stdout)}`);
  }

  if (res.stderr.includes('--date must be a real calendar date')) {
    pass('3. the human-readable message still goes to stderr');
  } else {
    fail(`3. expected the message on stderr, got ${JSON.stringify(res.stderr)}`);
  }
}

// ── Test 2 (control): with no --json anywhere, the error stays human-only ──
{
  const res = run(['1', '--date', 'nonsense']);
  let payload = null;
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    payload = null;
  }
  if (res.code === 1 && payload === null && res.stderr.includes('--date must be a real calendar date')) {
    pass('4. without --json in argv the error is stderr-only, so test 2 is about the flag');
  } else {
    fail(`4. without --json: expected code 1 and no stdout payload, got code ${res.code} stdout ${JSON.stringify(res.stdout)}`);
  }
}
