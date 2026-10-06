#!/usr/bin/env node

/**
 * stream-bridge.mjs — queue bridge between a live alert stream and data/pipeline.md
 *
 * Ingests job-alert payloads (from n8n, a webhook, or any producer that can emit
 * the JSON shape below), normalizes them, and appends them to the Pending section
 * of the application pipeline so `/career-ops pipeline` can triage them.
 *
 * A payload is `{ url, title, source, company? }`:
 *
 *   url      - the tracking URL the alert carried (required)
 *   title    - the raw job title as the alert reported it (required)
 *   source   - which stream produced it (linkedin, greenhouse-watch, ...)
 *   company  - only when the producer already knew it; otherwise derived
 *
 * Three gates run before anything is written, in this order:
 *
 *   1. RESOLVE  - the tracking URL is unwrapped to the direct company/ATS URL by
 *                 utils/url-resolver.mjs, so the pipeline stores the posting a
 *                 human can open, not a redirector with session parameters.
 *                 A resolver failure degrades to the original URL: an unresolved
 *                 link is still worth triaging, and dropping the alert outright
 *                 would silently lose data on a transient network error.
 *
 *   2. LIVENESS - the zero-token ATS-API check (liveness-api.mjs, the same first
 *                 rung check-liveness.mjs uses before it reaches for a browser).
 *                 Only a definitive `expired` drops the alert. `uncertain` and
 *                 `null` (not a known ATS, or the API was inconclusive) both pass,
 *                 because neither is evidence that the posting is gone - the
 *                 browser rung can still settle those later.
 *
 *   3. DEDUP    - appended through scan.mjs's appendToPipeline(), the same locked,
 *                 atomic, deduping seam the scanners use. It normalizes the URL
 *                 (tracking parameters stripped) and compares against
 *                 pipeline.md, applications.md and scan-history.tsv, so an alert
 *                 for a posting already in the pipeline is skipped rather than
 *                 duplicated. Re-implementing that here would let the bridge and
 *                 the scanner disagree about what counts as the same posting.
 *
 * The whole point of routing every write through appendToPipeline() is that this
 * file stays a *bridge*: it understands alert payloads, and nothing else about
 * the pipeline format. The row shape, the section handling, the lock, and the
 * dedup policy all remain owned by scan.mjs.
 *
 * Usage:
 *   echo '{"url":"...","title":"...","source":"linkedin"}' | node utils/stream-bridge.mjs
 *   node utils/stream-bridge.mjs --file alerts.json
 *   node utils/stream-bridge.mjs --file alerts.json --json --dry-run
 *   node utils/stream-bridge.mjs --self-test
 *
 * Input is either one object or an array of objects, as a JSON file (--file) or
 * on stdin. Output is a per-alert result line; --json makes it machine-readable.
 *
 * Exit code: 0 when every alert was processed (added, duplicate, expired), 1 when
 * any alert was rejected as invalid or failed outright.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isMainModule } from '../lib/is-main-module.mjs';
import { resolveDirectCompanyAtsUrl, stripTrackingParams } from './url-resolver.mjs';
import { checkLivenessViaApi, resolveAtsApi } from '../liveness-api.mjs';
import {
  PIPELINE_PATH,
  appendToPipeline,
  filterOffersForPipeline,
} from '../scan.mjs';

const USAGE = `Usage:
  node utils/stream-bridge.mjs [--file <alerts.json>] [--json] [--dry-run] [--no-liveness]
  node utils/stream-bridge.mjs --self-test    # offline, no network, no real writes
  node utils/stream-bridge.mjs --help         # print this usage block and exit

Alert JSON (one object, or an array of them, on stdin or via --file):
  { "url": "https://...", "title": "Senior PM", "source": "linkedin", "company": "Acme" }`;

/**
 * Best-effort company name from a direct ATS URL.
 *
 * The ATS URL is the only company signal a bare alert carries, so this reads the
 * same provider match the liveness API uses and takes its org token: the Greenhouse
 * board slug, the Lever posting slug, or the Ashby org. These are slugs rather than
 * display names (`razorpaysoftwareprivatelimited`, not "Razorpay"), which is honest
 * - a guess at the display name would be a fabrication, and the value here is only
 * that two alerts from the same board canonicalize to the same company for dedup.
 *
 * Returns '' when nothing is derivable. That is safe: scan.mjs gates its
 * company+role dedup on a truthy company, so an empty cell falls back to URL-only
 * dedup instead of collapsing two different employers' identical titles into one.
 *
 * @param {string} url - Direct (post-resolution) posting URL.
 * @returns {string} Company token, or '' when the URL is not a recognized ATS posting.
 */
