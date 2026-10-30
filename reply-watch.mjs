#!/usr/bin/env node

/**
 * reply-watch.mjs — Classify employer replies and generate a review digest (RFC #1585).
 *
 * Reads candidate replies from a JSON file, matches them against the application tracker,
 * classifies the reply types (e.g. Interview, Rejected, Noise), and prints a concise
 * review digest. Prompts the user to approve recommended tracker status updates.
 *
 * Usage:
 *   node reply-watch.mjs [path/to/candidates.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchCandidates, classifyReply } from './reply-matcher.mjs';
import { resolveColumns, parseTrackerRow, trackerRowIdentity } from './tracker-parse.mjs';
import { resolveTrackerPath, loadCanonicalStates } from './tracker-utils.mjs';
import { readReplyProposals, hasProposalReceipt } from './lib/reply-proposals.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { parseFollowups } from './followup-cadence.mjs';

// Every file here is user layer, so it resolves against the data root
// (CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / .career-ops-data marker), never the
// script's own directory — which is only the default when none is configured.
const DATA_ROOT = getCareerOpsRoot();
export const DEFAULT_CANDIDATES_PATH = process.env.CAREER_OPS_REPLY_CANDIDATES
  || path.join(DATA_ROOT, 'data', 'reply-candidates.json');
export const APPS_FILE = resolveTrackerPath(DATA_ROOT);
export const FOLLOWUPS_FILE = path.join(DATA_ROOT, 'data', 'follow-ups.md');
const CODE_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Helper to ask a question in the CLI
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.once('close', () => resolve(''));
    rl.question(query, (ans) => {
      resolve(ans);
      rl.close();
    });
  });
}

// Generate custom signal description based on keywords
function getSignalDesc(text, signal) {
  const parts = [];
  if (text.includes('简历通过')) {
    parts.push('resume passed');
  }
  if (text.includes('微信小程序') || text.includes('WeChat mini-program') || text.includes('AI微信小程序')) {
    parts.push('AI WeChat mini-program interview');
  }
  if (parts.length > 0) {
    return parts.join(' + ');
  }
  return signal || 'none';
}

// Create a default set of mock candidates if the file doesn't exist
function ensureCandidatesFile(filePath) {
  if (fs.existsSync(filePath)) return;

  const mockCandidates = [
    {
      message_id: 'msg1',
      from: 'recruiter@wingyun.com',
      subject: '恭喜简历通过，杭州赢云贸易有限公司邀您面试',
      body_snippet: '您的首轮面试是AI微信小程序面试。面试形式：AI微信小程序面试，面试时长：约15~30分钟',
      signal: 'interview_invite'
    },
    {
      message_id: 'msg2',
      from: 'hr@examplelabs.com',
      subject: 'Update on your application for Full-stack Engineer',
      body_snippet: '很遗憾地通知您，您的简历与我们当前岗位的需求暂不匹配，不合适我司的要求，未能进入下一轮。',
      signal: 'rejection'
    },
    {
      message_id: 'msg3',
      from: 'alerts@zhaopin.com',
      subject: 'Zhaopin job alert',
      body_snippet: '我们为您推荐了以下职位：邀请投递测试工程师岗位，现在沟通，抢面试先机！近期热招职位，立即投递！',
      signal: null
    },
    {
      message_id: 'msg4',
      from: 'hr@somecompany.com',
      subject: '补充信息',
      body_snippet: '邀请您在面试/入职之前更新或补充最新的应聘信息。',
      signal: null
    }
  ];

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(mockCandidates, null, 2), 'utf-8');
  console.log(`Created default mock candidates file at ${filePath}`);
}

// Load applications tracker rows
function loadTrackerApps() {
  if (!fs.existsSync(APPS_FILE)) {
    return [];
  }
  const content = fs.readFileSync(APPS_FILE, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const apps = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) {
      apps.push(row);
    }
  }
  return apps;
}

// Load followups history
function loadFollowups() {
  if (!fs.existsSync(FOLLOWUPS_FILE)) {
    return [];
  }
  return parseFollowups(fs.readFileSync(FOLLOWUPS_FILE, 'utf-8'));
}

// Apply an approved batch in one locked read/modify/write transaction. Reading
// after lock acquisition matters because the review prompt can remain open
// while another process merges or updates tracker rows.
function groupStatusRecommendations(recommendations) {
  const byApplication = new Map();
  for (const recommendation of recommendations) {
    if (!byApplication.has(recommendation.num)) byApplication.set(recommendation.num, new Map());
    const transitions = byApplication.get(recommendation.num);
    const key = `${recommendation.oldStatus}\0${recommendation.newStatus}`;
    const existing = transitions.get(key);
    if (existing) {
      existing.count++;
      existing.proposals.push(...(recommendation.proposals ?? []));
    } else {
      transitions.set(key, { ...recommendation, proposals: [...(recommendation.proposals ?? [])], count: 1 });
    }
  }

  const updates = [];
  const conflicts = [];
  for (const [num, transitions] of byApplication) {
    const choices = [...transitions.values()];
    if (choices.length === 1) updates.push(choices[0]);
    else conflicts.push({ num, choices });
  }
  return { updates, conflicts };
}

// Every accepted update is written by set-status.mjs, the canonical writer, so
// it runs the same status hooks as any other status change: the status-log
// row, the JD archive on a move into Interview, follow-up seeding on Applied
// (#5536). A cell edit here skipped all but the first, and the next hook added
// to set-status would have been skipped too.
//
// Returns the parsed JSON result, or the writer's structured error (`code`,
// plus `exitCode`, and `currentStatus` for a status-changed refusal).
function runSetStatus(args) {
  try {
    const output = execFileSync(process.execPath, [path.join(CODE_ROOT, 'set-status.mjs'), ...args, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: DATA_ROOT, CAREER_OPS_TRACKER: APPS_FILE },
      // stdout is the JSON result. stderr is passed through: it carries what
      // the hooks have to tell the user directly, such as another session
      // already working this row, or a failed JD archive.
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return { result: JSON.parse(output) };
  } catch (err) {
    let failure = {};
    try { failure = JSON.parse(err.stdout); } catch { /* no structured result */ }
    return { error: { ...failure, exitCode: err.status ?? null } };
  }
}

