/**
 * status-hooks.mjs — what runs around a tracker status change (#5536).
 *
 * set-status.mjs is the canonical status writer, and these hooks used to be
 * top-level code inside it: the advisory session-activity claim (#4532), the
 * status-log.tsv ledger row, follow-up seeding on a move into Applied (#1430),
 * and the JD archive on a move into Interview (#4506). A script that has to
 * write the Status cell inside its own transaction — dedup-tracker.mjs moves a
 * removed duplicate's status onto the kept row in the same write that removes
 * the duplicate — could only get them by spawning set-status.mjs, which it
 * cannot do without splitting that write in two. So it got none of them, and
 * every hook added to set-status later would have been missed the same way.
 *
 * Callers that CAN delegate (reply-watch.mjs, the web status route) should
 * still spawn set-status.mjs: it also validates the state, resolves the row
 * and guards the reviewed snapshot. This module is for a writer that has
 * already committed the status itself.
 *
 * Every hook is advisory and never fails the status change: the write has
 * already committed, so a hook failure is a warning and a structured result,
 * never a thrown error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { extractTrackerReportNumbers, firstLinkTarget } from '../tracker-parse.mjs';
import { normalizeCompany, resolveWorkspaceRoot, appendLedgerRows } from '../tracker-utils.mjs';
import { claimActivity, releaseActivity, describeActiveOwner } from '../session-activity.mjs';
import { hasEmbeddedJdArchive } from '../check-jd-archive.mjs';
import { captureSlug, findCaptureForReport } from '../jd-capture.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const JD_ARCHIVE_TIMEOUT_MS = Math.min(
  300_000,
  Math.max(100, Number(process.env.CAREER_OPS_JD_ARCHIVE_TIMEOUT_MS) || 120_000),
);

/**
 * The transition ledger sits beside the tracker file, so CAREER_OPS_TRACKER
 * redirects (tests, custom layouts) keep it next to the tracker it describes.
 *
 * @param {string} trackerPath
 * @returns {string}
 */
export function statusLogPath(trackerPath) {
  return join(dirname(trackerPath), 'status-log.tsv');
}

/**
 * Take the advisory session-activity claim for one tracker row (#4532).
 *
 * Keyed by report number when the row has one (the stable identifier a
 * concurrent session reading the same report is most likely to key on too);
 * falling back to normalized company+role for a backfilled row with no
 * report link.
 *
 * The claim is process-bound because the caller releases it in the same
 * process. A confirmed-dead PID can therefore reclaim a claim left behind by
 * an early process exit; raw CLI claims remain TTL-bound.
 *
 * @param {{company: string, role: string, report?: string, notes?: string}} row
 * @param {string} label - Shown to a concurrent session that finds the claim.
 * @returns {() => void} Releases the claim; a no-op when none was taken.
 */
export function claimStatusActivity(row, label) {
  const activityReportNums = extractTrackerReportNumbers(row.report, row.notes);
  const key = activityReportNums.length
    ? `report:${activityReportNums[0]}`
    : `tracker-row:${normalizeCompany(row.company)}|${row.role}`;
  let token = null;
  try {
    const claim = claimActivity(key, { label, processBound: true });
    if (claim.claimed) {
      token = claim.token;
    } else if (claim.owner) {
      console.warn(`⚠ ${describeActiveOwner(claim.owner)}`);
    }
  } catch (err) {
    console.warn(`⚠ session-activity claim failed (status change proceeding anyway): ${err.message}`);
  }
  return () => {
    if (token === null) return;
    // A leaked claim self-heals once this process is no longer alive (the
    // stale-sentinel handling in session-activity.mjs), so a release failure
    // is only ever a warning.
    try {
      releaseActivity(key, { token });
    } catch (err) {
      console.warn(`⚠ session-activity release failed (status change already committed): ${err.message}`);
    } finally {
      token = null;
    }
  };
}

/**
 * Append one transition to status-log.tsv (read by funnel-velocity.mjs).
 *
 * Observation trail only: the tracker stays the source of truth for STATE,
 * the ledger records WHEN transitions happened. A failed append is a warning,
 * never a failure — the status write already succeeded. Call it inside the
 * tracker lock window, so concurrent writers can't interleave lines.
 *
 * The source must be a member of VALID_SOURCES in funnel-velocity.mjs, and an
 * unknown from- or to-state must be the sentinel "-" (see set-status.mjs).
 *
 * @param {string} trackerPath
 * @param {{num: number, date: string, from: string, to: string, source: string, note?: string}} entry
 * @returns {boolean} Whether the row was written.
 */
export function appendStatusTransition(trackerPath, { num, date, from, to, source, note = '' }) {
  try {
    appendLedgerRows(statusLogPath(trackerPath), `${num}\t${date}\t${from}\t${to}\t${source}\t${note}\n`);
    return true;
  } catch (err) {
    console.error(`⚠ status-log append failed (status change itself succeeded): ${err.message}`);
    return false;
  }
}

