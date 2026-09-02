#!/usr/bin/env node
/**
 * sync-batch-input.mjs — Sync pipeline.md "Pending" entries into batch-input.tsv
 *
 * THE PROBLEM
 * Scan results land in data/pipeline.md "Pending" section, but batch processing
 * reads from batch/batch-input.tsv. There is no built-in way to feed
 * scan-discovered offers into the batch pipeline without manually copying URLs.
 * reconcile-pipeline.mjs walks batch back into the pipeline; nothing walks the
 * pipeline forward into batch. This closes that gap.
 *
 * WHAT THIS DOES
 * Reads pipeline.md "Pending" section, parses each unchecked entry, and appends
 * it to batch/batch-input.tsv in the format the batch runner expects:
 *   id<tab>url<tab>source<tab>notes
 * Each new row is assigned the next unused numeric id (source is "pipeline").
 *
 * Deduplicates against existing batch-input.tsv entries and batch-state.tsv
 * (already-processed URLs). Idempotent: safe to run repeatedly.
 * Read-only over the pipeline; the only write is appending to batch-input.tsv.
 *
 * The "Pending"/"Procesadas" section headers are parsed with the same localized
 * spellings reconcile-pipeline.mjs accepts (EN/ES, plus DE/FR) so a Spanish or
 * German install is not read as having no pending entries.
 *
 * Run: node sync-batch-input.mjs [--dry-run] [--pipeline <path>] [--input <path>] [--state <path>]
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { isIP } from 'net';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CAREER_OPS = getCareerOpsRoot();

export const SOURCE = 'pipeline';

// Same localized header spellings reconcile-pipeline.mjs recognises.
export const PENDING_RE = /^##\s+(Pendientes|Pending|Offen|En attente)\s*$/i;
const SECTION_RE = /^##\s+/;
const PENDING_ITEM_RE = /^- \[ \]\s+/;

// Extract URL from a pipeline row body (first positional cell before " |").
export function lineUrl(body) {
  const i = body.indexOf(' |');
  return (i >= 0 ? body.slice(0, i) : body).trim();
}

function parseIpv4Part(part) {
  if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
  if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
  return NaN;
}

function parseIpv4Hostname(host) {
  const parts = String(host || '').split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => part === '')) return null;
  if (!parts.every((part) => /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(part))) return null;
  const nums = parts.map(parseIpv4Part);
  if (nums.some((num) => !Number.isSafeInteger(num) || num < 0)) return null;
  const prefix = nums.slice(0, -1);
  if (prefix.some((num) => num > 255)) return null;
  const last = nums.at(-1);
  const remainingBytes = 5 - nums.length;
  if (last > 256 ** remainingBytes - 1) return null;
  if (nums.length === 1) return [(last >>> 24) & 255, (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 2) return [nums[0], (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 3) return [nums[0], nums[1], (last >>> 8) & 255, last & 255];
  return nums;
}

function ipv4FromLow32(high, lowBits) {
  if (high > 0xffff || lowBits > 0xffff) return null;
  return [(high >>> 8) & 255, high & 255, (lowBits >>> 8) & 255, lowBits & 255];
}

function parseIpv4MappedIpv6(host) {
  const normalized = String(host || '').toLowerCase();
  const dotted = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4Hostname(dotted[1]);
  const hex = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromLow32(Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16));
}

// IPv4-compatible IPv6 (::a.b.c.d or ::h1:h2), where the low 32 bits encode an
// IPv4 address. Rejects loopback/private destinations that new URL() normalizes
// into this form (e.g. http://[::127.0.0.1]/ -> [::7f00:1] -> 127.0.0.1).
function parseIpv4CompatibleIpv6(host) {
  const bounded = String(host || '').toLowerCase();
  const dotted = bounded.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4Hostname(dotted[1]);
  const hex = bounded.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromLow32(Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16));
}

function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrInternalHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === ':' || host === '::') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!host.includes('.') && isIP(host) === 0) return true;
  if (/\.(?:local|internal|lan|home|test|invalid)$/i.test(host)) return true;

  const ipv4 = parseIpv4Hostname(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  const version = isIP(host);
  if (version !== 6) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

  const mappedIpv4 = parseIpv4MappedIpv6(host);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  const compatIpv4 = parseIpv4CompatibleIpv6(host);
  if (compatIpv4) return isPrivateIpv4(compatIpv4);

  const firstHextet = host.split(':')[0];
  if (/^f[cd][0-9a-f]{0,2}$/i.test(firstHextet)) return true;
  const first = Number.parseInt(firstHextet, 16);
  return Number.isFinite(first) && first >= 0xfe80 && first <= 0xfebf;
}

export function isSafePublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  return !isPrivateOrInternalHostname(url.hostname);
}

// Extract labeled segments from a pipeline row body ("| label: value").
export function extractLabels(body) {
  const labels = {};
  const labelRe = /\|\s*(posted|trust|note|rank):\s*([^|]+)/g;
  let m;
  while ((m = labelRe.exec(body)) !== null) {
    labels[m[1]] = m[2].trim();
  }
  return labels;
}

// Extract the company (positional 2nd cell) from a pipeline row body.
export function lineCompany(body) {
  const parts = body.split('|').map((s) => s.trim());
  return parts.length > 1 ? parts[1] || '' : '';
}

// Build the batch `notes` field from labeled segments.
export function buildNotes(labels) {
  return Object.entries(labels).map(([k, v]) => `${k}: ${v}`).join(' | ');
}

/**
 * Parse pending entries out of raw pipeline.md text (mirrors reconcile-pipeline.mjs).
 * @param {string} text - Raw pipeline.md contents.
 * @returns {Array<{url:string, company:string, notes:string}>}
 */
