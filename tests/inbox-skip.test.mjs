// tests/inbox-skip.test.mjs — skip and undo one Inbox row in pipeline.md (#5269).
//
// The Inbox Skip has one writer, lib/inbox-skip.mjs: the dashboard's `x` and
// `u` keys run it through inbox-skip.mjs, and the web route runs a byte copy
// of it (checked in web/tests/lib/inbox-skip-core.test.mjs), both under the
// pipeline lock. These cases pin the rule, the locked read-modify-write, and
// the CLI's exit statuses the dashboard reads:
// 0 changed, 3 nothing to change, 4 no Pending row with that URL first, 1 other.
import { pass, fail, ROOT, SANDBOX_DATA_ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';

console.log('\ninbox-skip — skip and undo one Inbox row in pipeline.md (#5269)');

const check = (label, cond) => (cond ? pass(label) : fail(label));

const ACME = 'https://boards.greenhouse.io/acme/jobs/1';
const BETA = 'https://jobs.lever.co/beta/2';
const DONE = 'https://done.example.com/x';

const ACME_PENDING = `- [ ] ${ACME} | Acme | Staff Engineer | Remote | posted: 2026-08-01`;
const BETA_PENDING = `- [ ] ${BETA} | Beta | Platform Engineer | NYC`;
const BETA_SKIPPED = `- [x] ${BETA} | Beta | Platform Engineer | NYC`;
const BETA_PROCESSED = `- [ ] ${BETA} | Beta | processed duplicate`;

const FIXTURE = [
  '# Pipeline',
  '',
  '## Pending',
  '',
  ACME_PENDING,
  BETA_PENDING,
  '- [x] https://ats.example.com/old | OldCo | Already done',
  '',
  '## Processed',
  '',
  `- [x] ${DONE} | DoneCo | PM`,
  BETA_PROCESSED,
  '',
].join('\n');
const SKIPPED = FIXTURE.replace(BETA_PENDING, BETA_SKIPPED);

try {
  const mod = await import(pathToFileURL(join(ROOT, 'inbox-skip.mjs')).href);
  const { applyInboxSkip, postingUrl, setInboxSkip, SKIP_EXIT } = mod;
  const lockMod = await import(pathToFileURL(join(ROOT, 'pipeline-lock.mjs')).href);

  // ── the rule (lib/inbox-skip.mjs) ──
  const skipped = applyInboxSkip(FIXTURE, BETA, true);
  check('skip flips only that row, and every other line stays byte-identical',
    skipped.ok && skipped.matched === 1 && skipped.changed === 1 && skipped.text === SKIPPED);
  const undone = applyInboxSkip(SKIPPED, BETA, false);
  check('undo restores the file exactly', undone.ok && undone.changed === 1 && undone.text === FIXTURE);
  const again = applyInboxSkip(SKIPPED, BETA, true);
  check('skipping a skipped row matches it and changes nothing', again.ok && again.matched === 1 && again.changed === 0 && again.text === SKIPPED);
  check('a row under Processed is never flipped', skipped.text.split('\n').includes(BETA_PROCESSED));
  check('a URL only under Processed is unmatched', applyInboxSkip(FIXTURE, DONE, true).error === 'unmatched');
  check('an unknown URL is unmatched', applyInboxSkip(FIXTURE, 'https://nobody.example/jobs/9', true).error === 'unmatched');

  // The dashboard's Inbox lists a row whose URL is a later cell; this rule does not.
  const laterCell = ['## Pending', `- [ ] Acme | ${ACME} | Role`, ''].join('\n');
  check('a row whose URL is not the first cell is unmatched', applyInboxSkip(laterCell, ACME, true).error === 'unmatched');

  // Every row the dashboard's Inbox lists from the shared fixture (the Go
  // reader's expected output) is skippable with the URL the Inbox sends,
  // except the one whose URL is not the first cell: the script exits 4 there.
  const parityDir = join(ROOT, 'dashboard', 'internal', 'data', 'testdata');
  if (existsSync(join(parityDir, 'pending-parity.json'))) {
    const md = readFileSync(join(parityDir, 'pending-parity.md'), 'utf8');
    const listed = JSON.parse(readFileSync(join(parityDir, 'pending-parity.json'), 'utf8'))
      .map((row) => row.url)
      .filter((url) => /^https?:\/\//i.test(url));
    const unmatched = listed.filter((url) => {
      const r = applyInboxSkip(md, url, true);
      return !(r.ok && r.matched === 1 && r.changed === 1);
    });
    check('every http(s) row the dashboard Inbox lists is skippable, except a URL that is not the first cell',
      listed.length > 10 && unmatched.length === 1 && unmatched[0] === 'https://jobs.example.com/acme/103');
  } else {
    pass('dashboard/ not present; the Inbox row-shape check is skipped');
  }

  const trap = `- [ ] ${new URL(`https://evil.example/${BETA}`).href} | Evil | Trap`;
  const trapText = ['## Pending', trap, BETA_PENDING, ''].join('\n');
  const trapResult = applyInboxSkip(trapText, BETA, true);
  check('a URL that is only part of another row\'s URL cell does not match',
    trapResult.ok && trapResult.matched === 1 && trapResult.text === ['## Pending', trap, BETA_SKIPPED, ''].join('\n'));

  const german = ['## Offen', BETA_PENDING, '', '## Verarbeitet', BETA_PROCESSED, ''].join('\n');
  const germanResult = applyInboxSkip(german, BETA, true);
  check('the Pending heading is read in other languages (Offen / Verarbeitet)',
    germanResult.ok && germanResult.changed === 1 && germanResult.text.split('\n').includes(BETA_PROCESSED));

  const tabHeading = ['## Pending', BETA_PENDING, '##\tProcessed', BETA_PROCESSED, ''].join('\n');
  const tabResult = applyInboxSkip(tabHeading, BETA, true);
  check('a `##<tab>` heading ends the Pending section',
    tabResult.ok && tabResult.changed === 1 && tabResult.text.split('\n').includes(BETA_PROCESSED));

  const processedOnly = ['## Processed', BETA_PROCESSED, ''].join('\n');
  check('with no Pending heading, a row under Processed is still never matched',
    applyInboxSkip(processedOnly, BETA, true).error === 'unmatched'
      && applyInboxSkip(processedOnly.replace('- [ ]', '- [x]'), BETA, false).error === 'unmatched');

  const checklist = [BETA_PENDING, '', '## Processed', BETA_PROCESSED, ''].join('\n');
  const checklistResult = applyInboxSkip(checklist, BETA, true);
  check('a file with no Pending heading is a checklist: rows above Processed still match',
    checklistResult.ok && checklistResult.changed === 1
      && checklistResult.text === [BETA_SKIPPED, '', '## Processed', BETA_PROCESSED, ''].join('\n'));

  const crlf = FIXTURE.replace(/\n/g, '\r\n');
  check('CRLF line endings are kept', applyInboxSkip(crlf, BETA, true).text === SKIPPED.replace(/\n/g, '\r\n'));

  for (const [label, raw] of [
    ['a relative path', '../data/pipeline.md'],
    ['a file: URL', 'file:///etc/passwd'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['credentials', 'https://user:pass@example.com/job'],
    ['an embedded newline', `${ACME}\n- [x] https://evil.example`],
    ['an empty string', ''],
  ]) {
    check(`postingUrl refuses ${label}`, postingUrl(raw) === null && applyInboxSkip(FIXTURE, raw, true).error === 'invalid-url');
  }
  check('postingUrl trims and keeps the URL as written', postingUrl(`  ${ACME}  `) === ACME);

  // ── setInboxSkip: the locked read-modify-write ──
  const TMP = realpathSync(mkdtempSync(join(SANDBOX_DATA_ROOT, 'inbox-skip-')));
  try {
    const file = join(TMP, 'pipeline.md');
    writeFileSync(file, FIXTURE);
    const s1 = await setInboxSkip(file, BETA, true);
    check('setInboxSkip writes the skip', s1.ok && s1.changed === 1 && readFileSync(file, 'utf8') === SKIPPED);
    const s2 = await setInboxSkip(file, BETA, false);
    check('setInboxSkip writes the undo', s2.ok && s2.changed === 1 && readFileSync(file, 'utf8') === FIXTURE);
    check('setInboxSkip leaves no temp file or lock behind', readdirSync(TMP).join(',') === 'pipeline.md');
    check('setInboxSkip reports a missing file as not-found',
      (await setInboxSkip(join(TMP, 'absent.md'), BETA, true)).error === 'not-found');

    // A symlinked pipeline.md stays a link: the skip lands in its target,
    // with the target's mode, as scan.mjs atomicWriteFile writes it.
    const realDir = join(TMP, 'real');
    mkdirSync(realDir);
    const realFile = join(realDir, 'pipeline.md');
    writeFileSync(realFile, FIXTURE);
    chmodSync(realFile, 0o640);
    const link = join(TMP, 'linked.md');
    let linked = true;
    try { symlinkSync(realFile, link); } catch { linked = false; }
    if (linked) {
      const viaLink = await setInboxSkip(link, BETA, true);
      check('a symlinked pipeline.md stays a link, and the skip lands in its target with its mode',
        viaLink.ok && lstatSync(link).isSymbolicLink() && readFileSync(realFile, 'utf8') === SKIPPED
          && (process.platform === 'win32' || (statSync(realFile).mode & 0o777) === 0o640)
          && readdirSync(realDir).join(',') === 'pipeline.md');
      rmSync(link, { force: true });
    } else {
      pass('symlinks are not available here; the symlinked pipeline.md check is skipped');
    }

    const lock = await lockMod.acquirePipelineLock(file);
    try {
      const busy = await setInboxSkip(file, BETA, true, { timeoutMs: 150, retryMs: 20, maxWaitMs: 300 });
      check('a held pipeline lock is reported as busy, and the file is untouched',
        busy.ok === false && busy.error === 'busy' && readFileSync(file, 'utf8') === FIXTURE);
    } finally {
      lock.release();
    }

    // ── the CLI the dashboard runs ──
    const runCli = (args, env = {}) => {
      try {
        const stdout = execFileSync(process.execPath, [join(ROOT, 'inbox-skip.mjs'), ...args], {
          cwd: ROOT, encoding: 'utf-8', timeout: 15000, stdio: 'pipe', env: { ...process.env, ...env },
        });
        return { exitCode: 0, stdout, stderr: '' };
      } catch (e) {
        return { exitCode: e.status ?? 1, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
      }
    };
    const reset = () => writeFileSync(file, FIXTURE);
    const read = () => readFileSync(file, 'utf8');

    check('the exit statuses are 3 (nothing to change) and 4 (no such Pending row)',
      SKIP_EXIT.UNCHANGED === 3 && SKIP_EXIT.NOT_PENDING === 4);

    reset();
    const skip = runCli([`--url=${BETA}`, `--pipeline=${file}`]);
    check('the CLI skips the row and exits 0', skip.exitCode === 0 && read() === SKIPPED);
    const skipAgain = runCli([`--url=${BETA}`, `--pipeline=${file}`]);
    check('skipping again exits 3 and writes nothing', skipAgain.exitCode === 3 && read() === SKIPPED);
    const undo = runCli(['--url', BETA, '--undo', '--pipeline', file]);
    check('--undo restores the row and exits 0', undo.exitCode === 0 && read() === FIXTURE);
    const undoAgain = runCli(['--url', BETA, '--undo', '--pipeline', file]);
    check('undoing again exits 3 and writes nothing', undoAgain.exitCode === 3 && read() === FIXTURE);

    for (const [label, target] of [
      ['an unknown URL', 'https://nobody.example/jobs/9'],
      ['a URL only under Processed', DONE],
    ]) {
      reset();
      const r = runCli([`--url=${target}`, `--pipeline=${file}`]);
      check(`${label} exits 4 and writes nothing`, r.exitCode === 4 && /No Pending row/.test(r.stderr) && read() === FIXTURE);
    }
    const laterFile = join(TMP, 'later.md');
    writeFileSync(laterFile, laterCell);
    const later = runCli([`--url=${ACME}`, `--pipeline=${laterFile}`]);
    check('a row whose URL is not the first cell exits 4 and is untouched',
      later.exitCode === 4 && readFileSync(laterFile, 'utf8') === laterCell);

    const missing = runCli([`--url=${BETA}`, `--pipeline=${join(TMP, 'absent.md')}`]);
    check('no pipeline file exits 4 and creates none', missing.exitCode === 4 && !existsSync(join(TMP, 'absent.md')));

    reset();
    const invalid = runCli(['--url=javascript:alert(1)', `--pipeline=${file}`]);
    check('a URL that is not http(s) exits 1 and writes nothing',
      invalid.exitCode === 1 && /must be an http\(s\) posting URL/.test(invalid.stderr) && read() === FIXTURE);
    check('a missing --url exits 1', runCli([`--pipeline=${file}`]).exitCode === 1 && read() === FIXTURE);
    check('--url with no value exits non-zero', runCli(['--url', '--undo', `--pipeline=${file}`]).exitCode !== 0 && read() === FIXTURE);
    check('a mistyped --undo exits non-zero and does not skip',
      runCli([`--url=${BETA}`, '--undoo', `--pipeline=${file}`]).exitCode !== 0 && read() === FIXTURE);

    const held = await lockMod.acquirePipelineLock(file);
    try {
      const busy = runCli([`--url=${BETA}`, `--pipeline=${file}`], {
        CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '200',
        CAREER_OPS_PIPELINE_LOCK_RETRY_MS: '20',
        CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '400',
      });
      check('a held pipeline lock exits 1, says so, and writes nothing',
        busy.exitCode === 1 && /being written by another command/.test(busy.stderr) && read() === FIXTURE);
    } finally {
      held.release();
    }

    // Without --pipeline the file is data/pipeline.md under the data root.
    const dataRoot = join(TMP, 'root');
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'pipeline.md'), FIXTURE);
    const byRoot = runCli([`--url=${BETA}`], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    check('the default file is data/pipeline.md under CAREER_OPS_ROOT',
      byRoot.exitCode === 0 && readFileSync(join(dataRoot, 'data', 'pipeline.md'), 'utf8') === SKIPPED);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
} catch (err) {
  fail(`inbox-skip test suite threw: ${err?.message ?? err}`);
}
