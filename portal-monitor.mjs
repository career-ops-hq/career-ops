#!/usr/bin/env node
// Shared core for URL-based monitoring, driven by the web UI and the existing
// OS worker. Settings/checkpoints are user-layer data, never hardcoded sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { linkedInJobId } from './lib/linkedin-url.mjs';
import { postingKey } from './url-key.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { makeHttpCtx, sleep } from './providers/_http.mjs';
import { isBlockedAddress } from './providers/_ip-guard.mjs';
import { atomicWriteFile, appendToPipeline, loadSeenUrls, isOfferSeen, markOfferSeen, buildTitleFilter, buildLocationFilter, buildPostingAgeFilter } from './scan.mjs';

const CODE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const ID = /^[a-f0-9-]{36}$/;
const emptyStore = () => ({ version: 1, sources: [], notices: [] });
export const monitorFile = root => path.join(root, 'data', 'portal-monitors.json');

export function publicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\0|]/.test(raw.trim())) throw new Error('Enter one complete public HTTPS URL.');
  let u;
  try { u = new URL(raw.trim()); } catch { throw new Error('Enter a valid website URL, including https://.'); }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.') || u.hostname.endsWith('.local') || u.hostname.endsWith('.localhost') || (isIP(host) && isBlockedAddress(host))) {
    throw new Error('Use a public HTTPS website without credentials or a custom port.');
  }
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_') || ['trk', 'trackingId', 'refId'].includes(key)) u.searchParams.delete(key);
  return u.href.replace(/\/$/, '');
}

function cleanText(value, max = 160) {
  return typeof value === 'string' ? value.replace(/[\r\n\t|]/g, ' ').trim().slice(0, max) : '';
}

export function normalizeMonitorInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter source details.');
  const url = publicUrl(input.url);
  const u = new URL(url);
  if (/(^|\.)linkedin\.com$/.test(u.hostname)) {
    throw new Error('LinkedIn searches cannot be monitored here. Use Add job URLs for individual listings, or enable LinkedIn email alerts for a search.');
  }
  const raw = typeof input.keywords === 'string' ? input.keywords.split(',') : input.keywords || [];
  if (!Array.isArray(raw) || raw.length > 30 || raw.some(k => typeof k !== 'string' || k.length > 100)) throw new Error('Use up to 30 keywords, separated by commas.');
  return { name: cleanText(input.name) || u.hostname.replace(/^www\./, ''), url,
    keywords: [...new Set(raw.map(k => k.trim()).filter(Boolean))],
    notifyDesktop: input.notifyDesktop === true, includeExisting: input.includeExisting === true,
    // A newly added Explore source can be saved without creating a second,
    // independent recurring job. Missing on older sources means the original
    // daily monitor remains active, including its existing baseline.
    autoMonitor: input.autoMonitor !== false };
}

