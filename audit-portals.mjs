#!/usr/bin/env node

/**
 * audit-portals.mjs — content audit for portals.yml.
 *
 * WHY THIS IS NOT verify-portals.mjs. That script asks "does this endpoint
 * answer with postings?" and is the right gate for a broken slug. It cannot ask
 * the question that actually costs coverage: *whose* postings are these?
 *
 * Two failures found on 2026-08-26 that verify-portals reported as healthy:
 *
 *   - `Booking Holdings` pointed at the Workday board of the PARENT company —
 *     21 finance/legal roles in Norwalk. It answered 200 with postings, so it
 *     passed. Booking.com's own board (145 product/engineering roles, a
 *     different ATS entirely) was never scanned at all.
 *   - Twelve entries carried `enabled: true` with a `careers_url` no provider
 *     claims. `scan.mjs` skips those silently on every run, so they read as
 *     coverage while contributing nothing. Talkdesk was one: its real board is
 *     Greenhouse `talkdesk2`, 48 roles, one character off the slug nobody had.
 *
 * So this script fetches each enabled board through the SAME providers/ modules
 * the scanner uses and reports the evidence — provider, posting count, and
 * sample titles/locations — next to a verdict:
 *
 *   ok          board answers with a healthy number of postings
 *   small       answers, but under --small-threshold (default 5). Not an error:
 *               a quiet board and a wrong board look identical from here, which
 *               is exactly why the samples are printed.
 *   empty       answers with zero postings
 *   no-provider entry is enabled but no provider claims it — scan.mjs skips it
 *   error       the fetch itself failed
 *
 * HONEST LIMIT: no heuristic reliably detects "right company, wrong entity".
 * A parent-company board is well-formed and full of real jobs. What this script
 * does is surface count + samples compactly enough that a human or an agent can
 * see it, and — with --baseline — flag the collapse that usually follows an ATS
 * migration. Treat `small` and a large negative drift as prompts to look, not
 * as verdicts.
 *
 * Usage:
 *   node audit-portals.mjs                       # audit every enabled company
 *   node audit-portals.mjs --summary             # one line per company
 *   node audit-portals.mjs --json                # machine-readable, for --baseline
 *   node audit-portals.mjs --company Adyen       # audit a single company
 *   node audit-portals.mjs --file <path>         # use a specific portals file
 *   node audit-portals.mjs --baseline prev.json  # flag boards that lost postings
 *   node audit-portals.mjs --small-threshold 10  # what counts as a small board
 *   node audit-portals.mjs --strict              # exit 1 on any non-ok verdict
 *   node audit-portals.mjs --help
 *
 * Network: only main() and auditCompanies() hit the network, and every call
 * goes through the injected provider layer, so the classification logic is
 * unit-testable offline. main() is guarded — importing this module runs nothing.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// Anchored to the career-ops root, not the cwd. Both paths below used to be
// bare relative strings, which silently audited nothing the moment the script
// was invoked from anywhere but the repo root — `node /path/to/audit-portals.mjs`
// from a home directory would throw on portals.yml and, worse, load zero
// providers and report every board as `no-provider`.
const ROOT = getCareerOpsRoot();
const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(ROOT, 'portals.yml');
const PROVIDERS_DIR = join(ROOT, 'providers');

/** Boards at or under this many postings are worth a second look, not an error. */
export const DEFAULT_SMALL_THRESHOLD = 5;

/**
 * A board that loses this fraction of its postings since the baseline is
 * flagged. An ATS migration usually reads as a near-total collapse (the old
 * board keeps answering, empty), not a gentle decline, so this is set well
 * above normal hiring churn to keep the signal quiet.
 */
export const DEFAULT_DRIFT_FRACTION = 0.5;

/** How many postings to keep as evidence per board. Enough to recognise a company. */
const SAMPLE_SIZE = 3;

/**
 * Only page 1 per board. This is an audit, not a scan: one page is enough to
 * answer "is anything here, and does it look like this company", and a full
 * sweep of 170 enterprise boards would be both slow and rude.
 */
const AUDIT_MAX_PAGES = 1;

export const VERDICTS = ['no-provider', 'error', 'empty', 'small', 'ok'];

/**
 * Classify one board's fetch result.
 *
 * Pure — no network, no clock. `jobs` is whatever the provider returned;
 * `error` is set instead when the fetch threw.
 *
 * @param {{jobs?: Array<object>, error?: string, provider?: string|null}} result
 * @param {{smallThreshold?: number}} [opts]
 * @returns {{verdict: string, count: number|null, detail: string}}
 */
