/**
 * tests/cli-tracker-path-resolution.test.mjs
 *
 * Asserts that CLI tools (scan.mjs, reply-watch.mjs, linkedin-join.mjs,
 * paste-reply.mjs, rejection-latency.mjs) resolve their tracker and data paths
 * via resolveTrackerPath(DATA_ROOT) rather than hardcoding 'data/applications.md'
 * or anchoring to the code repository (__dirname).
 */

import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { canonicalizeTrackerPath } from '../path-resolver.mjs';

console.log('\nCLI tracker path resolution — CAREER_OPS_TRACKER & CAREER_OPS_DATA_DIR support');

const TRACKER_HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 1 | 2026-06-01 | Acme Corp | Staff Engineer | 4.5/5 | Interview | ❌ | - | |\n';

function evalModule(script, envOverrides = {}) {
  const cleanEnv = { ...process.env };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === null || v === undefined) {
      delete cleanEnv[k];
    } else {
      cleanEnv[k] = v;
    }
  }
  const out = execFileSync(NODE, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: cleanEnv,
  });
  return JSON.parse(out.trim());
}

const tmp = mkdtempSync(join(tmpdir(), 'co-tracker-res-'));
const flatTrackerDir = mkdtempSync(join(tmpdir(), 'co-flat-'));

