// A scheduled full sweep can run past its time limit. The scanner's --json
// SIGTERM handler used to print a partial result and exit 0 without appending
// the roles it already kept, and without a checkpoint the next run could
// continue. This drives that stop with a stubbed board list and no network.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';

// child.kill('SIGTERM') is TerminateProcess on Windows, so the handler never
// runs there. The save is proved where the signal is delivered.
const signalReachesHandler = platform() !== 'win32';

const FIRST = 'https://jobs.example/sandbox-co-0/jobs/1';
const SECOND = 'https://jobs.example/sandbox-co-1/jobs/2';
const COMPANIES = 8;

function urlCount(text, raw) {
  let want;
  try { want = new URL(raw); } catch { return 0; }
  let count = 0;
  for (const match of String(text).matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    try {
      if (new URL(match[0]).href === want.href) count += 1;
    } catch {
      // The match is not a URL.
    }
  }
  return count;
}

function textHasUrl(text, raw) {
  return urlCount(text, raw) > 0;
}

function childEnv(dir, mode) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_PROFILE: '',
    CAREER_OPS_PORTALS: '',
    CAREER_OPS_PIPELINE: '',
    CAREER_OPS_SCAN_HISTORY: '',
    CAREER_OPS_TRACKER: '',
    STUB_MODE: mode,
    CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0',
  };
}

function prepare(dir) {
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  writeFileSync(
    join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'),
    JSON.stringify(Array.from({ length: COMPANIES }, (_, i) => `sandbox-co-${i}`)),
    'utf-8',
  );
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n', 'utf-8');
  const fetched = join(dir, 'fetched.txt');
  writeFileSync(fetched, '', 'utf-8');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'greenhouse.mjs')).href)};
provider.fetchListing = undefined;
provider.fetch = async (entry) => {
  appendFileSync(${JSON.stringify(fetched)}, entry.name + '\\n');
  const n = Number(String(entry.name).replace('sandbox-co-', ''));
  if (process.env.STUB_MODE === 'stop') {
    if (n === 0) {
      return [{ title: 'Director of Engineering', url: ${JSON.stringify(FIRST)}, company: 'Sandbox Co', location: 'Remote', postedAt: Date.now(), description: '' }];
    }
    await new Promise(() => {});
  }
  if (process.env.STUB_MODE === 'continue' && n === 1) {
    return [{ title: 'Director of Support', url: ${JSON.stringify(SECOND)}, company: 'Sandbox Co', location: 'Remote', postedAt: Date.now(), description: '' }];
  }
  return [];
};
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`, 'utf-8');
  return { preload, fetched };
}

function pipeline(dir) {
  return readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8');
}

function checkpointPath(dir) {
  return join(dir, 'data', 'cache', 'ats-full-checkpoint.json');
}

function readCheckpoint(dir) {
  return JSON.parse(readFileSync(checkpointPath(dir), 'utf-8'));
}

const SCAN_RUN_ID = '1700000000000-1-00000000-0000-4000-8000-000000000001';

function stopSweep(dir, preload, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [
      '--import', pathToFileURL(preload).href,
      join(ROOT, 'scan-ats-full.mjs'),
      '--ats', 'greenhouse', '--limit', String(COMPANIES), '--since', '7', '--json',
      ...extraArgs,
    ], { cwd: dir, env: { ...childEnv(dir, 'stop'), CAREER_OPS_SCAN_RUN: SCAN_RUN_ID } });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const hard = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const stop = () => {
      if (killed) return;
      killed = true;
      // The offer line is printed before the sweep records its resume offset.
      // Give that turn time to finish, then stop the process.
      setTimeout(() => child.kill('SIGTERM'), 100);
    };
    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
      if (textHasUrl(stderr, FIRST)) stop();
    });
    child.stdout.on('data', (buf) => { stdout += buf.toString(); });
    child.on('close', (status, signal) => {
      clearTimeout(hard);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), 'ats-full-timeout-save-'));
try {
  const { preload, fetched } = prepare(dir);
  const stopped = await stopSweep(dir, preload, []);
  const saved = textHasUrl(pipeline(dir), FIRST);
  const cpExists = existsSync(checkpointPath(dir));
  let resumeAt = null;
  let partialSaved = null;
  let partialRunId = null;
  if (cpExists) {
    const cp = readCheckpoint(dir);
    resumeAt = cp.current?.resumeAt ?? null;
    partialSaved = cp.partialSave?.saved === true ? cp.partialSave.postingsKept : null;
    partialRunId = cp.partialSave?.runId ?? null;
  }
  const sawFirstRole = textHasUrl(stopped.stderr, FIRST);
  const sigtermSent = stopped.signal === 'SIGTERM';
  if (!signalReachesHandler && sawFirstRole && sigtermSent && !saved && !cpExists && !stopped.stdout.includes('"stoppedEarly"')) {
    pass('windows ends the sweep before the save handler can run');
  } else if (signalReachesHandler && saved && cpExists && resumeAt >= 1 && partialSaved >= 1 && partialRunId === SCAN_RUN_ID && stopped.status === 0 && stopped.stdout.includes('"checkpointAvailable":true')) {
    pass('a timed-out full sweep keeps the role it already found and a resume point');
  } else {
    fail(`timed-out sweep dropped its role: pipeline=${saved} checkpoint=${cpExists} resumeAt=${resumeAt} partialSaved=${partialSaved} runId=${partialRunId} status=${stopped.status} signal=${stopped.signal}\nstdout=${stopped.stdout.slice(-400)}\nstderr=${stopped.stderr.slice(-400)}`);
  }

  if (saved && cpExists) {
    const originalList = readFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), 'utf-8');
    writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), JSON.stringify(['sandbox-co-0']), 'utf-8');
    const refused = spawnSync(NODE, [
      '--import', pathToFileURL(preload).href,
      join(ROOT, 'scan-ats-full.mjs'),
      '--ats', 'greenhouse', '--limit', String(COMPANIES), '--since', '7', '--json', '--resume',
    ], { cwd: dir, encoding: 'utf-8', timeout: 30_000, env: childEnv(dir, 'continue') });
    if (refused.status === 1 && /company dataset changed since the checkpoint/.test(refused.stderr) && textHasUrl(pipeline(dir), FIRST) && existsSync(checkpointPath(dir))) {
      pass('a changed company list still refuses to resume, and the saved role stays put');
    } else {
      fail(`dataset change did not refuse resume: status=${refused.status}\n${(refused.stderr || '').slice(-500)}`);
    }
    writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), originalList, 'utf-8');

    writeFileSync(fetched, '', 'utf-8');
    const resumed = spawnSync(NODE, [
      '--import', pathToFileURL(preload).href,
      join(ROOT, 'scan-ats-full.mjs'),
      '--ats', 'greenhouse', '--limit', String(COMPANIES), '--since', '7', '--json', '--resume',
    ], { cwd: dir, encoding: 'utf-8', timeout: 30_000, env: childEnv(dir, 'continue') });
    const text = pipeline(dir);
    const fetchedNames = readFileSync(fetched, 'utf-8').split('\n').filter(Boolean);
    const firstCount = urlCount(text, FIRST);
    const secondCount = urlCount(text, SECOND);
    if (resumed.status === 0 && firstCount === 1 && secondCount === 1 && !fetchedNames.includes('sandbox-co-0') && !existsSync(checkpointPath(dir))) {
      pass('the next run continues past the saved prefix and does not append the first role again');
    } else {
      fail(`resume did not continue: status=${resumed.status} first=${firstCount} second=${secondCount} fetched=${fetchedNames.join(',')} checkpoint=${existsSync(checkpointPath(dir))}\n${(resumed.stderr || '').slice(-500)}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const dryDir = mkdtempSync(join(tmpdir(), 'ats-full-timeout-dry-'));