export function deriveCompanyFromUrl(url) {
  const parts = resolveAtsApi(url)?.parts;
  if (!parts) return '';
  return String(parts.board || parts.slug || parts.org || '').trim();
}

/**
 * Build the `note:` segment carrying the bridge's provenance.
 *
 * `note:` is one of the labeled segments defined in modes/pipeline.md - it rides
 * on any row shape and is explicitly free text, which is where source and
 * discovery time belong. The user-visible columns stay the canonical positional
 * ones (url | company | title), so a bridge-written row reads exactly like a
 * scanner-written one to every downstream consumer.
 *
 * The tracking URL is included only when it differs from the resolved URL, which
 * is precisely when there is something to preserve: the posting's real location is
 * the url column, so recording the original only adds noise when they match.
 *
 * @param {object} fields
 * @param {string} fields.source - Stream that produced the alert.
 * @param {string} fields.discoveredAt - ISO 8601 discovery timestamp.
 * @param {string} [fields.trackingUrl] - Original alert URL, when it survived resolution differently.
 * @param {{result?: string, code?: string}} [fields.liveness] - Liveness verdict, when one was reached.
 * @returns {string} The note body (without the `note: ` label).
 */
export function buildAlertNote({ source, discoveredAt, trackingUrl, liveness }) {
  const parts = [`source=${source || 'unknown'}`, `discovered=${discoveredAt}`];
  if (liveness?.result) parts.push(`liveness=${liveness.code || liveness.result}`);
  if (trackingUrl) parts.push(`tracking=${trackingUrl}`);
  return parts.join(' ');
}

/**
 * True when the value is an absolute http(s) URL.
 *
 * Checked before resolution, because the resolver's failure path deliberately
 * degrades to the original string - correct for a fetch error on a real link, but
 * it would launder a typo'd or truncated payload straight into pipeline.md as a
 * row no one can open. Only a well-formed URL reaches the degrade path.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Ingest one alert: resolve, check liveness, dedup, append.
 *
 * Never throws for a bad payload - a malformed alert returns an `invalid` result so
 * one broken item in a batch cannot abort the rest. Network and filesystem failures
 * surface as an `error` result for the same reason.
 *
 * @param {{url?: unknown, title?: unknown, source?: unknown, company?: unknown}} alert
 * @param {object} [opts]
 * @param {string} [opts.pipelinePath] - Target pipeline.md (defaults to the canonical path).
 * @param {typeof resolveDirectCompanyAtsUrl} [opts.resolveUrl] - Injectable resolver (tests/offline).
 * @param {typeof checkLivenessViaApi] [opts.livenessCheck] - Injectable liveness core (tests/offline).
 * @param {boolean} [opts.skipLiveness] - Skip the liveness gate entirely.
 * @param {boolean} [opts.dryRun] - Report the verdict without writing.
 * @param {() => Date} [opts.now] - Clock, injectable for deterministic timestamps.
 * @returns {Promise<object>} Result with a `status` of
 *   `added` | `duplicate` | `expired` | `pending` (dry-run would-add) | `invalid` | `error`.
 */