/**
 * Seed the first follow-up for a row that just moved into Applied (#1430).
 *
 * Run it AFTER the tracker lock is released. seedFollowup() re-reads the
 * tracker to resolve the applied date, and it must read the row the caller
 * just wrote. It takes its own followups lock, never the tracker lock, so
 * there is no lock ordering to get wrong.
 *
 * Idempotent (`already-seeded` → seeded:false), so a re-run cannot stack
 * duplicate pins.
 *
 * @param {number} num - Tracker row number.
 * @param {object} options
 * @param {string} options.trackerPath
 * @param {string} [options.date] - The day the user says the application was sent.
 * @param {string} [options.statusChangeDate] - Today, on a fresh transition.
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.quiet] - Suppress the success line (machine output).
 * @returns {Promise<{seeded: boolean, nextDate?: string|null, reason?: string, error?: string}>}
 */
export async function seedFollowupOnApplied(num, { trackerPath, date, statusChangeDate, dryRun = false, quiet = false }) {
  try {
    const { seedFollowup } = await import('../followup-seed.mjs');
    // followupsPath is derived from the tracker's own directory, not left to
    // followup-seed's default. Its default is the REPO's data/follow-ups.md,
    // so with CAREER_OPS_TRACKER pointing elsewhere — tests, and any install
    // whose data lives outside the checkout — the status would be written to
    // one tracker and the follow-up seeded next to a different one. The
    // status-log append derives its path the same way.
    const seed = await seedFollowup(num, {
      trackerPath,
      followupsPath: join(dirname(trackerPath), 'follow-ups.md'),
      date,
      statusChangeDate,
      dryRun,
      // assumeApplied on a DRY RUN only, and deliberately not `force`.
      // seedFollowup refuses a row that is not Applied, and on a dry run the
      // tracker was not written — so the row it re-reads still holds the old
      // status and the preview would report a failure for the one thing the
      // real run is about to do. `force` would fix that by ALSO suppressing
      // the already-seeded check, which is the opposite of a preview: a row
      // that already has a pin would be promised a new one here and refused
      // on the real run. assumeApplied relaxes the status guard only. In a
      // real run the row IS Applied by this point and neither is needed.
      ...(dryRun ? { assumeApplied: true } : {}),
    });
    if (!quiet && seed.seeded) {
      console.log(`📅 Follow-up ${dryRun ? 'would be seeded' : 'seeded'} for #${num}: next ${seed.nextDate}`);
    }
    return { seeded: seed.seeded, nextDate: seed.nextDate ?? null, ...(seed.reason ? { reason: seed.reason } : {}) };
  } catch (err) {
    console.error(`⚠ follow-up seeding failed (status change itself succeeded): ${err.message}`);
    return { seeded: false, reason: 'error', error: err.message };
  }
}

/**
 * Archive the JD of a row that just moved into Interview (#4506-direction-2).
 *
 * AGENTS.md requires every application to carry an archived JD, but that
 * requirement is only ever ENFORCED at `oferta`/`pdf` evaluation time — a row
 * entered through `add` (a referral, a recruiter reach-out, a posting that
 * skipped the pipeline) never gets one written, and nothing notices until
 * much later. By the time `interview-prep` goes looking for the JD to build
 * prep material, the posting has often closed, and its fetch ladder's last
 * resort is "tell the user and ask them to paste the JD text instead" — which
 * fails silently if the user never saved a copy either.
 *
 * The transition into Interview is the last reliable moment the posting is
 * still likely to be live (an active interview loop implies the req hasn't
 * been pulled yet) AND the first moment prep material will actually be
 * wanted, so it is the right point to archive automatically rather than
 * leaving it to a human to remember. Detection reuses the same functions
 * check-jd-archive.mjs uses to decide "already covered" (#2789), so this
 * never re-archives a row that already has a `## Job Description` section
 * or a resolvable jds/ capture.
 *
 * Call it only on a real transition (an idempotent re-run into an
 * already-Interview row must not re-archive) and never on a dry run (nothing
 * was written yet for archive-posting.mjs to attach a --report to).
 *
 * @param {{num: number, company: string, report?: string, notes?: string, url?: string}} row
 * @param {object} options
 * @param {string} options.trackerPath
 * @param {boolean} [options.detach] - Start the archive and do not wait for it.
 * @param {boolean} [options.json] - Keep the child's progress off stdout.
 * @returns {{attempted: boolean, detached?: boolean, reason?: string, error?: string}}
 */
