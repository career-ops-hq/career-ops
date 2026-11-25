// Local, untrusted status proposals. The producer never gets a tracker writer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeTrackerPath } from '../path-resolver.mjs';

const MAX_FILE_BYTES = 64 * 1024;
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const HASH = /^[a-f0-9]{64}$/;

export function proposalReceipt(source) {
  const key = JSON.stringify([source.kind, source.account_id, source.message_id]);
  return `[reply-proposal:${createHash('sha256').update(key).digest('hex')}]`;
}

export function hasProposalReceipt(apps, receipt) {
  return apps.some(app => app.notes.split(';').some(note => note.trim() === receipt));
}

function fields(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name));
}

function text(value, max = 1000, empty = false) {
  return typeof value === 'string' && value.length <= max
    && (empty || value.trim().length > 0) && !CONTROLS.test(value);
}

// Diagnostics are also untrusted: JSON.parse errors can include bytes from a
// malformed file, and JSON.stringify alone does not escape bidi controls.
function diagnostic(value) {
  return JSON.stringify(String(value)).replace(/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function validSource(source) {
  return fields(source, ['kind', 'account_id', 'message_id'])
    && source.kind === 'gmail' && typeof source.account_id === 'string'
    && source.account_id.length === 64 && HASH.test(source.account_id) && typeof source.message_id === 'string'
    && !CONTROLS.test(source.message_id) && /^[A-Za-z0-9_-]{1,256}$/.test(source.message_id);
}

function validate(row, trackerPath, states) {
  if (!fields(row, ['schema_version', 'source', 'tracker_path', 'application', 'from_status', 'to_status', 'evidence'])
      || row.schema_version !== 1) return 'invalid schema or fields';
  if (!validSource(row.source)) return 'invalid source identity';
  if (!text(row.tracker_path, 4096) || !path.isAbsolute(row.tracker_path)
      || row.tracker_path !== canonicalizeTrackerPath(trackerPath)) return 'foreign or noncanonical tracker path';
  const app = row.application;
  if (!fields(app, ['num', 'date', 'company', 'role', 'report'])
      || !Number.isSafeInteger(app.num) || app.num <= 0
      || !text(app.date, 100, true) || !text(app.company) || !text(app.role)
      || !text(app.report, 2000, true)) return 'invalid application identity';
  if (!states.some(s => s.id === row.from_status) || !states.some(s => s.id === row.to_status)
      || row.from_status === row.to_status) return 'expected distinct canonical status ids';
  if (!text(row.evidence, 2000)) return 'invalid evidence excerpt';
  return null;
}

// Fixed field order makes semantically identical JSON deduplicate regardless of
// whitespace or producer object-key order. Source identity is deliberately NOT
// tied to the proposed transition: changing a target cannot replay accepted mail.
function payload(row) {
  const a = row.application;
  return JSON.stringify([row.tracker_path, a.num, a.date, a.company, a.role, a.report,
    row.from_status, row.to_status, row.evidence]);
}

/** Read one JSON object per file, without modifying drops or tracker data. */
export function readReplyProposals(dataRoot, trackerPath, apps, states) {
  const directory = path.join(dataRoot, 'data', 'reply-proposals');
  const warnings = [];
  const proposals = new Map();
  const blocked = new Set();
  let entries;
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('expected a regular directory');
    entries = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`Cannot read reply proposals: ${diagnostic(err.message)}`);
    return { recommendations: [], warnings };
  }

  for (const name of entries) {
    let fd;
    let row;
    try {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('expected a regular file');
      fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.size > MAX_FILE_BYTES) throw new Error('file exceeds 64 KiB or is not regular');
      // Read at most the contract limit even if a producer writes concurrently.
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > MAX_FILE_BYTES) throw new Error('file exceeds 64 KiB');
      row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)));
      const error = validate(row, trackerPath, states);
      if (error) throw new Error(error);
      const receipt = proposalReceipt(row.source);
      const previous = proposals.get(receipt);
      if (previous && payload(previous) !== payload(row)) {
        blocked.add(receipt);
        throw new Error('conflicting payloads for the same source identity');
      }
      proposals.set(receipt, row);
    } catch (err) {
      // An invalid duplicate must not leave its valid sibling actionable.
      if (validSource(row?.source)) blocked.add(proposalReceipt(row.source));
      warnings.push(`Skipped proposal ${diagnostic(name)}: ${diagnostic(err.message)}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  const recommendations = [];
  for (const [receipt, proposal] of proposals) {
    if (blocked.has(receipt) || hasProposalReceipt(apps, receipt)) continue;
    const matches = apps.filter(app => app.num === proposal.application.num);
    const app = matches[0];
    const from = states.find(s => s.id === proposal.from_status).label;
    const to = states.find(s => s.id === proposal.to_status).label;
    let reason;
    if (matches.length !== 1) reason = 'missing or ambiguous tracker row';
    else if (!Object.entries(proposal.application).every(([key, value]) => app[key] === value)) reason = 'application identity changed';
    else if (app.status === to) continue;
    else if (app.status !== from) reason = 'stale from-status';
    if (reason) {
      warnings.push(`Skipped proposal for #${proposal.application.num}: ${reason}`);
      continue;
    }
    recommendations.push({
      num: app.num, company: app.company, role: app.role,
      oldStatus: from, newStatus: to, snapshot: app,
      proposals: [{ receipt, evidence: proposal.evidence, source: proposal.source }],
    });
  }
  return { recommendations, warnings };
}