export function readMonitorStore(root) {
  let value;
  try { value = JSON.parse(fs.readFileSync(monitorFile(root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return emptyStore(); throw new Error(`Could not read portal monitors: ${error.message}`); }
  if (value?.version !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.notices)) throw new Error('Invalid portal-monitor store; existing data was left unchanged.');
  for (const s of value.sources) {
    if (!s || !ID.test(s.id) || typeof s.enabled !== 'boolean' || !Array.isArray(s.seenKeys) || s.seenKeys.some(k => typeof k !== 'string')) throw new Error('Invalid monitored source; existing data was left unchanged.');
    normalizeMonitorInput(s);
    if (!Number.isFinite(Date.parse(s.nextRunAt)) || typeof s.name !== 'string' || !Array.isArray(s.keywords) || !Number.isInteger(s.totalAdded) || s.totalAdded < 0) throw new Error('Invalid monitor schedule or counters.');
  }
  for (const n of value.notices) if (!n || !ID.test(n.id) || !Number.isInteger(n.count) || n.count < 0 || typeof n.read !== 'boolean' || !Array.isArray(n.jobs)) throw new Error('Invalid portal notifications; existing data was left unchanged.');
  return value;
}

async function withStore(root, fn) {
  const lock = await acquireDirLock(`${monitorFile(root)}.lock`, { createParent: true, timeoutMs: 1000, maxWaitMs: 1500 });
  try {
    const store = readMonitorStore(root);
    const result = await fn(store);
    atomicWriteFile(monitorFile(root), JSON.stringify(store, null, 2) + '\n');
    return result;
  } finally { releaseOrWarn(lock); }
}

export function monitorSummary(root) {
  const store = readMonitorStore(root);
  return { sources: store.sources.map(({ seenKeys, ...s }) => s), notices: store.notices,
    unreadCount: store.notices.filter(n => !n.read).reduce((n, entry) => n + entry.count, 0) };
}

let registry;
async function getProvider(source) {
  registry ||= loadProviders(path.join(CODE_ROOT, 'providers'));
  const match = resolveProvider({ name: source.name, careers_url: source.url }, await registry, { skipIds: ['local-parser'] });
  if (!match?.provider) throw new Error('This website has no supported reader yet. Nothing was saved. Try the employer’s ATS careers URL or add individual job URLs.');
  return match.provider;
}

export async function fetchMonitorJobs(source, { ctx, provider } = {}) {
  provider ||= await getProvider(source);
  const entry = { name: source.name, careers_url: source.url };
  const jobs = await provider.fetch(entry, ctx || { ...makeHttpCtx(), sleep });
  if (!Array.isArray(jobs)) throw new Error('The website reader returned an invalid listing.');
  const valid = new Map();
  for (const job of jobs) {
    if (!job || typeof job.title !== 'string' || !job.title.trim()) continue;
    const url = publicUrl(job.url);
    valid.set(postingKey(url), { ...job, url, title: cleanText(job.title, 500), company: cleanText(job.company) || '?', location: cleanText(job.location) });
  }
  const all = [...valid.values()];
  const matches = buildTitleFilter({ positive: source.keywords, negative: [] });
  return { provider: provider.id, jobs: all.filter(j => matches(j.title)), total: all.length, partial: false };
}

/** Resolve only saved source IDs. Never accept URLs or commands from a search. */
export function validateMonitorSearchIds(ids) {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !ID.test(id))) {
    throw new Error('Select up to 20 saved websites.');
  }
  return [...new Set(ids)];
}

/**
 * Search selected saved websites without mutating their monitor baselines,
 * notifications, or pipeline. Explore filters are explicit: the website's
 * separate daily-monitor keyword setting does not silently constrain a search.
 * Unknown posting dates are retained and counted; an unknown date is never
 * represented as a fresh date. A monitoring baseline can still distinguish a
 * newly seen undated job from postings already present on the first check.
 */
