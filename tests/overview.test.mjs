// tests/overview.test.mjs — tests for overview.mjs (Smart Job Search Overview)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { computeOverview, formatSummary, resolveOverviewPaths } from '../overview.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'overview.mjs');
const TODAY = '2026-10-24'; // Saturday (ISO week 2026-10-19 to 2026-10-25)

const SAMPLE_TRACKER = `
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-10-20 | Alpha Tech | Lead Architect | 4.5/5 | Responded | ✅ | [1](reports/001.md) | Emailed Jane at jane@alphatech.com |
| 2 | 2026-10-01 | Beta Corp | Senior SWE | 4.0/5 | Applied | ✅ | [2](reports/002.md) | Applied via site; contact: Bob bob@beta.com |
| 3 | 2026-06-01 | Gamma Inc | Backend Dev | 3.5/5 | Applied | ❌ | [3](reports/003.md) | Old silent app |
| 4 | 2026-10-15 | Delta Labs | Staff Engineer | 4.2/5 | Interview | ✅ | [4](reports/004.md) | Technical round next |
| 5 | 2026-10-10 | Epsilon Co | Principal AI | 4.8/5 | Rejected | ✅ | [5](reports/005.md) | Position closed |
`;

const SAMPLE_FOLLOWUPS = `
# Follow-ups Log

| num | appNum | date | company | role | channel | contact | notes |
|-----|--------|------|---------|------|---------|---------|-------|
| 1 | 4 | 2026-10-21 | Delta Labs | Staff Engineer | email | hr@delta.com | Sent thank you note |
`;

const SAMPLE_ACTIVE_INTERVIEWS = `
# Active Interviews

| Company | Role | Round | Date/Time | Interviewer | Status | Notes |
|---------|------|-------|-----------|-------------|--------|-------|
| Delta Labs | Staff Engineer | Technical | 2026-10-26 14:00 | Alice Smith | Scheduled | System design focus |
| Omega AI | Research Scientist | Screening | 2026-10-21 11:00 | Dan Brown | Completed | Awaiting feedback |
`;

const SAMPLE_STATUS_LOG = [
  '1\t2026-10-20\tEvaluated\tApplied\tmanual\tapplied online',
  '1\t2026-10-23\tApplied\tResponded\treply-watch\trecruiter replied',
  '4\t2026-10-18\tResponded\tInterview\tmanual\tinvited to tech round',
  '5\t2026-10-22\tApplied\tRejected\treply-watch\trejection email',
].join('\n');

const SAMPLE_PIPELINE = `
# Pipeline Inbox

## Pending
- [ ] https://jobs.example.com/posting/101 | Tech Corp | Senior Dev
- [ ] https://jobs.example.com/posting/102 | AI Labs | Staff AI Engineer
- [!] https://jobs.example.com/posting/103 — login wall

## Processed
- [x] #1 | https://jobs.example.com/posting/099 | Alpha Tech | Lead Architect | 4.5/5 | PDF ✅
`;

test('computeOverview: populates all sections with valid mock data', () => {
  const result = computeOverview({
    appsContent: SAMPLE_TRACKER,
    followupsContent: SAMPLE_FOLLOWUPS,
    intsContent: SAMPLE_ACTIVE_INTERVIEWS,
    statusLogContent: SAMPLE_STATUS_LOG,
    pipelineContent: SAMPLE_PIPELINE,
    today: TODAY,
    days: 60,
  });

  // 1. Tracker metrics
  assert.equal(result.tracker.total, 5);
  assert.equal(result.tracker.activeApps, 4); // 2 Applied, 1 Responded, 1 Interview
  assert.equal(result.tracker.byStatus.Applied, 2);
  assert.equal(result.tracker.byStatus.Responded, 1);
  assert.equal(result.tracker.byStatus.Interview, 1);
  assert.equal(result.tracker.byStatus.Rejected, 1);

  // 2. Follow-ups
  assert.ok(result.followups);
  assert.ok(result.followups.counts.urgent > 0 || result.followups.counts.overdue > 0);
  // Alpha Tech moved to Responded recently -> urgent / overdue
  const urgentOrOverdueCompanies = [...result.followups.urgent, ...result.followups.overdue].map((f) => f.company);
  assert.ok(urgentOrOverdueCompanies.includes('Alpha Tech') || urgentOrOverdueCompanies.includes('Beta Corp'));

  // 3. Stale applications
  // Gamma Inc is from 2026-06-01 (older than 60 days from 2026-10-24)
  assert.equal(result.stale.candidateCount, 1);
  assert.equal(result.stale.candidates[0].company, 'Gamma Inc');

  // 4. Interviews
  assert.equal(result.interviews.upcomingCount, 1);
  assert.equal(result.interviews.upcoming[0].company, 'Delta Labs');
  assert.equal(result.interviews.upcoming[0].round, 'Technical');
  assert.equal(result.interviews.upcoming[0].interviewer, 'Alice Smith');

  // 5. Weekly Activity
  // Week window for 2026-10-24 is 2026-10-19 to 2026-10-25
  assert.equal(result.weeklyActivity.window.from, '2026-10-19');
  assert.equal(result.weeklyActivity.window.to, '2026-10-25');
  assert.equal(result.weeklyActivity.applied, 1); // #1 moved to Applied on 2026-10-20
  assert.equal(result.weeklyActivity.responses, 1); // #1 moved to Responded on 2026-10-23
  assert.equal(result.weeklyActivity.rejections, 1); // #5 moved to Rejected on 2026-10-22
  assert.equal(result.weeklyActivity.followupsSent, 1); // sent on 2026-10-21
  assert.equal(result.weeklyActivity.interviews, 1); // Omega AI on 2026-10-21

  // 6. Pipeline Inbox
  assert.equal(result.pipelineInbox.pendingUrls, 2);

  // 7. Next Actions Priority Queue
  assert.ok(result.nextActions.length > 0);
  const priorities = result.nextActions.map((a) => a.priority);
  // Ensure priority ordering (P0 before P1 before P2 before P3 before P4)
  const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  for (let i = 0; i < priorities.length - 1; i++) {
    assert.ok(priorityRank[priorities[i]] <= priorityRank[priorities[i + 1]]);
  }
});