// What the hooks did, from set-status's JSON. Under --json it prints only
// failures (to the stderr passed through above), so successes are reported
// here; the ledger warning is restated per row in reply-watch's own words.
function reportHooks(result, ledgerWarning) {
  if (result.statusLogged === false) console.warn(ledgerWarning);
  if (result.followupSeeded?.seeded) {
    console.log(`   Follow-up seeded for #${result.num}: next ${result.followupSeeded.nextDate}`);
  }
  const archive = result.jdArchiveTriggered;
  if (archive?.attempted && !archive.error) {
    console.log(`   Archived the JD for #${result.num} before the posting can close`);
  }
}

// A busy or unusable lock is not about one row: stop applying, as the
// in-process writer did when it could not open the tracker.
function isLockFailure(error) {
  return error.code === 'lock-timeout' || error.code === 'lock-error';
}

// Re-read after the prompt, then compare the entire tracker under the canonical
// writer's lock. This protects both the reviewed row and receipt absence across
// ALL rows, including two concurrent reviews of one message targeting different
// applications. Status + receipt share the writer's single atomic replacement.
function applyProposalUpdate(update) {
  const content = fs.readFileSync(APPS_FILE, 'utf8');
  const lines = content.split('\n');
  const columns = resolveColumns(lines);
  const apps = lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
  const matches = apps.filter(app => app.num === update.num);
  if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(update.snapshot)) {
    console.warn(`Skipped #${update.num}: tracker row changed during review; review again`);
    return true;
  }
  if (update.proposals.some(p => hasProposalReceipt(apps, p.receipt))) {
    console.warn(`Skipped #${update.num}: proposal was already accepted during review`);
    return true;
  }
  const digest = createHash('sha256').update(content).digest('hex');
  const { result, error } = runSetStatus(['--row', String(update.num), update.newStatus, '--source', 'reply-watch',
    '--expect-tracker', digest, '--note', update.proposals.map(p => p.receipt).join('; ')]);
  if (result) {
    console.log(`Updated #${result.num} to ${result.newStatus}`);
    reportHooks(result, `Warning: status-log append failed for #${result.num}; status and receipt were saved`);
    return true;
  }
  console.warn(`Skipped #${update.num}: ${error.code ?? 'canonical writer failed; review again before retrying'}`);
  return !isLockFailure(error);
}

