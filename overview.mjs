#!/usr/bin/env node
/**
 * overview.mjs — Smart Job Search Overview (Command Center) for career-ops
 *
 * Consolidated, read-only operational dashboard:
 *   - Application counts and breakdown by canonical status
 *   - Urgent and overdue follow-up tracking
 *   - Stale application detection (silent Applied rows > cutoff days)
 *   - Active and upcoming interviews
 *   - Weekly activity rollup for the current ISO week
 *   - Prioritized next actions queue (P0 to P4)
 *
 * Local-first and zero-token: reuses existing core modules without duplicating
 * calculation logic, schemas, or external APIs.
 *
 * Usage:
 *   node overview.mjs             # JSON contract to stdout
 *   node overview.mjs --json      # explicit JSON output
 *   node overview.mjs --summary   # human-readable terminal dashboard
 *   node overview.mjs --today <YYYY-MM-DD>  # evaluate as of a fixed date (testing/replay)
 *   node overview.mjs --days <N>  # stale cutoff in days (default 60)
 *   node overview.mjs --help|-h   # show usage
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { validateFlags, flagValue, hasFlag } from './lib/cli-flags.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, getProfilePath, resolveTrackerPath } from './path-resolver.mjs';

import { computeTrackerStats, computeColdAppNums, trackerStatusByNum } from './stats.mjs';
import {
  analyzeFromContent, contactLabel, parseFollowups, loadFollowupsEnabled,
  parseNextOverrides, parseClearedDirectives,
} from './followup-cadence.mjs';
import { classifyRows, interviewCompanies, DEFAULT_DAYS } from './close-stale.mjs';
import { parseActiveInterviews, findColumn } from './process-quality.mjs';
import { computeDefaultRange } from './weekly-digest.mjs';
import { loadCanonicalStates, resolveCanonicalStateId } from './tracker-utils.mjs';
import { parseStatusLog, foldObservations } from './funnel-velocity.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');

const KNOWN_FLAGS = ['--summary', '--json', '--today', '--days', '--help', '-h'];
const VALUE_FLAGS = ['--today', '--days'];

const USAGE = `Usage:
  node overview.mjs             # full JSON overview to stdout
  node overview.mjs --summary   # human-readable dashboard table
  node overview.mjs --today <YYYY-MM-DD> # evaluate as of a fixed date
  node overview.mjs --days <N>  # stale cutoff days (default ${DEFAULT_DAYS})
  node overview.mjs --help|-h   # print this usage message and exit`;

/**
 * Pure overview computation engine.
 * Accepts in-memory content strings or options for testing isolation.
 */