try {
  const customTracker = join(tmp, 'custom-tracker.md');
  writeFileSync(customTracker, TRACKER_HEADER);

  const flatTrackerFile = join(flatTrackerDir, 'applications.md');
  writeFileSync(flatTrackerFile, TRACKER_HEADER);

  // 1. scan.mjs respects CAREER_OPS_TRACKER
  try {
    const res = evalModule(
      "import { APPLICATIONS_PATH } from './scan.mjs'; console.log(JSON.stringify({ path: APPLICATIONS_PATH }));",
      { CAREER_OPS_TRACKER: customTracker }
    );
    if (res.path === canonicalizeTrackerPath(customTracker)) {
      pass('scan.mjs: APPLICATIONS_PATH respects CAREER_OPS_TRACKER');
    } else {
      fail(`scan.mjs: expected ${customTracker}, got ${res.path}`);
    }
  } catch (err) {
    fail(`scan.mjs CAREER_OPS_TRACKER test failed: ${err.message}`);
  }

  // 2. scan.mjs honors flat root layout under CAREER_OPS_DATA_DIR
  try {
    const res = evalModule(
      "import { APPLICATIONS_PATH } from './scan.mjs'; console.log(JSON.stringify({ path: APPLICATIONS_PATH }));",
      { CAREER_OPS_TRACKER: null, CAREER_OPS_DATA_DIR: flatTrackerDir }
    );
    if (res.path === canonicalizeTrackerPath(flatTrackerFile)) {
      pass('scan.mjs: APPLICATIONS_PATH resolves flat applications.md under CAREER_OPS_DATA_DIR');
    } else {
      fail(`scan.mjs: expected flat tracker ${flatTrackerFile}, got ${res.path}`);
    }
  } catch (err) {
    fail(`scan.mjs flat layout test failed: ${err.message}`);
  }

  // 3. reply-watch.mjs respects CAREER_OPS_TRACKER
  try {
    const res = evalModule(
      "import { APPS_FILE } from './reply-watch.mjs'; console.log(JSON.stringify({ path: APPS_FILE }));",
      { CAREER_OPS_TRACKER: customTracker }
    );
    if (res.path === canonicalizeTrackerPath(customTracker)) {
      pass('reply-watch.mjs: APPS_FILE respects CAREER_OPS_TRACKER');
    } else {
      fail(`reply-watch.mjs: expected ${customTracker}, got ${res.path}`);
    }
  } catch (err) {
    fail(`reply-watch.mjs CAREER_OPS_TRACKER test failed: ${err.message}`);
  }

  // 4. reply-watch.mjs resolves flat applications.md under CAREER_OPS_DATA_DIR and anchors candidates/followups to DATA_ROOT
  try {
    const res = evalModule(
      "import { APPS_FILE, DEFAULT_CANDIDATES_PATH, FOLLOWUPS_FILE } from './reply-watch.mjs'; console.log(JSON.stringify({ apps: APPS_FILE, candidates: DEFAULT_CANDIDATES_PATH, followups: FOLLOWUPS_FILE }));",
      { CAREER_OPS_TRACKER: null, CAREER_OPS_DATA_DIR: flatTrackerDir }
    );
    const expectedApps = canonicalizeTrackerPath(flatTrackerFile);
    const expectedCandidates = join(flatTrackerDir, 'data', 'reply-candidates.json');
    const expectedFollowups = join(flatTrackerDir, 'data', 'follow-ups.md');
    if (res.apps === expectedApps && res.candidates === expectedCandidates && res.followups === expectedFollowups) {
      pass('reply-watch.mjs: resolves flat tracker and anchors candidates/followups to CAREER_OPS_DATA_DIR');
    } else {
      fail(`reply-watch.mjs: mismatch under CAREER_OPS_DATA_DIR: ${JSON.stringify(res)}`);
    }
  } catch (err) {
    fail(`reply-watch.mjs flat layout test failed: ${err.message}`);
  }

  // 5. linkedin-join.mjs respects CAREER_OPS_TRACKER and flat layout
  try {
    const resTracker = evalModule(
      "import { TRACKER_PATH } from './linkedin-join.mjs'; console.log(JSON.stringify({ path: TRACKER_PATH }));",
      { CAREER_OPS_TRACKER: customTracker }
    );
    const resFlat = evalModule(
      "import { TRACKER_PATH } from './linkedin-join.mjs'; console.log(JSON.stringify({ path: TRACKER_PATH }));",
      { CAREER_OPS_TRACKER: null, CAREER_OPS_DATA_DIR: flatTrackerDir }
    );
    if (
      resTracker.path === canonicalizeTrackerPath(customTracker) &&
      resFlat.path === canonicalizeTrackerPath(flatTrackerFile)
    ) {
      pass('linkedin-join.mjs: TRACKER_PATH respects CAREER_OPS_TRACKER and flat CAREER_OPS_DATA_DIR');
    } else {
      fail(`linkedin-join.mjs: TRACKER_PATH mismatch (tracker: ${resTracker.path}, flat: ${resFlat.path})`);
    }
  } catch (err) {
    fail(`linkedin-join.mjs TRACKER_PATH test failed: ${err.message}`);
  }

  // 6. linkedin-join.mjs drives execution down the path that reads the tracker
  try {
    const connectionsCsv = join(tmp, 'Connections.csv');
    writeFileSync(
      connectionsCsv,
      'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nAlice,Smith,https://linkedin.com/in/alicesmith,,Acme Corp,Staff Engineer,01 Jan 2024\n'
    );

    const cliOut = execFileSync(NODE, [
      'linkedin-join.mjs',
      '--tracker-only',
      '--csv', connectionsCsv,
    ], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: customTracker },
    });

    const data = JSON.parse(cliOut);
    const matchedTarget = Array.isArray(data.targets) && data.targets.some(t => t.company && /acme/i.test(t.company));
    if (matchedTarget) {
      pass('linkedin-join.mjs: CLI reads targets from custom tracker and finds connection match');
    } else {
      fail(`linkedin-join.mjs: expected target Acme Corp in CLI output: ${cliOut}`);
    }
  } catch (err) {
    fail(`linkedin-join.mjs CLI execution test failed: ${err.message}`);
  }

  // 7. paste-reply.mjs anchors CANDIDATES_PATH to DATA_ROOT
  try {
    const res = evalModule(
      "import { CANDIDATES_PATH } from './paste-reply.mjs'; console.log(JSON.stringify({ path: CANDIDATES_PATH }));",
      { CAREER_OPS_REPLY_CANDIDATES: null, CAREER_OPS_DATA_DIR: flatTrackerDir }
    );
    const expectedCandidates = join(flatTrackerDir, 'data', 'reply-candidates.json');
    if (res.path === expectedCandidates) {
      pass('paste-reply.mjs: CANDIDATES_PATH anchors to CAREER_OPS_DATA_DIR');
    } else {
      fail(`paste-reply.mjs: expected ${expectedCandidates}, got ${res.path}`);
    }
  } catch (err) {
    fail(`paste-reply.mjs CANDIDATES_PATH test failed: ${err.message}`);
  }

  // 8. paste-reply.mjs appends candidate to DATA_ROOT default path
  try {
    const appendTestScript = `
    import { appendCandidate, CANDIDATES_PATH } from './paste-reply.mjs';
    appendCandidate({
      message_id: 'test-cli-msg',
      subject: 'Interview Confirmation',
      from: 'talent@acme.com',
      body_snippet: 'We would love to chat',
    });
    console.log(JSON.stringify({ path: CANDIDATES_PATH }));
    `;
    evalModule(appendTestScript, {
      CAREER_OPS_REPLY_CANDIDATES: null,
      CAREER_OPS_DATA_DIR: flatTrackerDir,
    });
    const writtenFile = join(flatTrackerDir, 'data', 'reply-candidates.json');
    const writtenContent = readFileSync(writtenFile, 'utf-8');
    if (writtenContent.includes('test-cli-msg') && writtenContent.includes('talent@acme.com')) {
      pass('paste-reply.mjs: appendCandidate writes to CAREER_OPS_DATA_DIR target');
    } else {
      fail(`paste-reply.mjs: candidate not written to ${writtenFile}`);
    }
  } catch (err) {
    fail(`paste-reply.mjs appendCandidate test failed: ${err.message}`);
  }

  // 9. rejection-latency.mjs DEFAULT_TRACKER_PATH respects CAREER_OPS_TRACKER & flat layout
  try {
    const resTracker = evalModule(
      "import { DEFAULT_TRACKER_PATH } from './rejection-latency.mjs'; console.log(JSON.stringify({ path: DEFAULT_TRACKER_PATH }));",
      { CAREER_OPS_TRACKER: customTracker }
    );
    const resFlat = evalModule(
      "import { DEFAULT_TRACKER_PATH } from './rejection-latency.mjs'; console.log(JSON.stringify({ path: DEFAULT_TRACKER_PATH }));",
      { CAREER_OPS_TRACKER: null, CAREER_OPS_DATA_DIR: flatTrackerDir }
    );
    if (
      resTracker.path === canonicalizeTrackerPath(customTracker) &&
      resFlat.path === canonicalizeTrackerPath(flatTrackerFile)
    ) {
      pass('rejection-latency.mjs: DEFAULT_TRACKER_PATH respects CAREER_OPS_TRACKER and flat CAREER_OPS_DATA_DIR');
    } else {
      fail(`rejection-latency.mjs: DEFAULT_TRACKER_PATH mismatch (tracker: ${resTracker.path}, flat: ${resFlat.path})`);
    }
  } catch (err) {
    fail(`rejection-latency.mjs DEFAULT_TRACKER_PATH test failed: ${err.message}`);
  }

  // 10. rejection-latency.mjs CLI loads and evaluates tracker from CAREER_OPS_TRACKER
  try {
    const activeInterviews = join(tmp, 'active-interviews.md');
    writeFileSync(
      activeInterviews,
      '# Active Interviews\n\n| # | Company | Role | Round | Date |\n|---|---------|------|-------|------|\n| 1 | Acme Corp | Staff Engineer | Final | 2026-05-01 |\n'
    );

    const cliOut = execFileSync(NODE, [
      'rejection-latency.mjs',
      '--file', activeInterviews,
      '--today', '2026-07-01',
    ], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: customTracker },
    });

    const parsed = JSON.parse(cliOut);
    if (parsed && Array.isArray(parsed.flags) && parsed.flags.some(f => f.company === 'Acme Corp')) {
      pass('rejection-latency.mjs: CLI evaluates overdue interview from custom tracker');
    } else {
      fail(`rejection-latency.mjs: expected flag for Acme Corp: ${cliOut}`);
    }
  } catch (err) {
    fail(`rejection-latency.mjs CLI execution test failed: ${err.message}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(flatTrackerDir, { recursive: true, force: true });
}