export async function ingestAlert(alert, opts = {}) {
  const {
    pipelinePath = PIPELINE_PATH,
    resolveUrl = resolveDirectCompanyAtsUrl,
    livenessCheck = checkLivenessViaApi,
    skipLiveness = false,
    dryRun = false,
    now = () => new Date(),
    resolveOpts = {},
  } = opts;

  const url = typeof alert?.url === 'string' ? alert.url.trim() : '';
  const title = typeof alert?.title === 'string' ? alert.title.trim() : '';
  const source = typeof alert?.source === 'string' ? alert.source.trim() : '';
  const claimedCompany = typeof alert?.company === 'string' ? alert.company.trim() : '';

  if (!url || !title || !isHttpUrl(url)) {
    return {
      status: 'invalid',
      url,
      title,
      source,
      reason: !url ? 'missing url' : !title ? 'missing title' : `not an http(s) URL: ${url}`,
    };
  }

  // Gate 1 - resolve the tracking URL to the direct posting. Failure is not fatal:
  // the alert still carries a working link, and a transient fetch error should not
  // cost the user a real posting.
  let resolvedUrl = url;
  let resolveError = null;
  try {
    resolvedUrl = await resolveUrl(url, resolveOpts);
  } catch (err) {
    resolveError = err?.message || String(err);
    // Still drop the known tracking parameters. Resolution failed, so the URL is
    // not the canonical direct link - but utm_/gclid noise is pure tracking
    // baggage that no reader wants, and scan.mjs strips it anyway when deduping,
    // so keeping it only makes the stored row differ from every other source's.
    resolvedUrl = stripTrackingParams(url);
  }
  const trackingUrl = resolvedUrl !== url ? url : null;

  // Gate 2 - zero-token liveness. Only a definitive `expired` drops the alert; see
  // the module header for why `uncertain` and `null` both pass.
  let liveness = null;
  if (!skipLiveness) {
    try {
      liveness = await livenessCheck(resolvedUrl);
    } catch {
      liveness = null; // a crashed check is not a verdict
    }
  }
  if (liveness?.result === 'expired') {
    return {
      status: 'expired',
      url: resolvedUrl,
      trackingUrl,
      source,
      liveness,
      reason: liveness.reason || 'posting expired',
    };
  }

  const discoveredAt = now().toISOString();
  const company = claimedCompany || deriveCompanyFromUrl(resolvedUrl);
  const note = buildAlertNote({ source, discoveredAt, trackingUrl, liveness });
  const offer = { url: resolvedUrl, company, title, note };

  // Gate 3 - dedup + append, owned by scan.mjs.
  try {
    if (dryRun) {
      const { toAdd, skippedUrl, skippedRole } = filterOffersForPipeline([offer], { pipelinePath });
      return {
        status: toAdd.length ? 'pending' : 'duplicate',
        url: resolvedUrl,
        trackingUrl,
        company,
        title,
        source,
        skippedUrl,
        skippedRole,
        reason: toAdd.length ? 'would append' : 'already in pipeline',
      };
    }

    const { added, skipped, skippedUrl, skippedRole } = await appendToPipeline([offer], { pipelinePath });
    return {
      status: added ? 'added' : 'duplicate',
      url: resolvedUrl,
      trackingUrl,
      company,
      title,
      source,
      added,
      skipped,
      skippedUrl,
      skippedRole,
      reason: added ? 'appended to Pending' : 'already in pipeline',
      ...(resolveError ? { resolveError } : {}),
    };
  } catch (err) {
    return {
      status: 'error',
      url: resolvedUrl,
      trackingUrl,
      source,
      reason: err?.message || String(err),
    };
  }
}

/**
 * Ingest a batch of alerts sequentially.
 *
 * Sequential on purpose: appendToPipeline() takes the pipeline lock per call, so
 * racing them would only serialize on the lock anyway while interleaving the
 * result order the caller reads back.
 *
 * @param {Array<object>} alerts
 * @param {object} [opts] - Forwarded to ingestAlert().
 * @returns {Promise<{results: object[], summary: object}>}
 */
export async function ingestAlerts(alerts, opts = {}) {
  const list = Array.isArray(alerts) ? alerts : [alerts];
  const results = [];
  for (const alert of list) {
    results.push(await ingestAlert(alert, opts));
  }
  return { results, summary: summarize(results) };
}

/**
 * Tally a result list by status.
 * @param {object[]} results
 * @returns {Record<string, number>}
 */