export function parsePending(text) {
  const lines = text.split(/\r?\n/);
  let pendStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (PENDING_RE.test(lines[i])) { pendStart = i; break; }
  }
  if (pendStart < 0) return [];

  let pendEnd = lines.length;
  for (let i = pendStart + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) { pendEnd = i; break; }
  }

  const out = [];
  for (let i = pendStart + 1; i < pendEnd; i++) {
    if (!PENDING_ITEM_RE.test(lines[i])) continue;
    const body = lines[i].replace(PENDING_ITEM_RE, '');
    const url = lineUrl(body);
    if (!isSafePublicHttpUrl(url)) continue;
    out.push({ url, company: lineCompany(body), notes: buildNotes(extractLabels(body)) });
  }
  return out;
}

/**
 * Collect URLs already in an existing TSV (batch-input.tsv or batch-state.tsv).
 * Handles the header/# comments and whitespace-only rows.
 * @param {string} [text] - Raw TSV contents.
 * @param {number} urlCol - Column index (0-based) holding the URL.
 * @returns {Set<string>}
 */
export function urlsFromTsv(text, urlCol) {
  const set = new Set();
  if (!text) return set;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('id\t')) continue;
    const url = line.split('\t')[urlCol];
    if (url) set.add(url.trim());
  }
  return set;
}

function tsvCell(value) {
  return String(value || '').replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * Find the largest numeric id in a TSV's first column (id<tab>url<tab>...).
 * Ignores the header row, # comments, and blanks. 0 if none found.
 * @param {string} [text] - Raw TSV contents.
 * @returns {number}
 */
export function maxTsvId(text) {
  let max = 0;
  if (!text) return max;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('id\t')) continue;
    const [field] = line.split('\t');
    const n = Number(field);
    if (Number.isInteger(n) && n > 0 && n > max) max = n;
  }
  return max;
}

/**
 * Build the final batch-input.tsv rows for the pending entries not already queued
 * or processed. Each row is id<tab>url<tab>source<tab>notes with a numeric id
 * allocated sequentially starting at `startId`.
 * @param {Array<{url:string, company:string, notes:string}>} pending
 * @param {Set<string>} existingUrls
 * @param {number} [startId] - First id to allocate (default 1).
 * @returns {Array<{url:string, notes:string, id:number, row:string}>}
 */