test('computeOverview: handles empty / missing files gracefully', () => {
  const result = computeOverview({
    appsContent: null,
    followupsContent: null,
    intsContent: null,
    statusLogContent: null,
    pipelineContent: null,
    today: TODAY,
  });

  assert.equal(result.tracker, null);
  assert.equal(result.followups, null);
  assert.equal(result.stale, null);
  assert.equal(result.interviews, null);
  assert.equal(result.weeklyActivity, null);
  assert.equal(result.pipelineInbox, null);
  assert.deepEqual(result.nextActions, []);

  const summary = formatSummary(result);
  assert.ok(summary.includes('Pipeline:   — no data'));
  assert.ok(summary.includes('Follow-ups: — no data'));
  assert.ok(summary.includes('Interviews: — no data'));
  assert.ok(summary.includes('Stale Apps: — no data'));
  assert.ok(summary.includes('No data available'));
});

test('computeOverview: honors followupsEnabled: false', () => {
  const result = computeOverview({
    appsContent: SAMPLE_TRACKER,
    followupsContent: SAMPLE_FOLLOWUPS,
    followupsEnabled: false,
    today: TODAY,
  });

  assert.equal(result.followups.enabled, false);
  const summary = formatSummary(result);
  assert.ok(summary.includes('Follow-ups: turned off'));
});

test('formatSummary: formats human-readable output correctly', () => {
  const result = computeOverview({
    appsContent: SAMPLE_TRACKER,
    followupsContent: SAMPLE_FOLLOWUPS,
    intsContent: SAMPLE_ACTIVE_INTERVIEWS,
    statusLogContent: SAMPLE_STATUS_LOG,
    pipelineContent: SAMPLE_PIPELINE,
    today: TODAY,
  });

  const summary = formatSummary(result);
  assert.ok(summary.includes('Job Search Overview — 2026-10-24'));
  assert.ok(summary.includes('Pipeline:   5 total'));
  assert.ok(summary.includes('Interviews: 1 upcoming'));
  assert.ok(summary.includes('Delta Labs'));
  assert.ok(summary.includes('Stale Apps: 1 silent application'));
  assert.ok(summary.includes('Gamma Inc'));
  assert.ok(summary.includes('Prioritized Next Actions:'));
});

test('computeOverview: stale applications respect interview and follow-up exclusions', () => {
  // Add an interview for Gamma Inc in active-interviews as a contiguous row
  const intsWithGamma = `
# Active Interviews

| Company | Role | Round | Date/Time | Interviewer | Status | Notes |
|---------|------|-------|-----------|-------------|--------|-------|
| Delta Labs | Staff Engineer | Technical | 2026-10-26 14:00 | Alice Smith | Scheduled | System design focus |
| Omega AI | Research Scientist | Screening | 2026-10-21 11:00 | Dan Brown | Completed | Awaiting feedback |
| Gamma Inc | Backend Dev | Screen | 2026-10-28 10:00 | Recruiter | Scheduled | Follow up call |
`;
  const result = computeOverview({
    appsContent: SAMPLE_TRACKER,
    intsContent: intsWithGamma,
    today: TODAY,
    days: 60,
  });

  // Gamma Inc now has an active interview, so it must NOT be flagged as stale
  assert.equal(result.stale.candidateCount, 0);
  // And no P3 action for stale closing should be emitted
  assert.equal(result.nextActions.some((a) => a.type === 'close_stale'), false);
});