export function classifyBoard(result, { smallThreshold = DEFAULT_SMALL_THRESHOLD } = {}) {
  if (!result || typeof result !== 'object') {
    return { verdict: 'error', count: null, detail: 'no result' };
  }
  if (!result.provider) {
    return {
      verdict: 'no-provider',
      count: null,
      // Two different defects wear this verdict, and the distinction decides how
      // urgent it is. Without a scan_method the entry vanishes into scan.mjs's
      // "N skipped — no provider matched" counter and nothing names it. With
      // `scan_method: websearch` it is at least announced in the agent-handoff
      // list — deliberate, but it costs agent tokens and returns nothing
      // zero-token, so it is still worth a board if one exists.
      detail: result.scanMethod
        ? `no provider claims this entry — scan.mjs hands it to the agent (scan_method: ${result.scanMethod})`
        : 'no provider claims this entry and it declares no scan_method — scan.mjs drops it into an unnamed skip count',
    };
  }
  if (result.error) {
    return { verdict: 'error', count: null, detail: String(result.error).slice(0, 120) };
  }
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  if (jobs.length === 0) return { verdict: 'empty', count: 0, detail: 'board answers with zero postings' };
  // A threshold of 0 disables the tier rather than flagging every board: the
  // `<=` below would otherwise never fire, which is the same thing, but saying
  // so here keeps `--small-threshold 0` from reading as a bug.
  if (smallThreshold > 0 && jobs.length <= smallThreshold) {
    return { verdict: 'small', count: jobs.length, detail: `only ${jobs.length} posting(s) — confirm this is the right board` };
  }
  return { verdict: 'ok', count: jobs.length, detail: `${jobs.length} postings` };
}

/**
 * Compact evidence rows a reader can use to recognise the employer.
 *
 * @param {Array<object>} jobs
 * @param {number} [n]
 * @returns {Array<string>} "Title · Location" strings.
 */
export function sampleJobs(jobs, n = SAMPLE_SIZE) {
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, n).map((j) => {
    const title = String(j?.title || '(sin título)').replace(/\s+/g, ' ').trim().slice(0, 60);
    const loc = String(j?.location || '').replace(/\s+/g, ' ').trim().slice(0, 34);
    return loc ? `${title} · ${loc}` : title;
  });
}

/**
 * Compare a fresh audit against a previous --json run.
 *
 * Only DROPS are reported. A board that grew, appeared, or vanished from the
 * config is not a coverage regression, and reporting those would bury the one
 * signal worth acting on. A baseline count of 0 is skipped too: every recovery
 * from zero would otherwise register as an infinite gain and, more importantly,
 * a 0→0 board is already reported as `empty` on its own.
 *
 * @param {Array<object>} current - rows from auditCompanies().
 * @param {Array<object>} baseline - rows from a previous run.
 * @param {{fraction?: number}} [opts]
 * @returns {Array<{name: string, before: number, after: number, lost: number}>}
 */
export function diffAgainstBaseline(current, baseline, { fraction = DEFAULT_DRIFT_FRACTION } = {}) {
  const before = new Map();
  for (const row of Array.isArray(baseline) ? baseline : []) {
    if (row && typeof row.name === 'string' && Number.isFinite(row.count)) before.set(row.name, row.count);
  }
  const drops = [];
  for (const row of Array.isArray(current) ? current : []) {
    if (!row || typeof row.name !== 'string' || !Number.isFinite(row.count)) continue;
    const was = before.get(row.name);
    if (!Number.isFinite(was) || was <= 0) continue;
    const lost = was - row.count;
    if (lost > 0 && lost / was >= fraction) {
      drops.push({ name: row.name, before: was, after: row.count, lost });
    }
  }
  return drops.sort((a, b) => b.lost - a.lost);
}

/**
 * Audit each enabled tracked company through the scanner's own provider layer.
 *
 * `local-parser` is skipped for the same reason verify-portals skips it: an
 * audit must stay network-only and never execute a command configured in a
 * portals file it did not write.
 *
 * @param {Array<object>} companies - tracked_companies entries.
 * @param {{providers?: Map, httpCtx?: object, smallThreshold?: number, concurrency?: number}} [deps]
 * @returns {Promise<Array<object>>} One row per enabled company.
 */
