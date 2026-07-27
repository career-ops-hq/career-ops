// tests/stats.test.mjs — moved verbatim from test-all.mjs (#1604).
import { pass, fail, run, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nstats.mjs — lifetime pipeline stats aggregator (#1604)');
try {
  const stats = await import(pathToFileURL(join(ROOT, 'stats.mjs')).href);

  // Tracker roll-up — CRLF input on purpose (Windows checkouts).
  const trackerMd = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme | Eng | 4.5/5 | Applied | ✅ | [1](../reports/001-acme-2026-06-01.md) | note |',
    '| 2 | 2026-06-02 | Beta | Eng | 3.8/5 | Evaluated | ❌ | [2](../reports/002-beta-2026-06-02.md) | note |',
    '| 3 | 2026-06-03 | Gama | Eng | 4.2/5 | Interview | ✅ | ❌ | note |',
  ].join('\r\n');
  const t = stats.computeTrackerStats(trackerMd);
  if (t.total === 3 && t.byStatus.Applied === 1 && t.byStatus.Evaluated === 1
      && t.byStatus.Interview === 1 && t.avgScore === 4.2 && t.avgScoreApplied === 4.4
      && t.topScore === 4.5 && t.pdfPct === 66.7 && t.reportPct === 66.7 && t.activeApps === 2) {
    pass('computeTrackerStats counts statuses, scores, pdf/report pct, active apps (CRLF input)');
  } else {
    fail(`computeTrackerStats wrong output: ${JSON.stringify(t)}`);
  }

  // Hired rows must classify as Hired (a canonical status per states.yml), not
  // collapse into an "Unknown" bucket, and must feed avgScoreApplied — a landed
  // job is the fullest pursuit, so its fit score belongs in that average.
  const hiredMd = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme | Eng | 4.5/5 | Hired | ✅ | ❌ | landed |',
    '| 2 | 2026-06-02 | Beta | Eng | 3.5/5 | Applied | ✅ | ❌ | sent |',
  ].join('\n');
  const th = stats.computeTrackerStats(hiredMd);
  if (th.byStatus.Hired === 1 && th.byStatus.Unknown === undefined && th.avgScoreApplied === 4) {
    pass('computeTrackerStats recognizes Hired and folds it into avgScoreApplied');
  } else {
    fail(`computeTrackerStats mishandles Hired: ${JSON.stringify(th.byStatus)} avgScoreApplied=${th.avgScoreApplied}`);
  }

  // Funnel — Rejected counts into everApplied (mirrors dashboard ComputeProgressMetrics).
  const f = stats.computeFunnel({ Applied: 4, Responded: 2, Interview: 1, Offer: 1, Rejected: 2, Evaluated: 9 });
  if (f.everApplied === 10 && f.everResponded === 4 && f.everInterview === 2 && f.everOffer === 1
      && f.responseRate === 40 && f.offerRate === 10 && f.smallSample === false) {
    pass('computeFunnel cumulative ever* stages match the dashboard math');
  } else {
    fail(`computeFunnel wrong output: ${JSON.stringify(f)}`);
  }

  // Hired is a canonical status (states.yml) and the fullest success — it must
  // count through everOffer, not fall out of the funnel as "Unknown".
  const fh = stats.computeFunnel({ Applied: 2, Interview: 1, Hired: 1 });
  if (fh.everApplied === 4 && fh.everResponded === 2 && fh.everInterview === 2 && fh.everOffer === 1) {
    pass('computeFunnel counts Hired into every stage through everOffer');
  } else {
    fail(`computeFunnel mishandles Hired: ${JSON.stringify(fh)}`);
  }
  if (stats.computeFunnel({ Applied: 3 }).smallSample === true) {
    pass('computeFunnel flags small samples (everApplied < 10)');
  } else {
    fail('computeFunnel should flag everApplied < 10 as smallSample');
  }

  // Lifetime scan totals — CRLF input, torn row skipped, fingerprint column tolerated.
  const scanTsv = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://a/1\t2026-06-20\tgreenhouse\tEng\tAcme\tadded\tRemote',
    'https://a/2\t2026-06-21\tgreenhouse\tEng2\tAcme\tadded\tRemote\tdeadbeefdeadbeef',
    'https://b/1\t2026-06-22\tashby\tEng\tBeta\tskipped_expired\tNY',
    'https://c/1\t2026-06-2',
  ].join('\r\n');
  const s = stats.computeScanStats(scanTsv);
  if (s.totalRecorded === 4 && s.added === 3 && s.byPortal.greenhouse === 2
      && s.byStatus.skipped_expired === 1 && s.distinctCompanies === 2
      && s.firstSeen === '2026-06-20' && s.lastSeen === '2026-06-22'
      && s.addedPerWeek.some(w => w.week === '2026-W25' && w.count === 2)) {
    pass('computeScanStats lifetime totals from scan-history.tsv (CRLF, extra fingerprint col)');
  } else {
    fail(`computeScanStats wrong output: ${JSON.stringify(s)}`);
  }

  // ISO week year-boundary — the one place hand-rolled week math fails.
  const wk = [stats.isoWeek('2025-12-29'), stats.isoWeek('2026-01-01'), stats.isoWeek('2024-12-31'), stats.isoWeek('2027-01-01')];
  if (wk[0] === '2026-W01' && wk[1] === '2026-W01' && wk[2] === '2025-W01' && wk[3] === '2026-W53') {
    pass('isoWeek handles year boundaries');
  } else {
    fail(`isoWeek boundary math wrong: ${JSON.stringify(wk)}`);
  }

  // Portal coverage — real portals.yml keys (tracked_companies / job_boards).
  const portalsYml = [
    'tracked_companies:',
    '  - name: Acme',
    '    careers_url: https://boards.greenhouse.io/acme',
    '  - name: Beta',
    '    careers_url: https://jobs.ashbyhq.com/beta',
    '  - name: Gama',
    '    careers_url: https://gama.example.com/jobs',
    'job_boards:',
    '  - name: BigBoard',
    '    url: https://bigboard.example.com',
  ].join('\n');
  const p = stats.computePortalStats(portalsYml, { byPortal: { greenhouse: 5, ashby: 2 } }, ['acme', 'beta']);
  if (p.configuredCompanies === 3 && p.configuredBoards === 1
      && p.activePortals === 2 && p.producingCompanies === 2 && p.producingPct === 66.7) {
    pass('computePortalStats configured vs producing coverage');
  } else {
    fail(`computePortalStats wrong output: ${JSON.stringify(p)}`);
  }

  // Follow-up compliance.
  const followupsMd = [
    '# Follow-ups',
    '| # | App | Date | Company | Role | Channel | Contact | Notes |',
    '|---|-----|------|---------|------|---------|---------|-------|',
    '| 1 | 1 | 2026-06-10 | Acme | Eng | email | jane | pinged |',
    '| 2 | 1 | 2026-06-17 | Acme | Eng | email | jane | pinged again |',
    '| 3 | 3 | 2026-06-12 | Gama | Eng | linkedin | bob | intro |',
  ].join('\n');
  const trackerByNum = new Map([[1, 'Applied'], [2, 'Applied'], [3, 'Interview']]);
  const fu = stats.computeFollowupStats(followupsMd, trackerByNum);
  if (fu.totalFollowups === 3 && fu.appsWithFollowups === 2
      && fu.appliedWithoutFollowup === 1 && fu.avgPerApp === 1.5) {
    pass('computeFollowupStats compliance from follow-ups.md');
  } else {
    fail(`computeFollowupStats wrong output: ${JSON.stringify(fu)}`);
  }

  // CLI smoke — must emit the full contract with null sections in a checkout
  // with no user data (exactly the CI environment).
  const cliOut = run(NODE, [join(ROOT, 'stats.mjs')]);
  const parsed = JSON.parse(cliOut);
  if (parsed && parsed.metadata && 'tracker' in parsed && 'scan' in parsed && 'portals' in parsed
      && 'followups' in parsed && 'funnel' in parsed && 'runs' in parsed) {
    pass('stats.mjs CLI emits the full JSON contract (sections null when sources missing)');
  } else {
    fail(`stats.mjs CLI missing sections: ${parsed ? Object.keys(parsed).join(',') : cliOut}`);
  }
  const summaryOut = run(NODE, [join(ROOT, 'stats.mjs'), '--summary']);
  if (summaryOut && summaryOut.includes('Pipeline Stats')) {
    pass('stats.mjs --summary renders the human table');
  } else {
    fail('stats.mjs --summary missing header');
  }
} catch (e) {
  fail(`stats.mjs tests crashed: ${e.message}`);
}