export function computeOverview({
  appsContent = null,
  followupsContent = null,
  intsContent = null,
  statusLogContent = null,
  pipelineContent = null,
  today = localToday(),
  days = DEFAULT_DAYS,
  followupsEnabled = true,
  states = null,
  paths = null,
} = {}) {
  const loadedStates = states || (existsSync(STATES_FILE) ? loadCanonicalStates(STATES_FILE) : []);

  // 1. Pipeline / Tracker Stats
  let tracker = null;
  if (appsContent) {
    const baseStats = computeTrackerStats(appsContent);
    const coldNums = computeColdAppNums(appsContent, followupsContent || '');
    let activeAppsCold = 0;
    if (coldNums.size > 0) {
      const byNum = trackerStatusByNum(appsContent);
      for (const [num, status] of byNum) {
        if (status && coldNums.has(num)) activeAppsCold++;
      }
    }
    tracker = {
      ...baseStats,
      activeAppsLive: baseStats.activeApps - activeAppsCold,
      activeAppsCold,
    };
  }

  // 2. Follow-ups (Urgent & Overdue)
  let followups = null;
  let urgentFollowups = [];
  let overdueFollowups = [];
  if (appsContent && followupsEnabled) {
    const cadence = analyzeFromContent(appsContent, followupsContent || '', {
      enabled: followupsEnabled,
      statusLogContent: statusLogContent || '',
      today,
    });
    if (!cadence.error) {
      urgentFollowups = cadence.entries.filter((e) => e.urgency === 'urgent');
      overdueFollowups = cadence.entries.filter((e) => e.urgency === 'overdue');
      followups = {
        enabled: true,
        counts: {
          urgent: urgentFollowups.length,
          overdue: overdueFollowups.length,
          waiting: cadence.metadata?.waiting ?? 0,
          cold: cadence.metadata?.cold ?? 0,
          retired: cadence.metadata?.retired ?? 0,
        },
        urgent: urgentFollowups.map((e) => ({
          num: e.num,
          company: e.company,
          role: e.role,
          daysSinceApplication: e.daysSinceApplication,
          daysSinceLastFollowup: e.daysSinceLastFollowup,
          followupCount: e.followupCount,
          contact: contactLabel(e.contacts?.[0]),
        })),
        overdue: overdueFollowups.map((e) => ({
          num: e.num,
          company: e.company,
          role: e.role,
          daysSinceApplication: e.daysSinceApplication,
          daysSinceLastFollowup: e.daysSinceLastFollowup,
          followupCount: e.followupCount,
          contact: contactLabel(e.contacts?.[0]),
        })),
      };
    }
  } else if (!followupsEnabled) {
    followups = { enabled: false, counts: null, urgent: [], overdue: [] };
  }

  // 3. Stale Applications
  let staleCandidates = [];
  let staleAppliedCount = 0;
  if (appsContent) {
    const intCompanies = intsContent ? interviewCompanies(intsContent) : [];
    const fupsParsed = {
      entries: followupsContent ? parseFollowups(followupsContent) : [],
      pins: followupsContent ? parseNextOverrides(followupsContent) : new Map(),
      cleared: followupsContent ? parseClearedDirectives(followupsContent) : new Map(),
    };
    const timelines = statusLogContent
      ? foldObservations(parseStatusLog(statusLogContent, loadedStates).observations)
      : new Map();

    const staleClassification = classifyRows(appsContent, {
      today,
      days,
      states: loadedStates,
      interviewCompanies: intCompanies,
      followups: fupsParsed,
      timelines,
    });
    staleCandidates = staleClassification.candidates || [];
    staleAppliedCount = staleClassification.appliedRows || 0;
  }

  // 4. Interviews (Active & Upcoming)
  let activeInterviews = [];
  let upcomingInterviews = [];
  if (intsContent) {
    const parsedInts = parseActiveInterviews(intsContent);
    const terminalStatuses = new Set(['completed', 'passed', 'rejected', 'cancelled', 'withdrawn', 'declined', 'offer', 'closed']);
    for (const row of parsedInts) {
      const company = findColumn(row, 'company');
      const role = findColumn(row, 'role');
      const round = findColumn(row, 'round');
      const dateTime = findColumn(row, 'date/time') || findColumn(row, 'date');
      const interviewer = findColumn(row, 'interviewer');
      const statusRaw = findColumn(row, 'status');
      const notes = findColumn(row, 'notes');
      const statusNorm = statusRaw.toLowerCase().trim();

      const dateMatch = /\d{4}-\d{2}-\d{2}/.exec(dateTime);
      const rowDate = dateMatch ? dateMatch[0] : null;

      const item = {
        company,
        role,
        round,
        dateTime,
        date: rowDate,
        interviewer: interviewer || null,
        status: statusRaw || 'Scheduled',
        notes,
      };

      if (rowDate && rowDate >= today && !terminalStatuses.has(statusNorm)) {
        upcomingInterviews.push(item);
      } else if (!terminalStatuses.has(statusNorm)) {
        activeInterviews.push(item);
      }
    }
    upcomingInterviews.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // 5. Weekly Activity
  const weekWindow = computeDefaultRange(new Date(today));
  let weeklyApplied = 0;
  let weeklyResponses = 0;
  let weeklyRejections = 0;
  if (statusLogContent) {
    const { observations } = parseStatusLog(statusLogContent, loadedStates);
    const foldedByNum = foldObservations(observations);
    for (const timeline of foldedByNum.values()) {
      for (const event of timeline) {
        if (event.date >= weekWindow.from && event.date <= weekWindow.to) {
          const toId = resolveCanonicalStateId(event.to, loadedStates)
            || String(event.to || '').toLowerCase().trim();
          if (toId === 'applied') weeklyApplied++;
          else if (['responded', 'assessment', 'interview', 'offer', 'hired'].includes(toId)) weeklyResponses++;
          else if (['rejected', 'discarded'].includes(toId)) weeklyRejections++;
        }
      }
    }
  }

  let weeklyFollowupsSent = 0;
  if (followupsContent) {
    const fups = parseFollowups(followupsContent);
    weeklyFollowupsSent = fups.filter((f) => f.date && f.date >= weekWindow.from && f.date <= weekWindow.to).length;
  }

  let weeklyInterviewsHeld = 0;
  if (intsContent) {
    const parsedInts = parseActiveInterviews(intsContent);
    for (const row of parsedInts) {
      const dt = findColumn(row, 'date/time') || findColumn(row, 'date');
      const statusRaw = findColumn(row, 'status');
      const statusNorm = statusRaw.toLowerCase().trim();
      const m = /\d{4}-\d{2}-\d{2}/.exec(dt);
      if (m && m[0] >= weekWindow.from && m[0] <= weekWindow.to) {
        if (['completed', 'passed', 'done'].includes(statusNorm)) {
          weeklyInterviewsHeld++;
        }
      }
    }
  }

  // 6. Pipeline Inbox Pending URLs
  let pendingPipelineCount = 0;
  if (pipelineContent) {
    const lines = pipelineContent.replace(/\r/g, '').split('\n');
    for (const line of lines) {
      if (/^\s*-\s*\[\s*\]\s+https?:\/\//i.test(line)) {
        pendingPipelineCount++;
      }
    }
  }

  // 7. Prioritized Next Actions Queue
  const nextActions = [];

  // P0: Urgent Inbound Replies (< 24h)
  for (const u of urgentFollowups) {
    nextActions.push({
      priority: 'P0',
      type: 'urgent_reply',
      title: `Reply to ${u.company}${u.role ? ` (${u.role})` : ''} — urgent response needed`,
      detail: `Company responded; contact: ${contactLabel(u.contacts?.[0])}`,
      ref: `#${u.num}`,
    });
  }

  // P1: Overdue Follow-ups
  for (const o of overdueFollowups) {
    const touchDetail = o.followupCount === 0
      ? `${o.daysSinceApplication}d since submission (0 follow-ups logged)`
      : `${o.daysSinceLastFollowup}d since last touch (${o.followupCount} sent)`;
    nextActions.push({
      priority: 'P1',
      type: 'followup_due',
      title: `Follow up with ${o.company}${o.role ? ` (${o.role})` : ''}`,
      detail: `${touchDetail}; contact: ${contactLabel(o.contacts?.[0])}`,
      ref: `#${o.num}`,
    });
  }

  // P2: Upcoming Interview Rounds
  for (const int of upcomingInterviews) {
    nextActions.push({
      priority: 'P2',
      type: 'interview_prep',
      title: `Prepare for ${int.company} ${int.round || 'interview'} (${int.dateTime || int.date})`,
      detail: `Role: ${int.role || '—'}${int.interviewer ? ` · with ${int.interviewer}` : ''}`,
      ref: int.company,
    });
  }

  // P3: Stale Pipeline Hygiene
  if (staleCandidates.length > 0) {
    const sample = staleCandidates.slice(0, 2).map((c) => `${c.company} (${c.ageDays}d)`).join(', ');
    nextActions.push({
      priority: 'P3',
      type: 'close_stale',
      title: `Review ${staleCandidates.length} silent application${staleCandidates.length === 1 ? '' : 's'} older than ${days}d`,
      detail: `Candidates for closing: ${sample}. Run: node close-stale.mjs --summary`,
      ref: 'close-stale',
    });
  }

  // P4: Inbox Triage
  if (pendingPipelineCount > 0) {
    nextActions.push({
      priority: 'P4',
      type: 'triage_inbox',
      title: `Evaluate ${pendingPipelineCount} pending job URL${pendingPipelineCount === 1 ? '' : 's'} in inbox`,
      detail: 'Inbox: data/pipeline.md. Run: /career-ops pipeline',
      ref: 'pipeline',
    });
  }

  return {
    metadata: {
      generatedAt: today,
      weekWindow,
      sources: {
        tracker: !!appsContent,
        followups: !!followupsContent,
        activeInterviews: !!intsContent,
        statusLog: !!statusLogContent,
        pipeline: !!pipelineContent,
      },
      paths: paths || undefined,
    },
    tracker,
    followups,
    stale: appsContent ? {
      days,
      appliedCount: staleAppliedCount,
      candidateCount: staleCandidates.length,
      candidates: staleCandidates.map((c) => ({
        num: c.num,
        company: c.company,
        role: c.role,
        referenceDate: c.referenceDate,
        ageDays: c.ageDays,
      })),
    } : null,
    interviews: intsContent ? {
      upcomingCount: upcomingInterviews.length,
      activeCount: activeInterviews.length,
      upcoming: upcomingInterviews,
      active: activeInterviews,
    } : null,
    weeklyActivity: (statusLogContent || appsContent || followupsContent || intsContent) ? {
      window: weekWindow,
      applied: weeklyApplied,
      responses: weeklyResponses,
      interviews: weeklyInterviewsHeld,
      followupsSent: weeklyFollowupsSent,
      rejections: weeklyRejections,
    } : null,
    pipelineInbox: pipelineContent ? {
      pendingUrls: pendingPipelineCount,
    } : null,
    nextActions,
  };
}

/**
 * Format overview object as human-readable terminal output.
 */
export function formatSummary(overview) {
  const line = '━'.repeat(50);
  const out = [];

  out.push(`\n${line}`);
  out.push(`Job Search Overview — ${overview.metadata.generatedAt}`);
  out.push(line);

  // 1. Pipeline
  const t = overview.tracker;
  if (t) {
    const liveInfo = t.activeAppsCold > 0 ? ` (${t.activeAppsLive} live, ${t.activeAppsCold} cold)` : '';
    const fitInfo = t.avgScore != null ? ` | avg fit ${t.avgScore}/5` : '';
    out.push(`Pipeline:   ${t.total} total | ${t.activeApps} active${liveInfo}${fitInfo}`);

    const statusCounts = Object.entries(t.byStatus || {})
      .filter(([, count]) => count > 0)
      .map(([s, count]) => `${s} ${count}`)
      .join(' · ');
    if (statusCounts) out.push(`Status:     ${statusCounts}`);
  } else {
    out.push('Pipeline:   — no data (data/applications.md missing)');
  }

  // 2. Follow-ups
  const fu = overview.followups;
  if (!fu || !fu.enabled) {
    if (fu && !fu.enabled) {
      out.push('Follow-ups: turned off (follow_ups.enabled: false in config/profile.yml)');
    } else {
      out.push('Follow-ups: — no data (data/follow-ups.md missing)');
    }
  } else {
    const counts = fu.counts;
    const alertParts = [];
    if (counts.urgent > 0) alertParts.push(`🚨 ${counts.urgent} urgent`);
    if (counts.overdue > 0) alertParts.push(`⏰ ${counts.overdue} overdue`);
    alertParts.push(`${counts.waiting} waiting`);
    if (counts.cold > 0) alertParts.push(`${counts.cold} cold`);
    out.push(`Follow-ups: ${alertParts.join(' · ')}`);

    for (const u of fu.urgent.slice(0, 3)) {
      out.push(`  [URGENT]  ${u.company} — ${u.role || '—'} (contact: ${u.contact})`);
    }
    for (const o of fu.overdue.slice(0, 3)) {
      const days = o.daysSinceLastFollowup != null ? `${o.daysSinceLastFollowup}d since touch` : `${o.daysSinceApplication}d since app`;
      out.push(`  [OVERDUE] ${o.company} — ${o.role || '—'} (${days}, contact: ${o.contact})`);
    }
  }

  // 3. Interviews
  const ints = overview.interviews;
  if (!ints) {
    out.push('Interviews: — no data (data/active-interviews.md missing)');
  } else if (ints.upcomingCount > 0 || ints.activeCount > 0) {
    out.push(`Interviews: ${ints.upcomingCount} upcoming · ${ints.activeCount} in progress`);
    for (const u of ints.upcoming.slice(0, 3)) {
      out.push(`  📅 ${u.date || u.dateTime} · ${u.company} — ${u.round || 'Round'}${u.interviewer ? ` (with ${u.interviewer})` : ''}`);
    }
  } else {
    out.push('Interviews: 0 upcoming · 0 active rounds');
  }

  // 4. Stale Applications
  const st = overview.stale;
  if (!st) {
    out.push('Stale Apps: — no data (data/applications.md missing)');
  } else if (st.candidateCount > 0) {
    out.push(`Stale Apps: ${st.candidateCount} silent application${st.candidateCount === 1 ? '' : 's'} older than ${st.days}d`);
    for (const c of st.candidates.slice(0, 2)) {
      out.push(`  #${c.num} ${c.company} — ${c.role || '—'} (${c.ageDays}d silent)`);
    }
  } else {
    out.push('Stale Apps: 0 silent applications eligible for closing');
  }

  // 5. Weekly Activity
  const w = overview.weeklyActivity;
  if (!w) {
    out.push(`This Week:  — no data (activity log missing) (${overview.metadata.weekWindow.from} → ${overview.metadata.weekWindow.to})`);
  } else {
    out.push(`This Week:  ${w.applied} applied · ${w.responses} responses · ${w.followupsSent} follow-ups · ${w.interviews} interviews (${w.window.from} → ${w.window.to})`);
  }

  // 6. Pipeline Inbox
  const p = overview.pipelineInbox;
  if (p && p.pendingUrls > 0) {
    out.push(`Inbox:      ${p.pendingUrls} pending URL${p.pendingUrls === 1 ? '' : 's'} in data/pipeline.md`);
  }

  // 7. Prioritized Next Actions
  out.push('\nPrioritized Next Actions:');
  const hasAnyData = Object.values(overview.metadata.sources || {}).some(Boolean);
  if (!hasAnyData) {
    out.push('  — No data available (data/applications.md missing).');
  } else if (overview.nextActions.length === 0) {
    out.push('  ✓ All caught up! No urgent follow-ups, pending interviews, or stale items.');
  } else {
    for (let i = 0; i < overview.nextActions.length; i++) {
      const act = overview.nextActions[i];
      out.push(`  ${i + 1}. [${act.priority}] ${act.title}`);
      if (act.detail) {
        out.push(`     ${act.detail}`);
      }
    }
  }
  out.push(`${line}\n`);

  return out.join('\n');
}

// ── Assembler for disk execution ────────────────────────────────────

/**
 * Resolves all input file paths using repository conventions, environment
 * variables (CAREER_OPS_ROOT, CAREER_OPS_TRACKER, CAREER_OPS_FOLLOWUPS, etc.),
 * and legacy root fallbacks.
 */
export function resolveOverviewPaths(options = {}) {
  const dataRoot = options.dataRoot || getCareerOpsRoot();
  const appsFile = options.appsFile || options.trackerPath || resolveTrackerPath(dataRoot);
  const trackerDir = dirname(appsFile);

  const followupsOverride = options.followupsFile || process.env.CAREER_OPS_FOLLOWUPS?.trim();
  const followupsFile = followupsOverride
    ? resolve(followupsOverride)
    : (existsSync(join(dataRoot, 'data', 'follow-ups.md'))
      ? join(dataRoot, 'data', 'follow-ups.md')
      : existsSync(join(trackerDir, 'follow-ups.md'))
        ? join(trackerDir, 'follow-ups.md')
        : existsSync(join(dataRoot, 'follow-ups.md'))
          ? join(dataRoot, 'follow-ups.md')
          : join(dataRoot, 'data', 'follow-ups.md'));

  const interviewsOverride = options.activeInterviewsFile || options.intsFile || process.env.CAREER_OPS_INTERVIEWS?.trim();
  const activeInterviewsFile = interviewsOverride
    ? resolve(interviewsOverride)
    : (existsSync(join(dataRoot, 'data', 'active-interviews.md'))
      ? join(dataRoot, 'data', 'active-interviews.md')
      : existsSync(join(trackerDir, 'active-interviews.md'))
        ? join(trackerDir, 'active-interviews.md')
        : existsSync(join(dataRoot, 'active-interviews.md'))
          ? join(dataRoot, 'active-interviews.md')
          : join(dataRoot, 'data', 'active-interviews.md'));

  const statusLogOverride = options.statusLogFile || process.env.CAREER_OPS_STATUS_LOG?.trim();
  const statusLogFile = statusLogOverride
    ? resolve(statusLogOverride)
    : join(trackerDir, 'status-log.tsv');

  const pipelineOverride = options.pipelineFile || process.env.CAREER_OPS_PIPELINE?.trim();
  const pipelineFile = pipelineOverride
    ? resolve(pipelineOverride)
    : (existsSync(join(dataRoot, 'data', 'pipeline.md'))
      ? join(dataRoot, 'data', 'pipeline.md')
      : existsSync(join(trackerDir, 'pipeline.md'))
        ? join(trackerDir, 'pipeline.md')
        : existsSync(join(dataRoot, 'pipeline.md'))
          ? join(dataRoot, 'pipeline.md')
          : join(dataRoot, 'data', 'pipeline.md'));

  const profileFile = options.profileFile
    || (options.dataRoot ? getProfilePath(options.dataRoot) : getProfilePath());

  return {
    dataRoot,
    appsFile,
    followupsFile,
    activeInterviewsFile,
    statusLogFile,
    pipelineFile,
    profileFile,
  };
}

export function runOverviewFromDisk(options = {}) {
  const paths = resolveOverviewPaths(options);
  const {
    dataRoot,
    appsFile,
    followupsFile,
    activeInterviewsFile,
    statusLogFile,
    pipelineFile,
    profileFile,
  } = paths;

  const read = (f) => (f && existsSync(f) ? readFileSync(f, 'utf-8') : null);

  const appsContent = read(appsFile);
  const followupsContent = read(followupsFile);
  const intsContent = read(activeInterviewsFile);
  const statusLogContent = read(statusLogFile);
  const pipelineContent = read(pipelineFile);
  const followupsEnabled = loadFollowupsEnabled(profileFile);

  return computeOverview({
    appsContent,
    followupsContent,
    intsContent,
    statusLogContent,
    pipelineContent,
    today: options.today || localToday(),
    days: options.days || DEFAULT_DAYS,
    followupsEnabled,
    paths: {
      dataRoot,
      tracker: appsFile,
      followups: followupsFile,
      activeInterviews: activeInterviewsFile,
      statusLog: statusLogFile,
      pipeline: pipelineFile,
      profile: profileFile,
    },
  });
}

// ── CLI Execution ───────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS });

  const summaryMode = hasFlag(args, '--summary');
  const todayFlag = flagValue(args, '--today');
  const daysRaw = flagValue(args, '--days');
  const days = daysRaw && /^\d+$/.test(daysRaw) ? parseInt(daysRaw, 10) : DEFAULT_DAYS;

  const result = runOverviewFromDisk({
    today: todayFlag,
    days,
  });

  if (summaryMode) {
    console.log(formatSummary(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
