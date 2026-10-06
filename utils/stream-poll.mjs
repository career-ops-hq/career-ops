#!/usr/bin/env node

/**
 * stream-poll.mjs — local drain for the n8n inbound queue
 *
 * The cloud side of the Inbound Bridge is an n8n workflow that watches an IMAP
 * mailbox for job alerts and writes each message carrying a posting link into a
 * Supabase table (`inbound_alerts`, status `pending`). Nothing on that side can
 * reach this machine, so the arrow runs the other way: this script polls the
 * table, hands every pending row to utils/stream-bridge.mjs, and stamps the row
 * with what the bridge decided.
 *
 * stream-bridge.mjs owns the three gates (resolve, liveness, dedup) and the
 * append to data/pipeline.md. This file owns exactly one thing: the row state
 * machine around them.
 *
 *   pending -> ingested   added | duplicate | expired | pending (dry-run)
 *   pending -> failed     invalid | error
 *
 * `duplicate` and `expired` are recorded as ingested, not failed: both mean the
 * bridge looked at the posting and reached a considered verdict. A duplicate is
 * the dedup gate working, and an expired posting that was correctly dropped is
 * the liveness gate working. Only a payload the bridge could not process at all
 * is a failure, and only those are worth re-draining.
 *
 * Contract with the n8n workflow (columns of `inbound_alerts`):
 *
 *   id           bigint, identity, primary key
 *   created_at   timestamptz, default now() - ordering for the drain
 *   status       text, default 'pending' - pending | ingested | failed
 *   source       text - which stream produced the alert
 *   url          text - the posting link the alert carried
 *   title        text - the raw job title
 *   sender       text - the mailbox the alert came from
 *   received_at  timestamptz - when the mail was received
 *   body         text - full message text, kept for audit/debug only
 *   result       text - the ingest status the bridge returned
 *   error        text - the reason when result is invalid or error
 *   ingested_at  timestamptz - when this script claimed the row
 *
 * Credentials come from the environment and are never read from a committed
 * file: SUPABASE_URL (project REST root) and SUPABASE_KEY (apikey to send in
 * both the `apikey` and `Authorization` headers, per PostgREST's convention).
 * Both can also be passed as --url / --key. Nothing here is written unless a
 * row is fetched first, so a missing config fails loudly before any side effect.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... node utils/stream-poll.mjs
 *   node utils/stream-poll.mjs --limit 25 --json
 *   node utils/stream-poll.mjs --dry-run --limit 5
 *   node utils/stream-poll.mjs --self-test
 *
 * Exit code: 0 when every fetched row reached a terminal state, 1 when any row
 * failed, when the fetch errored, or when the config is missing.
 */

import { isMainModule } from '../lib/is-main-module.mjs';
import { ingestAlert } from './stream-bridge.mjs';

export const TABLE = 'inbound_alerts';
const CONSUMED = new Set(['added', 'duplicate', 'expired', 'pending']);
const STATUSES = ['pending', 'ingested', 'failed'];

/**
 * Resolve connection config from explicit options, then the environment.
 *
 * @param {{url?: string, key?: string, table?: string, limit?: number,
 *          env?: Record<string, string|undefined>}} [input]
 * @returns {{url: string, key: string, table: string, limit: number}}
 * @throws when url or key is missing - never silently defaults to a built-in
 *   project, because writing to the wrong one is worse than failing.
 */
export function resolveConfig(input = {}) {
  const env = input.env ?? process.env;
  const url = String(input.url || env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(input.key || env.SUPABASE_KEY || '').trim();
  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_KEY'].filter(Boolean).join(' and ');
    throw new Error(`missing ${missing} (pass --url/--key or set the environment variable)`);
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`SUPABASE_URL must be an http(s) origin, got: ${url}`);
  const limit = Number.isFinite(Number(input.limit)) && Number(input.limit) > 0
    ? Math.floor(Number(input.limit))
    : 50;
  return { url, key, table: String(input.table || TABLE), limit };
}

