// tests/batch-tailor-flags.test.mjs — batch-tailor.mjs's CLI contract and the
// paths it hands to the worker.
//
// batch-tailor.mjs spawns one agent run per matching job, so a mis-parsed
// threshold is not a cosmetic problem: it decides how many paid runs happen and
// on which roles. It predates lib/cli-flags.mjs and hand-rolled its own
// parsing, which left three silent failures:
//
//   --min-score 4.5   (space form)  → ignored, ran at the 4.0 default
//   --min-score=abc   (bad value)   → NaN, matched nothing, exited 0
//   --min-scor=4.5    (typo)        → ignored, ran at the 4.0 default
//
// All three are the #2459 class that lib/cli-flags.mjs exists to end.
//
// The state-file path is env-overridable (CAREER_OPS_BATCH_STATE, the same
// override merge-tracker.mjs already honours) so these cases run against a
// sandbox instead of the developer's real batch run. Every case below picks a
// threshold that matches NO job, so the script always exits before spawning a
// worker.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbatch-tailor.mjs — flag parsing and worker paths');

const NODE = process.execPath;
const SCRIPT = join(ROOT, 'batch-tailor.mjs');

function makeStateFile() {
  const dir = mkdtempSync(join(tmpdir(), 'co-batch-tailor-'));
  const file = join(dir, 'batch-state.tsv');
  writeFileSync(file,
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' +
    '1\thttps://example.com/job\tcompleted\t-\t-\t001\t4.5\t-\t0\n');
  return { dir, file };
}

// Run batch-tailor and return { code, out }. cwd defaults to a directory that
// is NOT the project root, which is what exposes a cwd-relative path.
function runTailor(args, stateFile, cwd) {
  const env = { ...process.env, CAREER_OPS_BATCH_STATE: stateFile };
  try {
    const out = execFileSync(NODE, [SCRIPT, ...args], { cwd: cwd || tmpdir(), env, encoding: 'utf-8', timeout: 30000 });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const sandbox = makeStateFile();
try {
  // ── 1. The space-separated form must be honoured ──
  // The job scores 4.5, so a 9.9 threshold must match nothing. Reading the
  // default 4.0 instead would tailor it — a paid run the caller excluded.
  {
    const r = runTailor(['--min-score', '9.9'], sandbox.file);
    if (r.code === 0 && /No completed roles/.test(r.out)) {
      pass('--min-score 9.9 (space form) is honoured, not silently defaulted');
    } else {
      fail(`space form ignored: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // Guard: the equals form keeps working, and a threshold BELOW the job's score
  // still selects it — otherwise case 1 could pass by rejecting everything.
  {
    const r = runTailor(['--min-score=9.9'], sandbox.file);
    if (r.code === 0 && /No completed roles/.test(r.out)) {
      pass('--min-score=9.9 (equals form) still filters everything out');
    } else {
      fail(`equals form: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // ── 2. A non-numeric threshold is a usage error, not a silent no-op ──
  // Before: parseFloat('abc') → NaN, every comparison false, "No completed
  // roles found with score >= NaN", exit 0. The caller cannot tell that from a
  // genuinely empty batch.
  {
    const r = runTailor(['--min-score=abc'], sandbox.file);
    if (r.code !== 0 && !/NaN/.test(r.out)) {
      pass('a non-numeric --min-score is rejected instead of matching nothing');
    } else {
      fail(`bad value not rejected: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // ── 3. An unrecognized flag is refused ──
  // A typo used to fall through to the 4.0 default and spawn worker runs the
  // caller never asked for.
  {
    const r = runTailor(['--min-scor=9.9'], sandbox.file);
    if (r.code !== 0) {
      pass('an unrecognized flag is refused instead of running at the default');
    } else {
      fail(`typo accepted: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // ── 3b. A numeric prefix with trailing garbage is not a number ──
  // parseFloat stops at the first invalid character, so "4.5abc" was read as
  // 4.5 and the run proceeded on a value the caller never wrote (CodeRabbit).
  // Number() rejects it — but only paired with the empty-string guard below,
  // because Number('') is 0, which is finite and would tailor everything.
  {
    const r = runTailor(['--min-score=4.5abc'], sandbox.file);
    if (r.code !== 0 && !/NaN/.test(r.out)) {
      pass('--min-score=4.5abc is rejected, not silently truncated to 4.5');
    } else {
      fail(`trailing garbage accepted: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // Guard: an empty or whitespace value must stay an error, not become 0.
  {
    const empty = runTailor(['--min-score='], sandbox.file);
    const blank = runTailor(['--min-score= '], sandbox.file);
    if (empty.code !== 0 && blank.code !== 0) {
      pass('an empty or blank --min-score is an error, never a 0 threshold');
    } else {
      fail(`empty/blank accepted: empty=${empty.code} blank=${blank.code} ${empty.out}${blank.out}`.slice(0, 200));
    }
  }

  // ── 3c. An unreadable state-file path is a usage error, not a stack trace ──
  // existsSync() is true for a DIRECTORY, so readFileSync threw an uncaught
  // EISDIR. The message must name the resolved path so an operator can see
  // which value CAREER_OPS_BATCH_STATE actually resolved to.
  {
    const r = runTailor([], tmpdir());
    if (r.code === 1 && !/at Object\.|node:fs/.test(r.out) && r.out.includes(tmpdir())) {
      pass('an unreadable state-file path fails cleanly and names the path');
    } else {
      fail(`state-file failure not handled: code=${r.code} out=${r.out.trim().slice(0, 200)}`);
    }
  }

  // ── 4. --help still works ──
  {
    const r = runTailor(['--help'], sandbox.file);
    if (r.code === 0 && /min-score/.test(r.out)) {
      pass('--help prints the usage block and exits 0');
    } else {
      fail(`--help: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // ── 4b. --min-score with no operand must not be swallowed by --help ──
  // flagValue() does not consume `--help` as a value, and validateFlags handled
  // --help before any value check — so this printed usage, exited 0, and the
  // malformed flag was never reported (CodeRabbit on #2961). The shared helper's
  // opt-in `requireOperand` closes it.
  {
    const r = runTailor(['--min-score', '--help'], sandbox.file);
    if (r.code === 1 && /--min-score requires a value/.test(r.out)) {
      pass('--min-score --help reports the missing operand instead of showing help');
    } else {
      fail(`min-score-then-help: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
    }
  }

  // ── 5. The worker's mode file must not be a cwd-relative path ──
  // The state file resolved through __dirname while `modes/pdf.md` was passed
  // bare, so running the script from anywhere else handed the worker a path
  // that does not exist — and modes/pdf.md is where the CV fact gate
  // (verify-cv-facts.mjs, step 19) is instructed. Asserted at source level, the
  // same shape as test-all's provider-pacing guard, because observing the
  // spawn argument would mean actually launching a worker.
  {
    const src = readFileSync(SCRIPT, 'utf-8');
    const bareRelative = /(['"`])modes\/pdf\.md\1/.test(src);
    if (!bareRelative) {
      pass('the pdf mode file is not passed as a bare cwd-relative path');
    } else {
      fail('batch-tailor.mjs still passes a bare "modes/pdf.md" — breaks from any other cwd');
    }
  }
} finally {
  rmSync(sandbox.dir, { recursive: true, force: true });
}
