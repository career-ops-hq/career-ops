// tests/upskill-targeted-input.test.mjs — regression coverage for the local-file
// branch of `upskill.mjs --url-text` (#2810 follow-up).
//
// `existsSync(p)` is TRUE for a directory, so the readFileSync that followed it
// threw EISDIR — from inside an async IIFE with no catch, which means the
// process died on an unhandled rejection and printed a raw Node stack trace
// instead of the branch's own `Fatal:` line. An unreadable file failed the same
// way, and an EMPTY file failed differently and worse: it produced a gap map
// computed from an empty JD and exited 0, which reads as "no gaps" rather than
// "no input". All four now share readOptionalText and one fatal message.
//
// This suite is separate from upskill-known-skills.test.mjs on purpose: that one
// is pure (string in, value out) and says so; this one has to spawn the CLI,
// because the behaviour under test lives inside the isMain guard and is
// therefore not importable by design.
//
// Auto-discovered by test-all.mjs (tests/**/*.test.mjs) and imported in-process
// alongside every other suite, so it must NEVER exit the process itself — only
// pass()/fail() from ./helpers.mjs.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nupskill.mjs --url-text: local-file input validation');

// Everything below is synthetic: a throwaway tmpdir, an invented JD naming
// skills nobody's profile claims. Nothing reads user data.
const sandbox = mkdtempSync(join(tmpdir(), 'co-upskill-input-'));

/** Run the targeted CLI against one path. @returns {{code:number, stdout:string, stderr:string}} */
function runTargeted(path) {
  const res = spawnSync(NODE, [join(ROOT, 'upskill.mjs'), '--url-text', path], {
    cwd: ROOT, encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/**
 * A rejected input must produce the branch's own diagnostic, not a crash:
 * one `Fatal:` line naming the path, exit 1, and no JSON on stdout.
 */
function expectFatal(label, path) {
  const { code, stdout, stderr } = runTargeted(path);
  const named = stderr.includes('Fatal:') && stderr.includes(path);
  // The tell for the old behaviour: Node's own uncaught-error report.
  const crashed = /EISDIR|EACCES|at readFileSync|node:fs:/.test(stderr);
  if (code === 1 && named && !crashed && stdout.trim() === '') {
    pass(`--url-text ${label}: one Fatal: line, exit 1, no JSON on stdout`);
  } else {
    fail(`--url-text ${label}: code=${code} named=${named} crashed=${crashed} stdout=${JSON.stringify(stdout.slice(0, 120))} stderr=${JSON.stringify(stderr.slice(0, 240))}`);
  }
}

try {
  // 1. A DIRECTORY. The whole point of the finding: existsSync said yes.
  const dirPath = join(sandbox, 'jd-directory');
  mkdirSync(dirPath);
  expectFatal('a directory', dirPath);

  // 2. A missing path — the case the original branch DID handle. Kept so the
  //    fix cannot regress it while fixing its neighbours.
  expectFatal('a missing path', join(sandbox, 'no-such-jd-4b1c7e.txt'));

  // 3. An empty file. Previously exit 0 with an empty gap map: a silent wrong
  //    answer rather than a loud one.
  const emptyPath = join(sandbox, 'empty-jd.txt');
  writeFileSync(emptyPath, '');
  expectFatal('an empty file', emptyPath);

  // 4. Whitespace-only, which is empty as far as a JD is concerned.
  const blankPath = join(sandbox, 'blank-jd.txt');
  writeFileSync(blankPath, '\n\n   \t\n');
  expectFatal('a whitespace-only file', blankPath);

  // 5. Negative control: a REAL JD must still analyse cleanly. Without this the
  //    four assertions above would pass just as well against a branch that
  //    rejected every path.
  const realPath = join(sandbox, 'real-jd.txt');
  writeFileSync(realPath, 'Acme Corp is hiring. Requirements: Kubernetes, Terraform and Go.\n');
  const { code, stdout, stderr } = runTargeted(realPath);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* reported below */ }
  if (code === 0 && parsed && parsed.mode === 'targeted' && Array.isArray(parsed.gaps)) {
    pass('--url-text a readable JD: exit 0 and valid targeted JSON on stdout');
  } else {
    fail(`--url-text a readable JD: code=${code} parsed=${Boolean(parsed)} stderr=${JSON.stringify(stderr.slice(0, 240))}`);
  }
} catch (e) {
  fail(`upskill targeted-input tests crashed: ${e.stack || e.message}`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