function headers(cfg) {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/**
 * Fetch pending rows, oldest first.
 *
 * @param {object} cfg - from resolveConfig().
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<object[]>}
 */
export async function fetchPendingRows(cfg, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const qs = new URLSearchParams({
    status: 'eq.pending',
    order: 'created_at.asc',
    limit: String(cfg.limit),
  });
  const res = await fetchImpl(`${cfg.url}/rest/v1/${cfg.table}?${qs}`, { headers: headers(cfg) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`queue read failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/**
 * Stamp a row after the bridge has run.
 *
 * @param {object} cfg - from resolveConfig().
 * @param {string|number} id
 * @param {Record<string, unknown>} fields
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<object>} the updated row
 */
export async function markRow(cfg, id, fields, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${cfg.url}/rest/v1/${cfg.table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: headers(cfg),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`row ${id} update failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : { id, ...fields };
}

/**
 * Translate a bridge result into the row's terminal state.
 *
 * @param {object} result - return value of ingestAlert().
 * @param {() => Date} [now]
 * @returns {Record<string, unknown>}
 */
export function rowUpdateFor(result, now = () => new Date()) {
  const consumed = CONSUMED.has(result?.status);
  return {
    status: consumed ? 'ingested' : 'failed',
    result: result?.status ?? null,
    error: result?.reason ?? null,
    ingested_at: now().toISOString(),
  };
}

/**
 * One drain cycle: read pending rows, ingest each, stamp each.
 *
 * Sequential on purpose - stream-bridge takes the pipeline lock per alert, and
 * interleaving the stamps with the reads would let a crashed run leave rows in
 * `pending` that were already appended, which the next drain would reprocess.
 * The dedup gate absorbs that, but ordering it keeps the ledger honest.
 *
 * @param {object} cfg - from resolveConfig().
 * @param {{ingest?: typeof ingestAlert, dryRun?: boolean, fetchImpl?: typeof fetch,
 *          now?: () => Date}} [opts]
 * @returns {Promise<{fetched: number, results: object[], updates: object[], summary: object}>}
 */
export async function pollOnce(cfg, opts = {}) {
  const ingest = opts.ingest ?? ingestAlert;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const dryRun = Boolean(opts.dryRun);

  const rows = await fetchPendingRows(cfg, { fetchImpl });
  const results = [];
  const updates = [];

  for (const row of rows) {
    const result = await ingest(
      {
        url: row?.url ?? '',
        title: row?.title ?? '',
        source: row?.source ?? '',
        company: row?.company ?? '',
      },
      { now },
    );
    const fields = rowUpdateFor(result, now);
    results.push({ id: row?.id, url: row?.url, result });
    if (dryRun) {
      updates.push({ id: row?.id, ...fields, skipped: 'dry-run' });
      continue;
    }
    try {
      await markRow(cfg, row?.id, fields, { fetchImpl });
      updates.push({ id: row?.id, ...fields });
    } catch (err) {
      results[results.length - 1].result = { ...result, status: 'error', reason: err?.message || String(err) };
      updates.push({ id: row?.id, status: 'failed', error: err?.message || String(err), unmarked: true });
    }
  }

  const summary = {};
  for (const r of results) summary[r.result.status] = (summary[r.result.status] || 0) + 1;
  return { fetched: rows.length, results, updates, summary };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Drain pending rows from the Supabase inbound queue into data/pipeline.md.

Usage:
  node utils/stream-poll.mjs [options]

Options:
  --url <origin>     Supabase REST origin (or SUPABASE_URL)
  --key <apikey>     Supabase apikey       (or SUPABASE_KEY)
  --table <name>     Queue table           (default: ${TABLE})
  --limit <n>        Max rows per drain    (default: 50)
  --dry-run          Read and classify, write nothing back
  --json             Machine-readable output
  --self-test        Run offline invariants (no network, no config)
  -h, --help         Show this help`;

function parseArgs(argv) {
  const opts = { json: false, dryRun: false, help: false, selfTest: false, url: null, key: null, table: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--key') opts.key = argv[++i];
    else if (a === '--table') opts.table = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a.startsWith('--url=')) opts.url = a.slice(6);
    else if (a.startsWith('--key=')) opts.key = a.slice(6);
    else if (a.startsWith('--table=')) opts.table = a.slice(8);
    else if (a.startsWith('--limit=')) opts.limit = Number(a.slice(8));
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.url !== null && !opts.url) throw new Error('--url requires a value');
  if (opts.key !== null && !opts.key) throw new Error('--key requires a value');
  if (opts.limit !== null && !(Number.isFinite(opts.limit) && opts.limit > 0)) throw new Error('--limit requires a positive number');
  return opts;
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Offline invariants. Uses a scripted fetch stub so no network is touched and
 * no config is needed - the point is that the row state machine and the bridge
 * handoff are correct, not that a particular project answers.
 */
async function runSelfTest() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });

  const rows = [
    { id: 1, url: 'https://jobs.example.com/a/1', title: 'Role A', source: 'n8n-imap' },
    { id: 2, url: 'not-a-url', title: 'Role B', source: 'n8n-imap' },
    { id: 3, url: 'https://jobs.example.com/a/3', title: 'Role C', source: 'n8n-imap' },
  ];

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if ((init.method || 'GET') === 'GET') {
      return { ok: true, status: 200, statusText: 'OK', json: async () => rows, text: async () => '' };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => [{}], text: async () => '' };
  };

  const cfg = { url: 'https://proj.supabase.co', key: 'k', table: 'inbound_alerts', limit: 50 };
  const fixed = () => new Date('2026-10-06T00:00:00.000Z');
  const ingest = async (alert) => (alert.url.startsWith('https://') && alert.title
    ? { status: 'added', url: alert.url, reason: 'appended to Pending' }
    : { status: 'invalid', url: alert.url, title: alert.title, reason: 'missing url' });

  const out = await pollOnce(cfg, { ingest, fetchImpl, now: fixed });

  check('reads pending rows once', calls.filter(c => c.method === 'GET').length === 1, JSON.stringify(calls));
  check('sees every row', out.fetched === 3, `fetched=${out.fetched}`);
  check('classifies valid rows as added', out.summary.added === 2, JSON.stringify(out.summary));
  check('classifies bad rows as invalid', out.summary.invalid === 1, JSON.stringify(out.summary));

  const patchCalls = calls.filter(c => c.method === 'PATCH');
  check('stamps every row', patchCalls.length === 3, `patch calls=${patchCalls.length}`);

  const upd = rowUpdateFor({ status: 'added' }, fixed);
  check('added maps to ingested', upd.status === 'ingested' && upd.result === 'added', JSON.stringify(upd));
  check('duplicate maps to ingested (dedup gate working)',
    rowUpdateFor({ status: 'duplicate' }, fixed).status === 'ingested', '');
  check('expired maps to ingested (liveness gate working)',
    rowUpdateFor({ status: 'expired' }, fixed).status === 'ingested', '');
  check('invalid maps to failed', rowUpdateFor({ status: 'invalid', reason: 'missing url' }, fixed).status === 'failed', '');
  check('error maps to failed', rowUpdateFor({ status: 'error', reason: 'boom' }, fixed).status === 'failed', '');
  check('reason is carried into error column',
    rowUpdateFor({ status: 'invalid', reason: 'missing url' }, fixed).error === 'missing url', '');
  check('ingested_at is deterministic under the injected clock',
    upd.ingested_at === '2026-10-06T00:00:00.000Z', upd.ingested_at);

  // dry-run classifies but never writes
  const calls2 = [];
  const fetchImpl2 = async (url, init = {}) => {
    calls2.push(init.method || 'GET');
    if ((init.method || 'GET') === 'GET') return { ok: true, status: 200, statusText: 'OK', json: async () => rows, text: async () => '' };
    throw new Error('dry-run must not PATCH');
  };
  const dry = await pollOnce(cfg, { ingest, fetchImpl: fetchImpl2, now: fixed, dryRun: true });
  check('dry-run still classifies', dry.summary.added === 2 && dry.summary.invalid === 1, JSON.stringify(dry.summary));
  check('dry-run issues no PATCH', calls2.filter(m => m === 'PATCH').length === 0, JSON.stringify(calls2));
  check('dry-run rows are marked skipped', dry.updates.every(u => u.skipped === 'dry-run'), JSON.stringify(dry.updates));

  // empty queue is a clean no-op
  const fetchImpl3 = async (url, init = {}) => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => ((init.method || 'GET') === 'GET' ? [] : [{}]),
    text: async () => '',
  });
  const empty = await pollOnce(cfg, { ingest, fetchImpl: fetchImpl3, now: fixed });
  check('empty queue fetches nothing', empty.fetched === 0 && empty.results.length === 0, JSON.stringify(empty));
  check('empty queue writes nothing', empty.updates.length === 0, JSON.stringify(empty.updates));

  // a failed read surfaces as an error rather than a silent empty drain
  const fetchImpl4 = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}), text: async () => 'invalid key' });
  let readErr = null;
  try { await fetchPendingRows(cfg, { fetchImpl: fetchImpl4 }); } catch (err) { readErr = err; }
  check('read failure throws with status', /401/.test(readErr?.message || ''), readErr?.message);

  // config resolution fails loudly and names what is missing
  const noEnv = { env: {} };
  let cfgErr = null;
  try { resolveConfig(noEnv); } catch (err) { cfgErr = err; }
  check('missing config names both variables',
    /SUPABASE_URL and SUPABASE_KEY/.test(cfgErr?.message || ''), cfgErr?.message);

  let badErr = null;
  try { resolveConfig({ env: { SUPABASE_URL: 'ftp://x', SUPABASE_KEY: 'k' } }); } catch (err) { badErr = err; }
  check('non-http origin rejected', /http\(s\) origin/.test(badErr?.message || ''), badErr?.message);

  const okCfg = resolveConfig({ env: { SUPABASE_URL: 'https://p.supabase.co/', SUPABASE_KEY: 'k' }, limit: 7 });
  check('trailing slash stripped and limit applied',
    okCfg.url === 'https://p.supabase.co' && okCfg.limit === 7, JSON.stringify(okCfg));

  const failed = checks.filter(c => !c.ok);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  -> ${c.detail}`}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} invariants passed`);
  if (failed.length) {
    console.error(`\n${failed.length} FAILED:\n${failed.map(f => `  - ${f.name}: ${f.detail}`).join('\n')}`);
    process.exitCode = 1;
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  (async () => {
    let opts;
    try {
      opts = parseArgs(process.argv.slice(2));
    } catch (err) {
      console.error(`${err.message}\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }

    if (opts.help) {
      console.log(USAGE);
      return;
    }

    if (opts.selfTest) {
      await runSelfTest();
      return;
    }

    try {
      const cfg = resolveConfig(opts);
      const { fetched, results, updates, summary } = await pollOnce(cfg, { dryRun: opts.dryRun });

      if (opts.json) {
        console.log(JSON.stringify({ fetched, results, updates, summary }, null, 2));
      } else if (!fetched) {
        console.log('queue empty');
      } else {
        for (const r of results) {
          const icon = r.result.status === 'added' ? '+' : r.result.status === 'duplicate' ? '='
            : r.result.status === 'expired' ? '!' : '?';
          console.log(`${icon} ${r.result.status.padEnd(9)} ${r.url || '(no url)'}${r.result.reason ? `  — ${r.result.reason}` : ''}`);
        }
        console.log(`\n${fetched} row(s): ${Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ')}${opts.dryRun ? '  (dry-run, nothing written)' : ''}`);
      }

      if (summary.invalid > 0 || summary.error > 0) process.exitCode = 1;
    } catch (err) {
      console.error(`stream-poll: ${err?.message || err}`);
      process.exitCode = 1;
    }
  })();
}