export async function auditCompanies(companies, {
  providers = null,
  httpCtx = null,
  smallThreshold = DEFAULT_SMALL_THRESHOLD,
  concurrency = 6,
} = {}) {
  const list = (Array.isArray(companies) ? companies : []).filter(
    (c) => c && typeof c === 'object' && c.enabled !== false,
  );
  const rows = [];
  const queue = [...list];

  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      const name = typeof entry.name === 'string' ? entry.name : '(unnamed)';
      let resolved = null;
      if (providers && providers.size > 0) {
        resolved = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
      }
      const providerId = resolved?.provider?.id || null;

      let result = { provider: providerId, scanMethod: entry.scan_method || null };
      if (providerId) {
        try {
          const ctx = httpCtx || makeHttpCtx({ maxPages: AUDIT_MAX_PAGES });
          result.jobs = (await resolved.provider.fetch(entry, ctx)) || [];
        } catch (err) {
          result.error = err?.message || String(err);
        }
      }

      const { verdict, count, detail } = classifyBoard(result, { smallThreshold });
      rows.push({
        name,
        provider: providerId || '—',
        careers_url: typeof entry.careers_url === 'string' ? entry.careers_url : '',
        verdict,
        count,
        detail,
        samples: sampleJobs(result.jobs || []),
      });
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  rows.sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || a.name.localeCompare(b.name));
  return rows;
}

/**
 * The offline half of this audit: which enabled entries does no provider claim?
 *
 * Split out from auditCompanies() because it needs no network at all — provider
 * resolution is pure config matching — which is what makes it safe to run inside
 * verify-pipeline.mjs's health check, where 170 live board fetches would not be.
 * It is also the higher-yield half: a board that answers with the wrong
 * company's jobs still needs a human to notice, but an entry nothing claims is
 * unambiguously dead config, provable without leaving the machine.
 *
 * Three buckets, because they are three different bugs with three different
 * fixes:
 *
 *   silent          no provider, no scan_method. The real defect — scan.mjs
 *                   folds it into "N skipped" and never names it.
 *   handoff         declares `scan_method`, so scan.mjs prints it in the
 *                   agent-handoff list. Deliberate, but it costs agent tokens
 *                   and yields nothing zero-token, so it is still worth a board.
 *   unknownProvider `provider:` names an id no module exports — almost always a
 *                   typo. scan.mjs does report this one loudly, but it is dead
 *                   config until someone fixes the string.
 *
 * @param {Array<object>} entries - tracked_companies and/or boards entries.
 * @param {Map} providers - from loadProviders().
 * @returns {{silent: Array<object>, handoff: Array<object>, unknownProvider: Array<object>}}
 */
export function findUnclaimedEntries(entries, providers) {
  const silent = [];
  const handoff = [];
  const unknownProvider = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object' || entry.enabled === false) continue;
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
    // No skipIds here, unlike auditCompanies(): that one refuses to RUN a
    // configured local-parser command, but scan.mjs does claim those entries, so
    // excluding them would report a working parser as dead config. The question
    // this function answers is "would scan.mjs claim it?", so it resolves
    // exactly the way scan.mjs does.
    const resolved = providers && providers.size > 0 ? resolveProvider(entry, providers) : null;
    if (resolved?.provider) continue;
    const row = {
      name: entry.name,
      scanMethod: entry.scan_method || null,
      careers_url: typeof entry.careers_url === 'string' ? entry.careers_url : '',
      error: resolved?.error || null,
    };
    if (row.error) unknownProvider.push(row);
    else if (row.scanMethod) handoff.push(row);
    else silent.push(row);
  }
  return { silent, handoff, unknownProvider };
}

/** Read tracked_companies out of a portals file. Throws on a missing file. */
export function loadCompanies(filePath = DEFAULT_PORTALS_PATH) {
  if (!existsSync(filePath)) throw new Error(`portals file not found: ${filePath}`);
  const cfg = yaml.load(readFileSync(filePath, 'utf-8')) || {};
  return Array.isArray(cfg.tracked_companies) ? cfg.tracked_companies : [];
}

const ICON = { ok: '✅', small: '🟡', empty: '⚪', 'no-provider': '🚨', error: '❌' };

const KNOWN_FLAGS = [
  '--summary', '--json', '--strict', '--company', '--file',
  '--baseline', '--small-threshold', '--help', '-h',
];
const VALUE_FLAGS = ['--company', '--file', '--baseline', '--small-threshold'];