test('computeOverview: custom days threshold adjusts stale candidate detection', () => {
  // With days: 10, Beta Corp (2026-10-01) which is 23 days old from 2026-10-24 becomes stale
  const result = computeOverview({
    appsContent: SAMPLE_TRACKER,
    today: TODAY,
    days: 10,
  });

  assert.equal(result.stale.days, 10);
  // Both Gamma Inc and Beta Corp are older than 10 days
  assert.ok(result.stale.candidateCount >= 2);
  const staleNames = result.stale.candidates.map((c) => c.company);
  assert.ok(staleNames.includes('Gamma Inc'));
  assert.ok(staleNames.includes('Beta Corp'));
});

test('CLI: executes against temp data root and outputs valid JSON and summary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'overview-cli-test-'));
  mkdirSync(join(tmp, 'data'), { recursive: true });

  try {
    writeFileSync(join(tmp, 'data', 'applications.md'), SAMPLE_TRACKER);
    writeFileSync(join(tmp, 'data', 'follow-ups.md'), SAMPLE_FOLLOWUPS);
    writeFileSync(join(tmp, 'data', 'active-interviews.md'), SAMPLE_ACTIVE_INTERVIEWS);
    writeFileSync(join(tmp, 'data', 'status-log.tsv'), SAMPLE_STATUS_LOG);
    writeFileSync(join(tmp, 'data', 'pipeline.md'), SAMPLE_PIPELINE);

    const env = { ...process.env, CAREER_OPS_ROOT: tmp, CAREER_OPS_TRACKER: '', CAREER_OPS_FOLLOWUPS: '' };

    // 1. JSON output
    const jsonRun = spawnSync(process.execPath, [SCRIPT, '--today', TODAY], { encoding: 'utf-8', env });
    assert.equal(jsonRun.status, 0);
    const parsed = JSON.parse(jsonRun.stdout);
    assert.equal(parsed.metadata.generatedAt, TODAY);
    assert.equal(parsed.tracker.total, 5);
    assert.equal(parsed.stale.candidateCount, 1);
    assert.equal(parsed.interviews.upcomingCount, 1);

    // 2. Summary output
    const summaryRun = spawnSync(process.execPath, [SCRIPT, '--summary', '--today', TODAY], { encoding: 'utf-8', env });
    assert.equal(summaryRun.status, 0);
    assert.ok(summaryRun.stdout.includes('Job Search Overview — 2026-10-24'));
    assert.ok(summaryRun.stdout.includes('Delta Labs'));
    assert.ok(summaryRun.stdout.includes('Gamma Inc'));

    // 3. Flags validation: rejected unknown flag
    const badRun = spawnSync(process.execPath, [SCRIPT, '--bogus-flag'], { encoding: 'utf-8', env });
    assert.equal(badRun.status, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveOverviewPaths: resolves explicit options and environment overrides', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'overview-paths-test-'));
  const trackerDir = join(tmp, 'tracker-loc');
  mkdirSync(trackerDir, { recursive: true });

  const customTracker = join(trackerDir, 'applications.md');
  const customFollowups = join(trackerDir, 'follow-ups.md');
  writeFileSync(customTracker, SAMPLE_TRACKER);
  writeFileSync(customFollowups, SAMPLE_FOLLOWUPS);

  try {
    // 1. Explicit options
    const resOpt = resolveOverviewPaths({
      dataRoot: tmp,
      appsFile: customTracker,
      followupsFile: customFollowups,
    });
    assert.equal(resOpt.dataRoot, tmp);
    assert.equal(resOpt.appsFile, customTracker);
    assert.equal(resOpt.followupsFile, customFollowups);
    assert.equal(resOpt.statusLogFile, join(trackerDir, 'status-log.tsv'));

    // 2. Discover followups beside tracker when not in data/
    const resBeside = resolveOverviewPaths({
      dataRoot: tmp,
      appsFile: customTracker,
    });
    assert.equal(resBeside.followupsFile, customFollowups);

    // 3. Environment variable overrides via CLI
    const env = {
      ...process.env,
      CAREER_OPS_ROOT: tmp,
      CAREER_OPS_TRACKER: customTracker,
      CAREER_OPS_FOLLOWUPS: customFollowups,
    };
    const cliRun = spawnSync(process.execPath, [SCRIPT, '--today', TODAY], { encoding: 'utf-8', env });
    assert.equal(cliRun.status, 0);
    const parsed = JSON.parse(cliRun.stdout);
    assert.equal(parsed.metadata.sources.tracker, true);
    assert.equal(parsed.metadata.sources.followups, true);
    assert.equal(parsed.tracker.total, 5);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