// The candidates path hands the writer the snapshot that was on screen, and the
// writer checks it under its lock: the row must still be the application shown
// (--expect-row, every cell but Status) and still hold the status shown
// (--expect-status). Consent belongs to the displayed application, not a
// reusable row number, so a replaced or duplicated row is refused (#5034). A
// write to some other row meanwhile is not a reason to refuse, which is why
// this does not use --expect-tracker the way the proposal path must.
//
// Returns false when the tracker lock could not be taken.
function applyReviewedUpdate(update) {
  const count = update.count > 1 ? ` (${update.count} replies)` : '';
  const { result, error } = runSetStatus(['--row', String(update.num), update.newStatus, '--source', 'reply-watch',
    '--expect-row', trackerRowIdentity(update.snapshot), '--expect-status', update.oldStatus]);
  if (result) {
    if (!result.changed) {
      console.log(`No change for #${update.num}: already ${update.newStatus}${count}`);
    } else {
      console.log(`Updated #${update.num} to ${update.newStatus}${count}`);
      reportHooks(result, `Warning: failed to append to status-log.tsv for #${update.num}; the status was saved`);
    }
    return true;
  }
  if (error.code === 'status-changed') {
    console.warn(`Skipped #${update.num}: status changed from ${update.oldStatus} to ${error.currentStatus} during review`);
  } else if (error.code === 'row-changed' || error.code === 'ambiguous') {
    console.warn(`Skipped #${update.num}: tracker row changed or became ambiguous during review; review again`);
  } else if (error.code === 'not-found') {
    console.warn(`Skipped #${update.num}: row no longer exists in the tracker`);
  } else {
    console.warn(`Skipped #${update.num}: ${error.error ?? error.code ?? 'canonical writer failed'}; review again before retrying`);
  }
  return !isLockFailure(error);
}

const KNOWN_FLAGS = ['--help', '-h'];
const USAGE = 'Usage: node reply-watch.mjs [path/to/candidates.json]';