const USAGE = `Usage:
  node audit-portals.mjs                       # audit every enabled company
  node audit-portals.mjs --summary             # one line per company
  node audit-portals.mjs --json                # machine-readable, for --baseline
  node audit-portals.mjs --company Adyen       # audit a single company
  node audit-portals.mjs --file <path>         # use a specific portals file
  node audit-portals.mjs --baseline prev.json  # flag boards that lost postings
  node audit-portals.mjs --small-threshold 10  # what counts as a small board
  node audit-portals.mjs --strict              # exit 1 on any non-ok verdict
  node audit-portals.mjs --help                # print this usage block and exit`;

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(USAGE);
    return;
  }
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS });

  const filePath = flagValue(args, '--file') || DEFAULT_PORTALS_PATH;
  const only = flagValue(args, '--company');
  const asJson = hasFlag(args, '--json');
  const summary = hasFlag(args, '--summary');
  const strict = hasFlag(args, '--strict');

  const rawThreshold = flagValue(args, '--small-threshold');
  const smallThreshold = rawThreshold === undefined ? DEFAULT_SMALL_THRESHOLD : Number(rawThreshold);
  if (!Number.isFinite(smallThreshold) || smallThreshold < 0) {
    console.error(`Error: --small-threshold expects a non-negative number, got "${rawThreshold}"`);
    process.exit(1);
  }

  let companies = loadCompanies(filePath);
  if (only) {
    const needle = only.toLowerCase();
    companies = companies.filter((c) => String(c?.name || '').toLowerCase().includes(needle));
    if (companies.length === 0) {
      console.error(`Error: no tracked company matches "${only}" in ${filePath}`);
      process.exit(1);
    }
  }

  const providers = await loadProviders(PROVIDERS_DIR);
  const rows = await auditCompanies(companies, { providers, smallThreshold });

  let drops = [];
  const baselinePath = flagValue(args, '--baseline');
  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(`Error: baseline file not found: ${baselinePath}`);
      process.exit(1);
    }
    try {
      const prev = JSON.parse(readFileSync(baselinePath, 'utf-8'));
      drops = diffAgainstBaseline(rows, Array.isArray(prev) ? prev : prev.rows, {});
    } catch (err) {
      console.error(`Error: could not read baseline ${baselinePath}: ${err.message}`);
      process.exit(1);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(drops.length ? { rows, drops } : rows, null, 2));
  } else {
    console.log(`audit-portals: ${filePath}\n`);
    for (const r of rows) {
      if (summary) {
        console.log(`  ${ICON[r.verdict] || '·'} ${r.name} — ${r.provider} (${r.detail})`);
        continue;
      }
      if (r.verdict === 'ok') continue; // full mode reports only what needs a look
      console.log(`  ${ICON[r.verdict] || '·'} ${r.name} — ${r.provider} (${r.detail})`);
      for (const s of r.samples) console.log(`       ${s}`);
      if (r.careers_url) console.log(`       ${r.careers_url}`);
    }

    const tally = {};
    for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    const parts = VERDICTS.filter((v) => tally[v]).map((v) => `${tally[v]} ${v}`);
    console.log(`\n${rows.length} audited: ${parts.join(', ')}`);
    if (!summary && tally.ok) console.log(`(${tally.ok} healthy boards not listed — use --summary to see them)`);

    if (drops.length > 0) {
      console.log(`\n🚨 ${drops.length} board(s) lost postings since the baseline:`);
      for (const d of drops) console.log(`  ${d.name}: ${d.before} → ${d.after} (-${d.lost})`);
    }
  }

  if (strict) {
    const bad = rows.filter((r) => r.verdict !== 'ok').length;
    if (bad > 0 || drops.length > 0) {
      // Name whichever condition actually fired. A drift-only failure once
      // printed "0 board(s) need attention" right after listing the drop —
      // technically true of the verdicts, and useless to the reader.
      if (!asJson) {
        const reasons = [];
        if (bad > 0) reasons.push(`${bad} board(s) with a non-ok verdict`);
        if (drops.length > 0) reasons.push(`${drops.length} board(s) below baseline`);
        console.log(`\n🔴 ${reasons.join(' and ')} (--strict).`);
      }
      process.exit(1);
    }
  }
}

// Only run main() when invoked directly, not when imported by tests.
// isMainModule canonicalizes BOTH sides (#3170); the hand-rolled comparison
// this replaces compared a realpath-resolved import.meta.url against a raw
// argv[1], so reaching the script through a symlink skipped the CLI tail and
// exited 0 having audited nothing. tests/main-guard-convention.test.mjs enforces
// the helper — it caught this file.
if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`audit-portals failed: ${err.message}`);
    process.exit(1);
  });
}