export function summarize(results) {
  const summary = {};
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  return summary;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { json: false, dryRun: false, skipLiveness: false, help: false, selfTest: false, file: null, pipelinePath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-liveness') opts.skipLiveness = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg.startsWith('--file=')) opts.file = arg.slice(7);
    else if (arg === '--pipeline') opts.pipelinePath = argv[++i];
    else if (arg.startsWith('--pipeline=')) opts.pipelinePath = arg.slice(11);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function parsePayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('no input: pass a JSON alert on stdin or use --file');
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Offline by construction: the resolver and the liveness core are both injected,
// so nothing here can reach the network, and the pipeline is a temp file so the
// real data/pipeline.md is never touched. Conventions follow the repository -
// isMainModule(import.meta.url), never a raw process.argv[1] comparison (#3170).

const SELF_TEST_TRACKING = 'https://track.example.net/click?id=abc&sub=linkedin';
const SELF_TEST_DIRECT = 'https://job-boards.greenhouse.io/acmecorp/jobs/1234567';
const SELF_TEST_EXPIRED = 'https://job-boards.greenhouse.io/deadco/jobs/999';
const SELF_TEST_UNRESOLVED = 'https://jobs.lever.co/brokenco/42';
const SELF_TEST_TRACKING_FAIL = 'https://jobs.lever.co/failco/9?utm_source=n8n&utm_campaign=daily';
const SELF_TEST_UNTRACKED_FAIL = 'https://jobs.lever.co/failco/9';

function selfTestResolver(trackingUrl) {
  if (trackingUrl === SELF_TEST_TRACKING) return SELF_TEST_DIRECT;
  if (trackingUrl === SELF_TEST_UNRESOLVED || trackingUrl === SELF_TEST_TRACKING_FAIL) {
    throw new Error('simulated network failure');
  }
  return trackingUrl;
}

function selfTestLiveness(url) {
  if (url === SELF_TEST_EXPIRED) return { result: 'expired', code: 'mock_gone', reason: 'simulated 410' };
  return { result: 'active', code: 'mock_live', reason: 'simulated 200' };
}

async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'stream-bridge-'));
  const pipelinePath = join(dir, 'pipeline.md');
  const base = { pipelinePath, resolveUrl: selfTestResolver, livenessCheck: selfTestLiveness };
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  try {
    // invalid payloads
    const noUrl = await ingestAlert({ title: 'T', source: 's' }, base);
    check('rejects missing url', noUrl.status === 'invalid' && noUrl.reason === 'missing url', noUrl.reason);
    const noTitle = await ingestAlert({ url: 'https://x.test/1', source: 's' }, base);
    check('rejects missing title', noTitle.status === 'invalid' && noTitle.reason === 'missing title', noTitle.reason);

    // A non-URL must be rejected up front, not allowed down the resolver's
    // degrade-to-original path, which would write an unopenable row.
    const badUrl = await ingestAlert({ url: 'not-a-url', title: 'T', source: 's' }, base);
    check('rejects a non-http(s) url', badUrl.status === 'invalid' && badUrl.reason.startsWith('not an http(s) URL'), JSON.stringify(badUrl));
    check('rejects a url with no scheme', (await ingestAlert({ url: 'job-boards.greenhouse.io/x', title: 'T', source: 's' }, base)).status === 'invalid', '');
    check('rejects a javascript: url', (await ingestAlert({ url: 'javascript:alert(1)', title: 'T', source: 's' }, base)).status === 'invalid', '');

    // first ingest appends, with the tracking URL resolved and company derived
    const first = await ingestAlert({ url: SELF_TEST_TRACKING, title: 'Senior PM', source: 'linkedin' }, base);
    check('appends new alert', first.status === 'added', JSON.stringify(first));

    const written = readFileSync(pipelinePath, 'utf-8');
    const directRow = written.split('\n').find(l => l.includes(SELF_TEST_DIRECT)) || '';
    // The url COLUMN must be the direct posting. The tracking URL is deliberately
    // preserved inside note: as provenance, so the check targets the row's leading
    // cell rather than the whole line.
    check(
      'url column carries the direct URL, not the tracking URL',
      directRow.startsWith(`- [ ] ${SELF_TEST_DIRECT}`) && !directRow.startsWith(`- [ ] ${SELF_TEST_TRACKING}`),
      directRow,
    );
    check('derives company from the ATS board slug', written.includes('| acmecorp |'), written.split('\n').find(l => l.includes(SELF_TEST_DIRECT)) || '');
    check('records provenance in a note: segment', written.includes('note: source=linkedin discovered='), '');
    check('row uses the canonical - [ ] prefix', /^- \[ \] https:\/\/job-boards\.greenhouse\.io\/acmecorp\/jobs\/1234567/m.test(written));

    // dedup: same posting arriving again is skipped, not duplicated
    const second = await ingestAlert({ url: SELF_TEST_TRACKING, title: 'Senior PM', source: 'linkedin' }, base);
    check('skips a repeated alert as duplicate', second.status === 'duplicate', JSON.stringify(second));
    const rows = written.split('\n').filter(l => l.includes(SELF_TEST_DIRECT));
    check('duplicate did not add a second row', rows.length === 1, `rows=${rows.length}`);

    // resolution failure degrades to the original URL instead of dropping the alert
    const degraded = await ingestAlert({ url: SELF_TEST_UNRESOLVED, title: 'Ops Lead', source: 'n8n' }, base);
    check('resolver failure still ingests the alert', degraded.status === 'added', JSON.stringify(degraded));
    check('falls back to the original URL', degraded.url === SELF_TEST_UNRESOLVED, degraded.url);
    check('reports the resolution error', typeof degraded.resolveError === 'string' && degraded.resolveError.includes('simulated'), String(degraded.resolveError));

    // When resolution fails, tracking parameters are still stripped from the
    // stored URL - only the redirect-chasing is lost, not the hygiene.
    const paramsKept = await ingestAlert({ url: SELF_TEST_TRACKING_FAIL, title: 'Ops Lead', source: 'n8n' }, base);
    check('strips tracking params when resolution fails', paramsKept.status === 'added' && paramsKept.url === SELF_TEST_UNTRACKED_FAIL, JSON.stringify(paramsKept.url));
    check('preserves the original as tracking provenance', paramsKept.trackingUrl === SELF_TEST_TRACKING_FAIL, String(paramsKept.trackingUrl));
    const failRow = readFileSync(pipelinePath, 'utf-8').split('\n').find(l => l.includes('failco/9')) || '';
    check(
      'no utm noise in the url column',
      failRow.startsWith('- [ ] https://jobs.lever.co/failco/9 |'),
      failRow,
    );

    // liveness gate: only a definitive expired drops the alert
    const dead = await ingestAlert({ url: SELF_TEST_EXPIRED, title: 'Ghost Role', source: 'linkedin' }, base);
    check('drops an expired posting', dead.status === 'expired', JSON.stringify(dead));
    check('expired posting is not written', !readFileSync(pipelinePath, 'utf-8').includes(SELF_TEST_EXPIRED));

    const skipped = await ingestAlert({ url: 'https://jobs.lever.co/liveco/7', title: 'PM', source: 's' }, { ...base, skipLiveness: true });
    check('--no-liveness still ingests', skipped.status === 'added', JSON.stringify(skipped));

    // dry-run reports without writing
    const before = readFileSync(pipelinePath, 'utf-8');
    const dry = await ingestAlert({ url: 'https://jobs.ashbyhq.com/newco/1', title: 'New', source: 's' }, { ...base, dryRun: true });
    check('dry-run reports pending', dry.status === 'pending', JSON.stringify(dry));
    check('dry-run writes nothing', readFileSync(pipelinePath, 'utf-8') === before);

    // batch + tally
    const { results, summary } = await ingestAlerts([
      { url: 'https://jobs.lever.co/batchco/1', title: 'A', source: 's' },
      { url: 'https://jobs.lever.co/batchco/2', title: 'B', source: 's' },
      { url: 'not-a-url', title: '' },
    ], base);
    check('batch processes every alert', results.length === 3, `results=${results.length}`);
    check('summary tallies statuses', summary.added === 2 && summary.invalid === 1, JSON.stringify(summary));

    // one invalid item does not abort the batch
    check('invalid item does not stop the batch', results[2].status === 'invalid' && results[0].status === 'added', JSON.stringify(results.map(r => r.status)));

    // deterministic timestamp via the injected clock
    const fixed = await ingestAlert(
      { url: 'https://jobs.lever.co/clockco/1', title: 'C', source: 's' },
      { ...base, now: () => new Date('2026-10-06T00:00:00.000Z') },
    );
    check('uses the injected clock', fixed.status === 'added' && readFileSync(pipelinePath, 'utf-8').includes('discovered=2026-10-06T00:00:00.000Z'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

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
      const raw = opts.file ? readFileSync(opts.file, 'utf-8') : await readStdin();
      const alerts = parsePayload(raw);
      const ingestOpts = { skipLiveness: opts.skipLiveness, dryRun: opts.dryRun };
      if (opts.pipelinePath) ingestOpts.pipelinePath = opts.pipelinePath;
      const { results, summary } = await ingestAlerts(alerts, ingestOpts);

      if (opts.json) {
        console.log(JSON.stringify({ results, summary }, null, 2));
      } else {
        for (const r of results) {
          const icon = r.status === 'added' ? '+' : r.status === 'duplicate' ? '=' : r.status === 'expired' ? '!' : '?';
          const detail = [r.reason, r.resolveError ? `unresolved: ${r.resolveError}` : ''].filter(Boolean).join('  ');
          console.log(`${icon} ${r.status.padEnd(9)} ${r.url || '(no url)'}${detail ? `  — ${detail}` : ''}`);
        }
        console.log(`\n${results.length} alert(s): ${Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      }

      if (summary.invalid > 0 || summary.error > 0) process.exitCode = 1;
    } catch (err) {
      console.error(`stream-bridge: ${err?.message || err}`);
      process.exitCode = 1;
    }
  })();
}
