#!/usr/bin/env node

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openTrackerTransaction, rebuildRow, cell } from './tracker-utils.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TRACKER = join(ROOT, 'data', 'applications.md');
const PORT = Number(process.env.CAREER_DASHBOARD_PORT || 4173);
const HOST = process.env.CAREER_DASHBOARD_HOST || '127.0.0.1';
const MAX_BODY = 64 * 1024;
let scanState = { running: false, startedAt: null, finishedAt: null, exitCode: null, error: null, output: '' };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
};

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('Request is too large');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
}

function clean(value, max = 500) {
  return String(value ?? '').replace(/[|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function latestScanRun() {
  const path = join(ROOT, 'data', 'scan-runs.tsv');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split('\t');
  const values = lines.at(-1).split('\t');
  return Object.fromEntries(headers.map((header, index) => {
    const value = values[index] ?? '';
    return [header, /^\d+$/.test(value) ? Number(value) : value];
  }));
}

function pendingJobs() {
  const path = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').flatMap(line => {
    const match = line.match(/^\s*-\s*\[\s\]\s+(\S+)\s*\|\s*([^|]+)\|\s*(.+?)\s*$/);
    return match ? [{ url: match[1], company: match[2].trim(), title: match[3].trim() }] : [];
  });
}

function scanSnapshot() {
  return { ...scanState, latest: latestScanRun(), pending: pendingJobs() };
}

function startScan() {
  if (scanState.running) return false;
  scanState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, error: null, output: '' };
  const child = spawn(process.execPath, ['scan.mjs', '--quiet'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = chunk => { scanState.output = (scanState.output + chunk.toString()).slice(-20000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => {
    scanState = { ...scanState, running: false, finishedAt: new Date().toISOString(), exitCode: -1, error: error.message };
  });
  child.on('close', code => {
    scanState = { ...scanState, running: false, finishedAt: new Date().toISOString(), exitCode: code, error: code === 0 ? null : 'Scanner exited with an error' };
  });
  return true;
}

async function setStatus(id, status) {
  const result = await execFileAsync(process.execPath, [
    'set-status.mjs', '--row', String(id), clean(status, 80), '--source', 'web', '--json',
  ], { cwd: ROOT });
  const parsed = JSON.parse(result.stdout.trim() || '{}');
  if (parsed.changed) {
    const activityPath = join(ROOT, 'data', 'dashboard-activity.tsv');
    if (!existsSync(activityPath)) appendFileSync(activityPath, 'timestamp\tapplication_id\taction\tvalue\n');
    appendFileSync(activityPath, `${new Date().toISOString()}\t${clean(id, 20)}\tstatus\t${clean(parsed.newStatus || status, 80)}\n`);
    if (String(parsed.newStatus || status).toLowerCase() === 'applied') {
      await execFileAsync(process.execPath, ['followup-seed.mjs', String(id), '--date', new Date().toISOString().slice(0, 10), '--json'], { cwd: ROOT });
    }
  }
  return parsed;
}

async function applicationActivity() {
  const trackerText = readFileSync(TRACKER, 'utf8');
  const trackerLines = trackerText.split('\n');
  const cols = resolveColumns(trackerLines);
  const tracker = trackerLines.map(line => parseTrackerRow(line, cols)).filter(Boolean);
  const cadenceResult = await execFileAsync(process.execPath, ['followup-cadence.mjs'], { cwd: ROOT });
  const cadence = JSON.parse(cadenceResult.stdout);
  const cadenceById = new Map((cadence.entries || []).map(entry => [Number(entry.num), entry]));
  const appliedDates = new Map();
  const statusPath = join(ROOT, 'data', 'status-log.tsv');
  if (existsSync(statusPath)) {
    for (const line of readFileSync(statusPath, 'utf8').split('\n')) {
      const [id, date, , to] = line.split('\t');
      if (/^\d+$/.test(id) && String(to).toLowerCase() === 'applied' && /^\d{4}-\d{2}-\d{2}$/.test(date)) appliedDates.set(Number(id), date);
    }
  }
  const appliedTimes = new Map();
  const activityPath = join(ROOT, 'data', 'dashboard-activity.tsv');
  if (existsSync(activityPath)) {
    for (const line of readFileSync(activityPath, 'utf8').split('\n').slice(1)) {
      const [timestamp, id, action, value] = line.split('\t');
      if (action === 'status' && String(value).toLowerCase() === 'applied') appliedTimes.set(Number(id), timestamp);
    }
  }
  const advanced = new Set(['applied', 'responded', 'interview', 'offer', 'hired']);
  const rows = tracker.filter(row => appliedDates.has(row.num) || advanced.has(String(row.status).toLowerCase())).map(row => {
    const followup = cadenceById.get(row.num);
    return {
      id: row.num, company: row.company, role: row.role, status: row.status,
      appliedDate: appliedDates.get(row.num) || followup?.appliedDate || row.date,
      appliedTime: appliedTimes.get(row.num) || null,
      appliedDateSource: appliedDates.has(row.num) ? 'status-log' : (followup?.appDateSource || 'tracker'),
      nextFollowupDate: followup?.nextFollowupDate || null,
      lastFollowupDate: followup?.followups?.[0]?.date || null,
      followupCount: followup?.followupCount || 0,
      urgency: followup?.urgency || null,
    };
  });
  return { appliedCount: rows.length, applications: rows, analysisDate: cadence.metadata?.analysisDate };
}

async function addApplication(input) {
  const company = clean(input.company, 160);
  const role = clean(input.role, 200);
  if (!company || !role) throw new Error('Company and job title are required');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0, 10);
  const status = clean(input.status || 'Evaluated', 80);
  const notes = [clean(input.location, 180), clean(input.url, 500)].filter(Boolean).join('; ');
  const tx = await openTrackerTransaction(TRACKER);
  let id;
  try {
    const text = tx.read();
    const lines = text.split('\n');
    const cols = resolveColumns(lines);
    const rows = lines.map(line => parseTrackerRow(line, cols)).filter(Boolean);
    id = Math.max(0, ...rows.map(row => row.num)) + 1;
    const width = Math.max(...Object.values(cols));
    const parts = Array(width + 1).fill('');
    const put = (key, value) => { if (cols[key] != null) parts[cols[key]] = cell(value); };
    put('num', id); put('date', date); put('company', company); put('role', role);
    put('score', 'N/A'); put('status', status); put('pdf', '—'); put('report', '—');
    put('notes', notes || 'Added from dashboard');
    const next = text.replace(/\s*$/, '') + '\n' + rebuildRow(parts) + '\n';
    tx.replace(next);
  } finally { tx.close(); }
  return { id, date, company, role, status, notes, url: clean(input.url, 500) };
}

async function updateApplication(id, input) {
  const allowed = ['date', 'company', 'role', 'score', 'notes'];
  const tx = await openTrackerTransaction(TRACKER);
  let updated;
  try {
    const text = tx.read();
    const lines = text.split('\n');
    const cols = resolveColumns(lines);
    const index = lines.findIndex(line => parseTrackerRow(line, cols)?.num === Number(id));
    if (index < 0) throw new Error(`Application #${id} was not found`);
    const parts = lines[index].split('|').map(v => v.trim());
    for (const key of allowed) {
      if (input[key] !== undefined && cols[key] != null) parts[cols[key]] = cell(clean(input[key], key === 'notes' ? 1000 : 200));
    }
    lines[index] = rebuildRow(parts);
    tx.replace(lines.join('\n'));
    updated = parseTrackerRow(lines[index], cols);
  } finally { tx.close(); }
  return updated;
}

function safeFile(urlPath) {
  const requested = urlPath === '/' ? 'dashboard.html' : decodeURIComponent(urlPath.slice(1));
  const full = normalize(join(ROOT, requested));
  if (relative(ROOT, full).startsWith('..')) return null;
  const allowed = requested === 'dashboard.html' || requested.startsWith('output/') || requested.startsWith('reports/') || requested.startsWith('fonts/');
  return allowed ? full : null;
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, persistent: true });
    if (req.method === 'GET' && url.pathname === '/api/activity') return json(res, 200, await applicationActivity());
    if (req.method === 'GET' && url.pathname === '/api/scan') return json(res, 200, scanSnapshot());
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      const started = startScan();
      return json(res, started ? 202 : 409, started ? scanSnapshot() : { error: 'A portal scan is already running', ...scanSnapshot() });
    }
    if (req.method === 'POST' && url.pathname === '/api/applications/status') {
      const input = await body(req);
      return json(res, 200, { ok: true, result: await setStatus(input.id, input.status) });
    }
    if (req.method === 'POST' && url.pathname === '/api/applications') {
      return json(res, 201, { ok: true, application: await addApplication(await body(req)) });
    }
    const edit = url.pathname.match(/^\/api\/applications\/(\d+)$/);
    if (req.method === 'PATCH' && edit) {
      return json(res, 200, { ok: true, application: await updateApplication(edit[1], await body(req)) });
    }
    if (req.method !== 'GET') return json(res, 404, { error: 'Not found' });
    const path = safeFile(url.pathname);
    if (!path || !existsSync(path) || !statSync(path).isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(path));
  } catch (error) {
    const message = error?.stderr?.trim() || error.message || 'Dashboard request failed';
    json(res, 400, { error: message });
  }
}

await execFileAsync(process.execPath, ['generate-web-dashboard.mjs'], { cwd: ROOT });
createServer(handler).listen(PORT, HOST, () => {
  const dashboardURL = `http://${HOST}:${PORT}`;
  console.log(`Career dashboard: ${dashboardURL}`);
  console.log('Changes are persisted to data/applications.md');
  if (process.argv.includes('--open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', dashboardURL] : [dashboardURL];
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  }
});