export function planBatchRows(pending, existingUrls, startId = 1) {
  const rows = [];
  const accepted = new Set();
  let nextId = startId;
  for (const e of pending) {
    if (existingUrls.has(e.url) || accepted.has(e.url)) continue;
    accepted.add(e.url);
    const notes = tsvCell(e.notes);
    rows.push({ ...e, notes, id: nextId, row: `${nextId}\t${e.url}\t${SOURCE}\t${notes}` });
    nextId++;
  }
  return rows;
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  const DRY_RUN = process.argv.includes('--dry-run');

  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log('Usage: node sync-batch-input.mjs [--dry-run] [--pipeline <path>] [--input <path>] [--state <path>]');
    console.log('  Syncs pipeline.md "Pending" entries into batch/batch-input.tsv.');
    process.exit(0);
  }

  function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
  }

  function resolveInsideRepo(inputPath, fallbackPath, flag) {
    const abs = resolve(inputPath || fallbackPath);
    const rel = relative(CAREER_OPS, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      console.error(`Invalid ${flag}: path must stay inside the career-ops root (${abs})`);
      process.exit(1);
    }
    return abs;
  }

  const defaultPipeline = existsSync(join(CAREER_OPS, 'data/pipeline.md'))
    ? join(CAREER_OPS, 'data/pipeline.md')
    : join(CAREER_OPS, 'pipeline.md');
  const PIPELINE_FILE = resolveInsideRepo(argValue('--pipeline'), defaultPipeline, '--pipeline');
  const INPUT_FILE = resolveInsideRepo(argValue('--input'), join(CAREER_OPS, 'batch/batch-input.tsv'), '--input');
  const STATE_FILE = resolveInsideRepo(argValue('--state'), join(CAREER_OPS, 'batch/batch-state.tsv'), '--state');

  if (!existsSync(PIPELINE_FILE)) {
    console.log('No pipeline.md found — nothing to sync.');
    process.exit(0);
  }

  const pending = parsePending(readFileSync(PIPELINE_FILE, 'utf-8'));
  if (pending.length === 0) {
    console.log('No valid pending entries found — nothing to sync.');
    process.exit(0);
  }

  const existingUrls = new Set();
  let startId = 1;
  if (existsSync(INPUT_FILE)) {
    const inputText = readFileSync(INPUT_FILE, 'utf-8');
    for (const u of urlsFromTsv(inputText, 1)) existingUrls.add(u);
    startId = Math.max(startId, maxTsvId(inputText) + 1);
  }
  if (existsSync(STATE_FILE)) {
    const stateText = readFileSync(STATE_FILE, 'utf-8');
    for (const u of urlsFromTsv(stateText, 1)) existingUrls.add(u);
    startId = Math.max(startId, maxTsvId(stateText) + 1);
  }

  const newRows = planBatchRows(pending, existingUrls, startId);
  if (newRows.length === 0) {
    console.log(`All ${pending.length} pending entries already in batch-input.tsv or batch-state.tsv — nothing to sync.`);
    process.exit(0);
  }

  console.log('=== Sync pipeline.md -> batch-input.tsv ===');
  console.log(`📋 Pipeline pending: ${pending.length} entries`);
  console.log(`⏭️  Already queued/processed: ${pending.length - newRows.length}`);
  console.log(`➕ New entries to add: ${newRows.length}`);
  for (const e of newRows) {
    const label = e.company ? ` (${e.company})` : '';
    console.log(`   ${e.url}${label}`);
  }

  if (DRY_RUN) {
    console.log('(dry-run — no changes written)');
    process.exit(0);
  }

  if (!existsSync(INPUT_FILE)) {
    mkdirSync(dirname(INPUT_FILE), { recursive: true });
    writeFileSync(INPUT_FILE, `# batch-input.tsv — generated by sync-batch-input.mjs\n# id<tab>url<tab>source<tab>notes\n`);
  }

  appendFileSync(INPUT_FILE, newRows.map((e) => e.row).join('\n') + '\n');

  console.log(`✅ ${newRows.length} entries appended to batch/batch-input.tsv`);
  console.log('   Run `npm run batch` to evaluate them.');
}
