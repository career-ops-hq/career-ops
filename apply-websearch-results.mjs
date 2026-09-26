#!/usr/bin/env node

/**
 * apply-websearch-results.mjs — mechanically applies the structured output of
 * a headless `claude -p` WebSearch+Playwright discovery run (see
 * websearch-scan-prompt.md / websearch-scan-run.ps1) to the tracked files.
 *
 * That headless run has NO write tools (by design — an unattended agent
 * reading untrusted web content should never write/commit on its own). It
 * only prints two fenced blocks of structured lines:
 *
 *   NEW_OFFER | url=... | company=... | title=... | location=... | portal=... | posted_at=...
 *   SKIPPED   | url=... | company=... | title=... | status=... | location=...
 *
 * This script is plain deterministic code (no AI, no permission gating) that
 * parses that output and does the actual writes: data/pipeline.md,
 * data/scan-history.tsv (via scan.mjs's own writers, for format consistency),
 * and output/job-link.md (prepended, matching the existing convention), then
 * commits and pushes.
 *
 * Usage: node apply-websearch-results.mjs <results-file>
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  appendToPipeline,
  appendToScanHistory,
  loadSeenUrls,
  normalizeUrlForDedup,
  sanitizeMarkdownField,
} from './scan.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CODE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const JOB_LINK_PATH = path.join(DATA_ROOT, 'output/job-link.md');

// PowerShell's `*>`/`>` redirection writes UTF-16LE (with BOM) on Windows
// PowerShell 5.1, regardless of the console's actual codepage. Reading that
// blindly as UTF-8 doesn't error -- it silently decodes each ASCII byte as
// its own character with interleaved NUL bytes, so `line.startsWith(...)`
// checks below always fail and every NEW_OFFER/SKIPPED line is dropped with
// no error (this happened on every run from 2026-09-17 night through
// 2026-09-19 morning before this fix). Detect the encoding from the BOM
// instead of assuming one.
function readTextFileAnyEncoding(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf-8');
  }
  return buf.toString('utf-8');
}

function parseLine(line) {
  const parts = line.split('|').map((p) => p.trim());
  const marker = parts[0];
  const fields = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    fields[key] = value;
  }
  return { marker, fields };
}

function parseResults(text) {
  const newOffers = [];
  const skipped = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('NEW_OFFER_COUNT:')) continue; // zero-offers sentinel, nothing to parse
    if (line.startsWith('NEW_OFFER')) {
      const { fields } = parseLine(line);
      if (fields.url && fields.company && fields.title) newOffers.push(fields);
    } else if (line.startsWith('SKIPPED')) {
      const { fields } = parseLine(line);
      if (fields.url && fields.status) skipped.push(fields);
    }
  }
  return { newOffers, skipped };
}

function toOfferObject(fields) {
  const postedAtMs = fields.posted_at ? Date.parse(fields.posted_at) : NaN;
  return {
    url: fields.url,
    company: fields.company,
    title: fields.title,
    location: fields.location || '',
    source: fields.portal || 'WebSearch',
    postedAt: Number.isFinite(postedAtMs) ? postedAtMs : undefined,
  };
}

function isRemoteLocation(location) {
  if (!location) return true;
  return /remote/i.test(location) && !/,\s*[A-Z]{2}\b/.test(location);
}

function formatEasternTimestamp(date = new Date()) {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return { dateStr, timeStr };
}

function buildJobLinkSection(offers, dateStr, timeStr) {
  const n = offers.length;
  if (n === 0) {
    return `## ${dateStr} ${timeStr} ET (WebSearch scan)\n\n_(no new offers this run)_\n\n---\n\n`;
  }
  const header = `## ${dateStr} ${timeStr} ET (WebSearch scan) — ${n} new offer${n === 1 ? '' : 's'}`;
  const remote = offers.filter((o) => isRemoteLocation(o.location));
  const located = offers.filter((o) => !isRemoteLocation(o.location));

  const lines = [header, ''];
  const renderItem = (o, withLocation) => {
    const company = sanitizeMarkdownField(o.company);
    const title = sanitizeMarkdownField(o.title);
    const suffix = withLocation && o.location ? ` _(${sanitizeMarkdownField(o.location)})_` : '';
    return `- [${company} — ${title}](${o.url})${suffix}`;
  };
  if (remote.length) {
    lines.push('**Remote (US):**');
    for (const o of remote) lines.push(renderItem(o, false));
    lines.push('');
  }
  if (located.length) {
    lines.push('**Location-based (US):**');
    for (const o of located) lines.push(renderItem(o, true));
    lines.push('');
  }
  lines.push('---');
  return lines.join('\n') + '\n\n';
}

function prependJobLink(section) {
  const existing = existsSync(JOB_LINK_PATH) ? readFileSync(JOB_LINK_PATH, 'utf-8') : '';
  return section + existing;
}

function git(args) {
  return execFileSync('git', args, { cwd: DATA_ROOT, encoding: 'utf-8' });
}

async function main() {
  const resultsPath = process.argv[2];
  if (!resultsPath) {
    console.error('Usage: node apply-websearch-results.mjs <results-file>');
    process.exit(1);
  }
  if (!existsSync(resultsPath)) {
    console.error(`Results file not found: ${resultsPath}`);
    process.exit(1);
  }

  // Sync with origin first, so dedup runs against the latest data and the
  // local working copy is never stale after this script finishes -- also
  // avoids the push-rejection conflict this repo hit before this safeguard
  // existed (two writers appending to the same files without pulling first).
  try {
    git(['pull', '--rebase', '--autostash']);
  } catch (err) {
    console.error('git pull --rebase failed -- leaving repo untouched for manual resolution:');
    console.error(err.stderr || err.message);
    process.exit(1);
  }

  const text = readTextFileAnyEncoding(resultsPath);
  const { newOffers: rawNew, skipped: rawSkipped } = parseResults(text);

  // Defensive dedup against scan-history.tsv/pipeline.md/applications.md, in
  // case this results file is re-processed or overlaps with what scan.mjs /
  // another run already recorded.
  const { seen } = loadSeenUrls();
  const newOffers = rawNew
    .map(toOfferObject)
    .filter((o) => !seen.has(normalizeUrlForDedup(o.url)));

  const today = new Date().toISOString().slice(0, 10);

  if (newOffers.length > 0) {
    await appendToPipeline(newOffers);
    await appendToScanHistory(newOffers, today, 'added');
  }

  // Log skips too, grouped by status, matching scan.mjs's own convention.
  const skipGroups = new Map();
  for (const s of rawSkipped) {
    const offer = toOfferObject(s);
    if (!skipGroups.has(s.status)) skipGroups.set(s.status, []);
    skipGroups.get(s.status).push(offer);
  }
  for (const [status, group] of skipGroups) {
    await appendToScanHistory(group, today, status);
  }

  const { dateStr, timeStr } = formatEasternTimestamp();
  const section = buildJobLinkSection(newOffers, dateStr, timeStr);
  const fs = await import('fs');
  fs.writeFileSync(JOB_LINK_PATH, prependJobLink(section), 'utf-8');

  git(['add', 'data/pipeline.md', 'data/scan-history.tsv', 'output/job-link.md']);
  let hasChanges = true;
  try {
    git(['diff', '--cached', '--quiet']);
    hasChanges = false; // exit 0 means no staged changes
  } catch {
    hasChanges = true; // non-zero exit means there ARE staged changes
  }
  if (hasChanges) {
    const commitMsg = `scan: websearch ${dateStr} ${timeStr} ET - ${newOffers.length} new offer${newOffers.length === 1 ? '' : 's'}`;
    git(['commit', '-m', commitMsg]);
    try {
      git(['push']);
    } catch {
      // Race with another writer between the pull above and now -- rebase
      // once onto whatever landed and retry, rather than leaving a committed
      // but unpushed local state.
      git(['pull', '--rebase']);
      git(['push']);
    }
    console.log(`Committed and pushed: ${commitMsg}`);
  } else {
    console.log('No changes to commit.');
  }

  console.log(`New offers added: ${newOffers.length} (of ${rawNew.length} reported, ${rawNew.length - newOffers.length} deduped)`);
  console.log(`Skipped logged: ${rawSkipped.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