try {
  const { preload } = prepare(dryDir);
  const stopped = await stopSweep(dryDir, preload, ['--dry-run']);
  const text = pipeline(dryDir);
  const drySawRole = textHasUrl(stopped.stderr, FIRST);
  const drySigterm = stopped.signal === 'SIGTERM';
  if (!signalReachesHandler && drySawRole && drySigterm && !textHasUrl(text, FIRST) && !existsSync(checkpointPath(dryDir)) && !stopped.stdout.includes('"stoppedEarly"')) {
    pass('windows ends a dry run before the handler can print or write');
  } else if (signalReachesHandler && !textHasUrl(text, FIRST) && !existsSync(checkpointPath(dryDir)) && stopped.stdout.includes('"stoppedEarly":true') && stopped.stdout.includes('"checkpointAvailable":false')) {
    pass('a dry run still only prints the partial result and writes nothing');
  } else {
    fail(`dry run wrote state: pipelineHasRole=${textHasUrl(text, FIRST)} checkpoint=${existsSync(checkpointPath(dryDir))} status=${stopped.status} stdout=${stopped.stdout.slice(-300)}`);
  }
} finally {
  rmSync(dryDir, { recursive: true, force: true });
}

const liveDir = mkdtempSync(join(tmpdir(), 'ats-full-timeout-liveness-'));
try {
  const { preload } = prepare(liveDir);
  const stopped = await stopSweep(liveDir, preload, ['--liveness']);
  const text = pipeline(liveDir);
  const sawRole = textHasUrl(stopped.stderr, FIRST);
  const sigterm = stopped.signal === 'SIGTERM';
  let partial = null;
  if (existsSync(checkpointPath(liveDir))) partial = readCheckpoint(liveDir).partialSave ?? null;
  if (!signalReachesHandler && sawRole && sigterm && !textHasUrl(text, FIRST) && !stopped.stdout.includes('"stoppedEarly"')) {
    pass('windows ends a liveness sweep before the handler can write');
  } else if (
    signalReachesHandler
    && !textHasUrl(text, FIRST)
    && stopped.stdout.includes('"stoppedEarly":true')
    && stopped.stdout.includes('"checkpointAvailable":true')
    && stopped.stdout.includes('"saved":false')
    && partial?.saved === false
    && partial?.postingsKept >= 1
  ) {
    pass('a liveness stop keeps the roles in the checkpoint and does not write pipeline.md');
  } else {
    fail(`liveness stop wrote unverified roles: pipeline=${textHasUrl(text, FIRST)} partial=${JSON.stringify(partial)} status=${stopped.status}\nstdout=${stopped.stdout.slice(-400)}`);
  }
} finally {
  rmSync(liveDir, { recursive: true, force: true });
}