export function archiveJdOnInterview(row, { trackerPath, detach = false, json = false }) {
  try {
    const workspaceRoot = resolveWorkspaceRoot(trackerPath);
    const reportsDir = join(workspaceRoot, 'reports');
    const jdsDir = join(workspaceRoot, 'jds');

    // Resolve the report cell to a real file path under reportsDir, the same
    // containment discipline merge-tracker.mjs's resolveReportPath uses for
    // the same reason: the tracker is user-editable, and a report cell is
    // untrusted input until it is proven to land inside reports/. The link is
    // written relative to the TRACKER's own directory (docs: "../reports/..."
    // at data/applications.md, "reports/..." at root), so the leading "../" is
    // stripped and the remainder resolved against the WORKSPACE root, not
    // reportsDir itself — resolving "../reports/x.md" against reportsDir would
    // double the "reports" segment.
    const reportCell = String(row.report ?? '').trim();
    const rawReportPath = (firstLinkTarget(reportCell) ?? reportCell).trim().replace(/^<|>$/g, '');
    let reportPath = null;
    if (rawReportPath && rawReportPath !== '—' && rawReportPath !== '-') {
      const normalized = rawReportPath.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
      const candidate = resolve(normalized.includes('/') ? workspaceRoot : reportsDir, normalized);
      if (candidate.startsWith(reportsDir + sep) && existsSync(candidate)) reportPath = candidate;
    }

    // A Markdown label is presentation, not identity: `[7](.../008-acme.md)`
    // belongs to report 8. Once the path has passed containment + existence,
    // its filename is authoritative for the embedded-JD check and archive.
    const reportPathNum = reportPath
      ? Number.parseInt(/^([0-9]+)-/.exec(basename(reportPath))?.[1] ?? '', 10)
      : NaN;
    const reportNums = extractTrackerReportNumbers(row.report, row.notes);
    const reportNum = Number.isInteger(reportPathNum) && reportPathNum > 0
      ? reportPathNum
      : (reportNums[0] ?? null);

    const alreadyEmbedded = reportPath ? hasEmbeddedJdArchive(readFileSync(reportPath, 'utf-8')) : false;
    const alreadyCaptured = !alreadyEmbedded && reportNum != null && existsSync(jdsDir)
      ? findCaptureForReport(jdsDir, reportNum, { companySlug: captureSlug(row.company) }) !== null
      : false;

    if (alreadyEmbedded || alreadyCaptured) {
      return { attempted: false, reason: alreadyEmbedded ? 'already-embedded' : 'already-captured' };
    }
    if (reportNum == null) return { attempted: false, reason: 'no-report-number' };
    if (!row.url) return { attempted: false, reason: 'no-url' };

    const archiveArgs = [
      join(CODE_ROOT, 'archive-posting.mjs'),
      `--report=${reportNum}`,
      `--company=${row.company}`,
      row.url,
    ];
    // Keep the capture beside the selected tracker even when
    // CAREER_OPS_TRACKER redirects it outside the checkout.
    const archiveEnv = { ...process.env, CAREER_OPS_ROOT: workspaceRoot };
    if (detach) {
      // The caller has a fixed budget (30s in the web UI and the dashboard)
      // and archive-posting can spend more than that on one page load, so
      // waiting here turned a saved status into a reported timeout.
      // lib/run-bounded.mjs keeps the timeout, since no parent is left to
      // enforce it. stdio 'ignore' matters: an inherited pipe would hold
      // the caller's read open until the archive exits.
      if (!json) console.log(`📄 No JD archived for #${row.num} yet — archiving report ${reportNum} in the background, before the posting can close.`);
      const child = spawn(
        process.execPath,
        [join(CODE_ROOT, 'lib', 'run-bounded.mjs'), String(JD_ARCHIVE_TIMEOUT_MS), ...archiveArgs],
        { detached: true, stdio: 'ignore', windowsHide: true, env: archiveEnv },
      );
      // A spawn failure arrives as an event after the status is written;
      // unhandled, it would crash the caller after its result printed.
      child.on('error', (err) => console.warn(`⚠ JD archive could not start (status change itself succeeded): ${err.message}`));
      child.unref();
      return { attempted: true, detached: true };
    }
    if (!json) console.log(`📄 No JD archived for #${row.num} yet — archiving report ${reportNum} now, before the posting can close:`);
    execFileSync(process.execPath, archiveArgs, {
      // stdout is a protocol surface under --json: capture child
      // progress so the parent emits exactly one JSON document.
      stdio: json ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      timeout: JD_ARCHIVE_TIMEOUT_MS,
      env: archiveEnv,
    });
    return { attempted: true };
  } catch (err) {
    const archiveTimedOut = err?.code === 'ETIMEDOUT'
      || err?.errno === 'ETIMEDOUT'
      || err?.signal === 'SIGTERM';
    const archiveError = archiveTimedOut
      ? `JD archive timed out after ${JD_ARCHIVE_TIMEOUT_MS}ms`
      : err.message;
    console.warn(`⚠ JD archive trigger failed (status change itself succeeded): ${archiveError}`);
    return { attempted: true, error: archiveError };
  }
}