export async function searchMonitorSources(root, websiteIds, filters = {}, options = {}) {
  const ids = validateMonitorSearchIds(websiteIds);
  if (!ids.length) return { offers: [], failures: [], searched: [], unknownDates: 0 };
  const sources = readMonitorStore(root).sources;
  const keywords = key => Array.isArray(filters[key]) ? filters[key].filter(v => typeof v === 'string').slice(0, 512) : [];
  const titleMatch = buildTitleFilter({ positive: keywords('positive'), negative: keywords('negative') });
  const locationMatch = buildLocationFilter({ allow: keywords('allow'), block: keywords('block'),
    block_hard: keywords('blockHard'), always_allow: keywords('alwaysAllow') });
  const now = options.now ?? Date.now();
  const since = Number(filters.sinceDays);
  const ageMatch = buildPostingAgeFilter(Number.isInteger(since) && since > 0 ? since : 0, now);
  const known = options.excludeSeen === false ? new Set() : loadSeenUrls({}, {
    pipelinePath: process.env.CAREER_OPS_PIPELINE || path.join(root, 'data', 'pipeline.md'),
    applicationsPath: resolveTrackerPath(root),
    scanHistoryPath: process.env.CAREER_OPS_SCAN_HISTORY || path.join(root, 'data', 'scan-history.tsv'),
  }).seen;
  const seen = options.excludeSeen === false ? new Set() : known;
  const fetchJobs = options.fetchJobs || fetchMonitorJobs;
  const offers = [], failures = [], searched = [];
  let unknownDates = 0;
  for (const id of ids) {
    const source = sources.find(s => s.id === id);
    if (!source) { failures.push({ id, name: 'Removed website', error: 'This saved website no longer exists.' }); continue; }
    if (!source.enabled) { failures.push({ id, name: source.name, error: 'This website is paused. Resume it before searching.' }); continue; }
    try {
      const sourceSeen = options.dedupeAcrossSources === false ? new Set(options.excludeSeen === false ? [] : known) : seen;
      // A source's monitoring keywords are a separate daily-monitor setting.
      const result = await fetchJobs({ ...source, keywords: [] });
      if (!Array.isArray(result.jobs)) throw new Error('The website returned an invalid listing.');
      let count = 0;
      for (const job of result.jobs) {
        if (!titleMatch(job.title) || !locationMatch(job.location, job.url, job.title)) continue;
        if (!ageMatch(job.postedAt) || isOfferSeen(job, sourceSeen)) continue;
        if (typeof job.postedAt !== 'number' || !Number.isFinite(job.postedAt)) unknownDates++;
        markOfferSeen(job, sourceSeen);
        // Search results need metadata and a link, not a possibly huge or
        // untrusted description copied into the local web process.
        const { description, ...listing } = job;
        offers.push({ ...listing, sourceId: id, sourceName: source.name, source: result.provider || source.provider || 'website' });
        count++;
      }
      searched.push({ id, name: source.name, count });
    } catch (error) {
      failures.push({ id, name: source.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { offers, failures, searched, unknownDates };
}

/** Deliver a scheduled search through the canonical dedup/write path. */
export async function deliverMonitorSearch(root, offers, { notify = desktopNotice, now = Date.now() } = {}) {
  if (!Array.isArray(offers)) throw new Error('Scheduled website results must be a list.');
  const ids = validateMonitorSearchIds([...new Set(offers.map(offer => offer?.sourceId))]);
  const result = await withStore(root, async store => {
    const failures = [], notices = [];
    let added = 0;
    // Re-check while holding the store lock. A paused or removed source must
    // never have its stale results delivered after a long scan.
    for (const id of ids) {
      const source = store.sources.find(s => s.id === id);
      if (!source || !source.enabled) {
        failures.push({ id, name: source?.name || 'Removed website', error: source ? 'This website was paused during the scan.' : 'This website was removed during the scan.' });
        continue;
      }
      const matching = offers.filter(offer => offer.sourceId === id).map(offer => ({ ...offer, sourceLabel: source.name }));
      const fresh = await appendUnseen(root, matching);
      if (!fresh.length) continue;
      source.totalAdded += fresh.length;
      const notice = { id: randomUUID(), sourceId: id, name: source.name, at: new Date(now).toISOString(),
        count: fresh.length, read: false, jobs: fresh.slice(0, 20).map(({ title, company, url }) => ({ title, company, url })) };
      store.notices.unshift(notice);
      notices.push({ count: fresh.length, notifyDesktop: source.notifyDesktop });
      added += fresh.length;
    }
    store.notices = store.notices.slice(0, 100);
    return { added, failures, notices };
  });
  for (const notice of result.notices) if (notice.notifyDesktop) await notify(notice.count);
  return { added: result.added, failures: result.failures };
}

export async function previewMonitor(input, options) {
  const source = normalizeMonitorInput(input);
  const result = await fetchMonitorJobs(source, options);
  return { ...source, provider: result.provider, total: result.total, matching: result.jobs.length,
    partial: result.partial, jobs: result.jobs.slice(0, 8).map(({ title, company, location, url }) => ({ title, company, location, url })) };
}

export async function addMonitor(root, input, options = {}) {
  const source = normalizeMonitorInput(input);
  // Test again server-side. Client-supplied provider IDs or preview claims do
  // not grant network execution or turn an unsupported source into coverage.
  const preview = await previewMonitor(source, options);
  return withStore(root, store => {
    if (store.sources.some(s => s.url === source.url)) throw new Error('This website is already monitored.');
    const now = new Date().toISOString();
    const saved = { ...source, id: randomUUID(), provider: preview.provider, enabled: true,
      createdAt: now, nextRunAt: now, seenKeys: [], lastAdded: 0, totalAdded: 0 };
    store.sources.push(saved);
    const { seenKeys, ...summary } = saved;
    return summary;
  });
}

export async function updateMonitor(root, id, input) {
  return withStore(root, store => {
    const source = store.sources.find(s => s.id === id);
    if (!source) throw new Error('Monitored website not found.');
    // URLs are immutable: a different inventory must start with new checkpoints.
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') throw new Error('Invalid monitoring status.');
      source.enabled = input.enabled;
      if (source.enabled) source.nextRunAt = new Date().toISOString();
    }
    if (input.name !== undefined || input.keywords !== undefined || input.notifyDesktop !== undefined) {
      Object.assign(source, normalizeMonitorInput({ ...source, ...input, url: source.url }));
      source.nextRunAt = new Date().toISOString();
    }
    return { ok: true };
  });
}

export async function removeMonitor(root, id) {
  return withStore(root, store => {
    if (!store.sources.some(s => s.id === id)) throw new Error('Monitored website not found.');
    store.sources = store.sources.filter(s => s.id !== id);
    return { ok: true };
  });
}

async function appendUnseen(root, jobs) {
  const pipelinePath = process.env.CAREER_OPS_PIPELINE || path.join(root, 'data', 'pipeline.md');
  const { seen } = loadSeenUrls({}, { pipelinePath, applicationsPath: resolveTrackerPath(root),
    scanHistoryPath: process.env.CAREER_OPS_SCAN_HISTORY || path.join(root, 'data', 'scan-history.tsv') });
  const unseen = jobs.filter(job => {
    if (isOfferSeen(job, seen)) return false;
    markOfferSeen(job, seen);
    return true;
  });
  return await appendToPipeline(unseen, { pipelinePath, deduplicate: true }) || [];
}

function desktopNotice(count) {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise(resolve => execFile('/usr/bin/osascript', ['-e',
    `display notification "${count} newly found jobs are waiting in your Career Ops inbox." with title "Career Ops · new jobs"`],
  { timeout: 5000 }, error => resolve(!error)));
}

export async function checkMonitor(root, id, { fetchJobs = fetchMonitorJobs, now = Date.now(), notify = desktopNotice, dueOnly = false } = {}) {
  // Per-source lock avoids duplicate network work. Store locks are short: pause,
  // remove and notification reads remain responsive throughout a long scan.
  if (!ID.test(id)) throw new Error('Invalid monitored website identifier.');
  const lock = await acquireDirLock(`${monitorFile(root)}.${id}.run.lock`, { createParent: true, timeoutMs: 100, maxWaitMs: 200 });
  try {
    const source = readMonitorStore(root).sources.find(s => s.id === id);
    if (!source) throw new Error('Monitored website not found.');
    if (dueOnly && (!source.enabled || source.autoMonitor === false || Date.parse(source.nextRunAt) > now)) return { skipped: true };
    const at = new Date(now).toISOString();
    await withStore(root, store => { const s = store.sources.find(s => s.id === id); if (s) s.lastAttempt = at; });
    try {
      const result = await fetchJobs(source);
      const latest = readMonitorStore(root).sources.find(s => s.id === id);
      if (!latest || (source.enabled && !latest.enabled) || JSON.stringify(source.keywords) !== JSON.stringify(latest.keywords)) {
        return { skipped: true, added: 0, reason: 'Monitoring settings changed while the check was running.' };
      }
      const known = new Set(source.seenKeys);
      const candidates = result.jobs.filter(j => !known.has(postingKey(j.url))).map(j => ({ ...j, sourceLabel: source.name }));
      const baseline = !source.lastSuccess && !source.includeExisting;
      const added = baseline ? [] : await appendUnseen(root, candidates);
      const summary = await withStore(root, store => {
        const current = store.sources.find(s => s.id === id);
        if (!current) return { added: added.length, removed: true };
        // Checkpoint only after pipeline writes succeed. A retry cannot lose jobs.
        current.seenKeys = [...new Set([...current.seenKeys, ...result.jobs.map(j => postingKey(j.url))])];
        Object.assign(current, { lastSuccess: at, nextRunAt: new Date(now + DAY).toISOString(), lastError: null,
          lastTotal: result.total, lastMatching: result.jobs.length, lastAdded: added.length, totalAdded: current.totalAdded + added.length });
        if (added.length) store.notices.unshift({ id: randomUUID(), sourceId: id, name: source.name, at,
          count: added.length, read: false, jobs: added.slice(0, 20).map(({ title, company, url }) => ({ title, company, url })) });
        store.notices = store.notices.slice(0, 100);
        return { added: added.length, total: result.total, matching: result.jobs.length, baseline };
      });
      if (added.length && source.notifyDesktop) await notify(added.length);
      return summary;
    } catch (error) {
      await withStore(root, store => {
        const current = store.sources.find(s => s.id === id);
        if (current) Object.assign(current, { lastError: error.message, nextRunAt: new Date(now + 3600000).toISOString() });
      });
      throw error;
    }
  } finally { releaseOrWarn(lock); }
}

export async function runDueMonitors(root, options = {}) {
  const now = options.now ?? Date.now();
  const due = readMonitorStore(root).sources.filter(s => s.enabled && s.autoMonitor !== false && Date.parse(s.nextRunAt) <= now);
  const results = [];
  for (const source of due) {
    try { results.push({ id: source.id, ...await checkMonitor(root, source.id, { ...options, now, dueOnly: true }) }); }
    catch (error) { results.push({ id: source.id, error: error.message }); }
  }
  return { checked: results.length, added: results.reduce((n, r) => n + (r.added || 0), 0), results };
}

export async function addJobUrls(root, input) {
  const lines = typeof input.urls === 'string' ? input.urls.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  if (!lines.length || lines.length > 50) throw new Error('Paste between 1 and 50 job URLs, one per line.');
  const jobs = lines.map(raw => {
    let url = publicUrl(raw);
    const u = new URL(url);
    const linkedin = /(^|\.)linkedin\.com$/.test(u.hostname);
    const id = linkedInJobId(u);
    if (linkedin && !id) throw new Error('Paste an individual LinkedIn job URL, or a search URL with currentJobId selecting one job.');
    if (id) url = `https://www.linkedin.com/jobs/view/${id}`;
    return { url, company: lines.length === 1 ? cleanText(input.company) || '?' : '?',
      title: (lines.length === 1 ? cleanText(input.title, 500) : '') || (id ? `LinkedIn job ${id} (title not provided)` : 'Saved job (title not provided)'),
      note: 'Added manually; posting availability has not been verified.' };
  });
  const added = await appendUnseen(root, jobs);
  return { added: added.length, alreadyKnown: jobs.length - added.length };
}

export async function monitorAction(root, action, input = {}) {
  if (action === 'list') return monitorSummary(root);
  if (action === 'list-sources') return { sources: monitorSummary(root).sources };
  if (action === 'preview') return previewMonitor(input);
  if (action === 'add') return addMonitor(root, input);
  if (action === 'update') return updateMonitor(root, input.id, input);
  if (action === 'remove') return removeMonitor(root, input.id);
  if (action === 'check') return checkMonitor(root, input.id);
  if (action === 'due') return runDueMonitors(root);
  if (action === 'search') return searchMonitorSources(root, input.websiteIds, input);
  if (action === 'add-jobs') return addJobUrls(root, input);
  if (action === 'read') return withStore(root, store => {
    // Only acknowledge notices already seen by this browser, so a concurrent
    // new scan cannot be marked read accidentally.
    if (!Array.isArray(input.ids)) throw new Error('Choose notifications to mark read.');
    for (const notice of store.notices) if (input.ids.includes(notice.id)) notice.read = true;
    return { ok: true };
  });
  throw new Error('Unknown portal action.');
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: node portal-monitor.mjs <action> [JSON]

Manage saved website sources and job links using the existing provider registry.
Settings and checkpoints are stored under the configured data root.

Actions:
  list, list-sources      Read saved sources and notifications
  preview, add           Validate or save a supported website URL
  update, remove         Manage a saved source by id
  check, due             Check one source or all due monitors
  search                 Read Explore filters as JSON from stdin
  add-jobs               Save individual posting URLs
  read                   Acknowledge notification ids

Options:
  --help, -h             Show this help without reading or writing user data`);
  } else {
    try {
      const action = process.argv[2] || 'list';
      let input;
      if (process.argv[3]) input = JSON.parse(process.argv[3]);
      else if (action === 'search') {
        let raw = '';
        for await (const chunk of process.stdin) {
          raw += chunk;
          if (raw.length > 1_000_000) throw new Error('Search request is too large.');
        }
        input = JSON.parse(raw || '{}');
      } else input = {};
      console.log(JSON.stringify(await monitorAction(getCareerOpsRoot(), action, input)));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
      process.exitCode = 1;
    }
  }
}