async function main() {
  const args = process.argv.slice(2);

  const positional = args.filter(a => !a.startsWith('-'));
  validateFlags(args, KNOWN_FLAGS, USAGE);

  const candidatesPath = positional[0] || DEFAULT_CANDIDATES_PATH;
  // An integration-only review must not manufacture candidate emails. Preserve
  // the legacy demo behavior only when no proposal directory is present.
  const hasProposalDirectory = Boolean(fs.lstatSync(path.join(DATA_ROOT, 'data', 'reply-proposals'), { throwIfNoEntry: false }));
  if (!hasProposalDirectory) ensureCandidatesFile(candidatesPath);

  if (positional[0] && !fs.existsSync(candidatesPath)) {
    console.error(`Error: candidates file not found at ${candidatesPath}`);
    process.exit(1);
  }

  let candidates;
  try {
    candidates = fs.existsSync(candidatesPath) ? JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) : [];
  } catch (e) {
    console.error(`Error parsing candidates JSON: ${e.message}`);
    process.exit(1);
  }

  const apps = loadTrackerApps();
  const followups = loadFollowups();

  const matched = matchCandidates(candidates, apps, followups);

  console.log(`\nToday: ${candidates.length} application updates need review\n`);

  const recommendations = [];

  matched.forEach((match, index) => {
    const cand = candidates.find(c => c.message_id === match.message_id);
    const classification = classifyReply(cand);

    let headerStr = '';
    const matchedApplicationNums = Array.isArray(match.application_nums)
      ? match.application_nums
      : (match.application_num !== null ? [match.application_num] : []);

    if (matchedApplicationNums.length > 1) {
      headerStr = `${match.company_hint} — company-wide rejection (${matchedApplicationNums.length} applications)`;
    } else if (matchedApplicationNums.length === 1) {
      const applicationNum = matchedApplicationNums[0];
      const app = apps.find(a => a.num === applicationNum);
      headerStr = app ? `${app.company} — ${app.role}` : (cand.subject || match.company_hint || cand.from || 'Unknown');
    } else {
      headerStr = cand.subject || match.company_hint || cand.from || 'Unknown';
    }

    console.log(`${index + 1}. ${headerStr}`);
    console.log(`   Type: ${classification.type}`);

    // Print Signal for Interview classification when meaningful
    const signalDesc = getSignalDesc(cand.subject + ' ' + cand.body_snippet, cand.signal);
    if (classification.type === 'Interview' && signalDesc && signalDesc !== 'none') {
      console.log(`   Signal: ${signalDesc}`);
    }

    if (classification.evidence && classification.evidence.length > 0) {
      console.log(`   Evidence: ${classification.evidence.join('; ')}`);
    }

    console.log(`   Suggested tracker update: ${classification.suggestedTrackerUpdate}`);
    console.log('');

    if (matchedApplicationNums.length > 0 && classification.suggestedTrackerUpdate !== 'none' && classification.suggestedTrackerUpdate !== 'Needs Review') {
      for (const applicationNum of matchedApplicationNums) {
        const app = apps.find(a => a.num === applicationNum);
        if (app && app.status !== classification.suggestedTrackerUpdate) {
          recommendations.push({
            num: app.num,
            company: app.company,
            role: app.role,
            oldStatus: app.status,
            newStatus: classification.suggestedTrackerUpdate,
            snapshot: app,
          });
        }
      }
    }
  });

  const proposals = readReplyProposals(DATA_ROOT, APPS_FILE, apps,
    loadCanonicalStates(path.join(CODE_ROOT, 'templates', 'states.yml')));
  for (const warning of proposals.warnings) console.warn(warning);
  for (const recommendation of proposals.recommendations) {
    const proposal = recommendation.proposals[0];
    console.log(`Proposal for #${recommendation.num}: ${JSON.stringify(recommendation.company)} — ${JSON.stringify(recommendation.role)}`);
    console.log(`   Source (unverified): ${proposal.source.kind}/${proposal.source.account_id}/${proposal.source.message_id}`);
    console.log(`   Evidence (quoted, untrusted): ${JSON.stringify(proposal.evidence)}`);
    console.log(`   Suggested tracker update: ${recommendation.oldStatus} → ${recommendation.newStatus}\n`);
  }
  recommendations.push(...proposals.recommendations);

  const groupedRecommendations = groupStatusRecommendations(recommendations);
  if (groupedRecommendations.conflicts.length > 0) {
    console.warn('Conflicting status recommendations require manual review:');
    for (const conflict of groupedRecommendations.conflicts) {
      const summary = conflict.choices
        .map(choice => `${choice.newStatus} (${choice.count} ${choice.count === 1 ? 'reply' : 'replies'})`)
        .join(' vs ');
      console.warn(`  #${conflict.num}: ${summary} — no automatic update`);
    }
    console.log('');
  }

  if (groupedRecommendations.updates.length > 0) {
    const updates = groupedRecommendations.updates;
    console.log('Suggested status updates to apply:');
    updates.forEach(r => {
      const count = r.count > 1 ? ` (${r.count} replies)` : '';
      console.log(`  #${r.num} ${r.company} (${r.role}): ${r.oldStatus} → ${r.newStatus}${count}`);
    });
    console.log('');

    const answer = (await askQuestion(`Apply recommended status updates to ${APPS_FILE}? (y/N, or comma-separated row IDs): `)).trim().toLowerCase();
    const rowIds = /^\d+(?:\s*,\s*\d+)*$/.test(answer) ? answer.split(',').map(Number) : [];
    const acceptAll = answer === 'y' || answer === 'yes';
    const selected = acceptAll ? updates : rowIds.length > 0 && rowIds.every(num => updates.some(u => u.num === num))
      ? updates.filter(u => rowIds.includes(u.num)) : [];
    if (selected.length > 0) {
      // One row at a time, so each is checked against the tracker as it is
      // when its own write takes the lock.
      let lockAvailable = true;
      for (const update of selected) {
        lockAvailable = update.proposals.length === 0 ? applyReviewedUpdate(update) : applyProposalUpdate(update);
        if (!lockAvailable) break;
      }
      if (!lockAvailable) {
        console.error('\nCould not take the tracker lock; the remaining updates were not applied. Run reply-watch again.');
        process.exitCode = 1;
        return;
      }
      console.log('\n✅ Tracker review complete');

      // Sync tracker DB if tracker.mjs exists
      try {
        execFileSync(process.execPath, [path.join(CODE_ROOT, 'tracker.mjs'), 'sync'], {
          stdio: 'ignore',
          env: { ...process.env, CAREER_OPS_ROOT: DATA_ROOT, CAREER_OPS_TRACKER: APPS_FILE },
        });
        console.log('Synced database index (applications.db).');
      } catch (e) {
        // ignore
      }
    } else {
      console.log('Updates skipped.');
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
