#!/usr/bin/env node
// @ts-check
/**
 * seeds/employers-validate.mjs: the static gate for the employer registry in
 * employers/ at the repository root (pointers from an employer to its ATS
 * board; no postings, no personal data). See employers/README.md for the
 * format. The data is repo-only (not in SYSTEM_PATHS, so the updater does not
 * ship it); this validator is system code and ships like the rest of seeds/.
 *
 * Run from the root of a checkout:
 *   node seeds/employers-validate.mjs                    validate ./employers
 *   node seeds/employers-validate.mjs --base <dir>       also check what changed against
 *                                                        <dir>/employers (CI passes the
 *                                                        base branch checkout)
 *   node seeds/employers-validate.mjs --write-changelog  regenerate employers/CHANGELOG.md
 *                                                        from the manifests, then validate
 *                                                        (maintainers, on main)
 *   node seeds/employers-validate.mjs --inbox-only --base <ref> [--head <ref>]
 *                                                        print, as JSON, whether the diff
 *                                                        <ref>...HEAD only adds files to
 *                                                        employers/inbox/ (no validation)
 *
 * The contribution inbox, employers/inbox/ (seeds/employers-inbox.mjs), is
 * checked too: file names, at most 5,000 lines a file, the short line format,
 * a board URL that builds, no personal data, and each board once across the
 * inbox. A board that is already in boards/ is a warning, not an error:
 * maintainers drop it when they fold the inbox in (seeds/employers-fold.mjs).
 *
 * In GitHub Actions (GITHUB_ACTIONS=true) every finding is printed as a
 * workflow command (::error / ::warning with its file and line), so it shows up
 * on the pull request's diff, and a summary goes to GITHUB_STEP_SUMMARY.
 *
 * The registry is read from the current working directory. The rules come from
 * this file and the files it loads relative to itself (lib/ats-board-url.mjs,
 * data-static/aggregator-domains.txt), so CI runs the base branch's copy of the
 * validator against a pull request's data: a pull request cannot loosen the
 * gate that judges it. No network, no npm dependencies.
 *
 * Exit codes: 0 valid (warnings allowed), 1 at least one error, 2 usage error.
 */

import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOARD_ATS,
  REGIONAL_BOARD_URL_BUILDERS,
  REGIONS,
  SLUG_RE,
  WORKDAY_HOSTS,
  WORKDAY_INSTANCE_RE,
  WORKDAY_SEGMENT_RE,
  buildBoardUrl,
} from '../lib/ats-board-url.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import {
  INBOX_DIR,
  INBOX_LINE_KEYS,
  INBOX_LINE_REQUIRED,
  INBOX_MAX_LINES,
  inboxCareersUrl,
  inboxCoords,
  parseInboxName,
  recognizeInboxOnly,
  renderInboxOnlySummary,
} from './employers-inbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGGREGATOR_DOMAINS_PATH = join(HERE, '..', 'data-static', 'aggregator-domains.txt');

/** Where the registry lives, relative to the checkout root. */
export const REGISTRY_DIR = 'employers';

// ── The format (schema.json describes the same rules for editors; a test keeps them equal) ──

export const ROW_REQUIRED = Object.freeze(['ats', 'board', 'careers_url', 'name', 'source', 'contribution', 'added']);
export const ROW_KEYS = Object.freeze([
  'ats', 'region', 'board', 'workday_host', 'careers_url', 'name', 'website', 'countries', 'tags',
  'source', 'contribution', 'added', 'retired', 'retired_reason',
]);
export const MANIFEST_REQUIRED = Object.freeze([
  'id', 'contributor', 'signed_by', 'rows', 'source', 'origin', 'no_conflicting_contract', 'personal_data',
  'exclusive', 'license', 'also_permits', 'attribution', 'date',
]);
export const MANIFEST_KEYS = Object.freeze([
  'id', 'contributor', 'on_behalf_of', 'signed_by', 'rows', 'source', 'origin', 'no_conflicting_contract',
  'personal_data', 'exclusive', 'license', 'also_permits', 'attribution', 'date',
]);
export const RETIRED_REASONS = Object.freeze(['gone', 'owner_request', 'moved', 'duplicate', 'policy']);

// Where a row's pointer came from. A closed list: three fixed values and two
// parameterised forms.
export const FIXED_SOURCES = Object.freeze(['community', 'ats-directory', 'vc-portfolio']);
export const SOURCE_PATTERNS = Object.freeze({
  'employer-list': /^employer-list:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
  'prior-mit': /^prior-mit:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{7,40}$/,
});

export const LICENSE_ID = 'CC-BY-4.0';
export const ALSO_PERMITS = Object.freeze(['ODbL-1.0', 'CC0-1.0']);

// The tag vocabulary is not defined yet, so no tag is accepted. The key is
// reserved in the format so rows written later do not need a migration.
export const TAG_VOCABULARY = Object.freeze([]);

export const MANIFEST_ID_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/;
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const NAME_MAX = 80;
const SLUG_MIN = 2;
const SEGMENT_MAX = 64;

/**
 * boards/ size above which the validator warns (bytes). A warning, never an
 * error: the registry is repo-only, so its size costs a clone, not an update.
 * Past this mark a maintainer looks at how the data is stored.
 */
export const BOARDS_WARN_BYTES = 25 * 1024 * 1024;

const TOP_LEVEL = Object.freeze(['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'schema.json', 'contributions', 'boards']);
// inbox/ exists only while contributions wait to be folded in: git keeps no
// empty directory, so it is gone after each fold.
const OPTIONAL_TOP_LEVEL = Object.freeze(['inbox']);
const TOP_LEVEL_DIRS = new Set(['contributions', 'boards', 'inbox']);

// ATS whose board id is a subdomain label: their providers only match
// lowercase hosts, so the id is lowercase letters, digits and hyphens.
const SUBDOMAIN_ATS = new Set(['recruitee', 'breezy', 'bamboohr', 'pinpoint']);

// Values that turn up where a board id should be but never name a board:
// URL path words (Greenhouse's /embed/, Workday's /wday/cxs/) and placeholders.
const PLACEHOLDER_BOARDS = new Set([
  'embed', 'wday', 'jobs', 'careers', 'api', 'www', 'null', 'undefined', 'none', 'nan', 'test', 'example', 'exampleco',
]);

// ISO 3166-1 alpha-2, officially assigned codes.
const ISO_COUNTRIES = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)/i;
// Seven or more digits, optionally separated the way phone numbers are written.
// Dates and year ranges are taken out first (looksLikePhone): "2026-11-08" and
// "2019-2024" have as many digits as a phone number and are not one.
const PHONE_RE = /(?:\+|\b)\d(?:[\s().-]*\d){6,}/;
const DATE_LIKE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)\d{2}\b/g;
const looksLikePhone = (/** @type {string} */ text) => PHONE_RE.test(text.replace(DATE_LIKE_RE, ' '));
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const hasOwn = (/** @type {object} */ o, /** @type {string} */ k) => Object.hasOwn(o, k);
const show = (/** @type {unknown} */ v) => JSON.stringify(v);

// ── Single-value rules (exported for the import script and the tests) ──────

/**
 * Why `board` is not a valid board id for `ats`, or null when it is.
 * @param {string} ats
 * @param {unknown} board
 * @returns {string|null}
 */
export function boardProblem(ats, board) {
  if (typeof board !== 'string' || board === '') return 'board must be a non-empty string';
  if (ats === 'workday') return workdayBoardProblem(board);
  return slugProblem(ats, board, 'board');
}

/**
 * @param {string} ats
 * @param {string} slug
 * @param {string} label
 */
function slugProblem(ats, slug, label) {
  if (!SLUG_RE.test(slug)) return `${label} ${show(slug)} has characters outside [A-Za-z0-9._-]`;
  if (slug.length < SLUG_MIN) return `${label} ${show(slug)} is too short to be a board id`;
  if (slug.length > SEGMENT_MAX) return `${label} is ${slug.length} characters long; the limit is ${SEGMENT_MAX}`;
  if (!/^[A-Za-z0-9]/.test(slug) || !/[A-Za-z0-9]$/.test(slug)) return `${label} ${show(slug)} must start and end with a letter or digit`;
  if (slug.includes('..')) return `${label} ${show(slug)} contains ".."`;
  if (/^[0-9]+$/.test(slug)) return `${label} ${show(slug)} is numeric-only; ${ats} boards are named by a slug, not a number`;
  if (PLACEHOLDER_BOARDS.has(slug.toLowerCase())) return `${label} ${show(slug)} is a placeholder or a URL path word, not a board id`;
  if (SUBDOMAIN_ATS.has(ats)) {
    if (slug !== slug.toLowerCase()) return `${ats} ${label}s are lowercase (the id is a subdomain): use ${show(slug.toLowerCase())}`;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return `${ats} ${label}s are one subdomain label: lowercase letters, digits and hyphens`;
  }
  if (ats === 'rippling' && !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(slug)) return `rippling ${label}s are letters, digits and hyphens`;
  if (ats === 'workable' && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug)) return `workable ${label}s are letters, digits, "_" and "-"`;
  return null;
}

/** @param {string} board */
function workdayBoardProblem(board) {
  const parts = board.split('/');
  if (parts.length !== 3) return `workday board is "tenant/wdN/site", got ${show(board)}`;
  const [tenant, instance, site] = parts;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(tenant)) return `workday tenant ${show(tenant)} must be lowercase letters, digits, "_" or "-" (it is a host name label)`;
  if (tenant.length > SEGMENT_MAX) return `workday tenant is ${tenant.length} characters long; the limit is ${SEGMENT_MAX}`;
  if (/^[0-9]+$/.test(tenant)) return `workday tenant ${show(tenant)} is numeric-only`;
  if (PLACEHOLDER_BOARDS.has(tenant)) return `workday tenant ${show(tenant)} is a placeholder, not a tenant`;
  if (!WORKDAY_INSTANCE_RE.test(instance)) return `workday instance ${show(instance)} must be "wd" and a number (wd1, wd5, wd103)`;
  if (!WORKDAY_SEGMENT_RE.test(site)) return `workday site ${show(site)} has characters outside [A-Za-z0-9_-]`;
  if (site.length > SEGMENT_MAX) return `workday site is ${site.length} characters long; the limit is ${SEGMENT_MAX}`;
  if (site === 'wday') return 'workday site "wday" is the CXS API path, not a site';
  if (/^[a-z]{2}-[A-Z]{2}$/.test(site)) return `workday site ${show(site)} is a locale; the site is the path segment after it`;
  if (/^[0-9]+$/.test(site)) return `workday site ${show(site)} is numeric-only`;
  return null;
}

/**
 * @param {unknown} name
 * @returns {string|null}
 */
export function nameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'name must be a non-empty string';
  if (name !== name.trim()) return 'name has leading or trailing spaces';
  if (CONTROL_RE.test(name)) return 'name contains a control character or a line break';
  const length = [...name].length;
  if (length > NAME_MAX) return `name is ${length} characters long; the limit is ${NAME_MAX}`;
  if (EMAIL_RE.test(name)) return 'name contains an email address; rows hold no personal data';
  if (name.includes('@')) return 'name contains an @handle; rows hold no personal data';
  if (URL_RE.test(name)) return 'name contains a URL; the company name only';
  if (looksLikePhone(name)) return 'name contains a phone number; rows hold no personal data';
  return null;
}

/**
 * @param {unknown} website
 * @returns {string|null}
 */
export function websiteProblem(website) {
  if (typeof website !== 'string' || !website) return 'website must be a non-empty string';
  if (/^[a-z][a-z0-9+.-]*:/i.test(website) || /[/?#]/.test(website)) return `website ${show(website)} must be a bare domain (example.com), without scheme or path`;
  if (website !== website.toLowerCase()) return `website ${show(website)} must be lowercase`;
  if (website.startsWith('www.')) return `website ${show(website)} is the registrable domain, without "www."`;
  if (!DOMAIN_RE.test(website)) return `website ${show(website)} is not a domain name`;
  return null;
}

/**
 * @param {unknown} source
 * @returns {string|null}
 */
export function sourceProblem(source) {
  if (typeof source !== 'string') return 'source must be a string';
  if (FIXED_SOURCES.includes(source)) return null;
  if (Object.values(SOURCE_PATTERNS).some((re) => re.test(source))) return null;
  return `source ${show(source)} is not one of: ${FIXED_SOURCES.join(', ')}, employer-list:<org>, prior-mit:<owner>/<repo>@<commit>`;
}

/** @param {unknown} value */
function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Free text in a manifest: one line, bounded, no contact details.
 * @param {unknown} value
 * @param {string} key
 * @param {number} min
 * @param {number} max
 */
function textProblem(value, key, min, max) {
  if (typeof value !== 'string') return `${key} must be a string`;
  if (value !== value.trim()) return `${key} has leading or trailing spaces`;
  if (CONTROL_RE.test(value)) return `${key} contains a control character or a line break`;
  const length = [...value].length;
  if (length < min || length > max) return `${key} must be ${min} to ${max} characters long (it is ${length})`;
  if (EMAIL_RE.test(value)) return `${key} contains an email address`;
  if (looksLikePhone(value)) return `${key} contains a phone number`;
  return null;
}

/**
 * Whether `host` is an aggregator domain or a subdomain of one.
 * @param {string} host
 * @param {Set<string>} domains
 */
function aggregatorFor(host, domains) {
  const h = host.toLowerCase();
  for (const d of domains) if (h === d || h.endsWith(`.${d}`)) return d;
  return null;
}

/** The file a board's row lives in: boards/<ats>/<initial>.ndjson. */
export function boardInitial(/** @type {string} */ board) {
  return board.charAt(0).toLowerCase();
}

/**
 * Sort order inside a board file: board (case-insensitive, then exact), then
 * region, then workday_host. Plain code-unit comparison, so it does not depend
 * on the machine's locale.
 * @param {{board?: unknown, region?: unknown, workday_host?: unknown}} a
 * @param {{board?: unknown, region?: unknown, workday_host?: unknown}} b
 */
export function compareRows(a, b) {
  const key = (/** @type {any} */ r) => {
    const board = String(r.board ?? '');
    return [board.toLowerCase(), board, String(r.region ?? ''), String(r.workday_host ?? '')];
  };
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/**
 * What makes two rows the same board: the careers URL ignoring letter case and,
 * for Workday, the tenant/wdN/site whichever host form serves it.
 * @param {any} row
 */
export function boardIdentity(row) {
  if (row.ats === 'workday' && typeof row.board === 'string') return `workday:${row.board.toLowerCase()}`;
  return String(row.careers_url).toLowerCase();
}

/** Aggregator domains from data-static/aggregator-domains.txt (next to this validator). */
export function loadAggregatorDomains(path = AGGREGATOR_DOMAINS_PATH) {
  const out = new Set();
  for (const raw of readFileSync(path, 'utf8').replace(/\r/g, '').split('\n')) {
    const domain = raw.split('#')[0].trim().toLowerCase();
    if (domain) out.add(domain);
  }
  return out;
}

// ── CHANGELOG.md ────────────────────────────────────────────────────────

const CHANGELOG_HEADER = `# Employer registry changelog

One line per contribution, generated from \`contributions/*.json\`. A
contribution does not edit this file: maintainers regenerate it on main with
\`node seeds/employers-validate.mjs --write-changelog\`.
`;

/**
 * Render CHANGELOG.md from manifests: one line per contribution, oldest first,
 * crediting it with its own attribution.
 * @param {Array<any>} manifests
 */
export function renderChangelog(manifests) {
  const usable = manifests
    .filter((m) => m && typeof m === 'object' && typeof m.id === 'string' && typeof m.date === 'string')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = usable.map((m) => {
    const rows = Number.isInteger(m.rows) ? `${m.rows} board${m.rows === 1 ? '' : 's'}` : 'boards';
    return `- ${m.date} \`${m.id}\` (${rows}, source \`${m.source}\`): ${m.attribution}`;
  });
  return `${CHANGELOG_HEADER}\n${lines.length ? lines.join('\n') : '_No contributions yet._'}\n`;
}

// ── Reading a registry ──────────────────────────────────────────────────

/**
 * @typedef {{file: string, line: number, message: string}} Finding
 * @typedef {{file: string, line: number, row: any, dirAts: string, initial: string}} RowRecord
 * @typedef {{file: string, text: string, data: any}} ManifestRecord
 * @typedef {{exists: boolean, rows: RowRecord[], manifests: Map<string, ManifestRecord>, boardsBytes: number, boardFiles: number}} Registry
 */

/** @param {string} p */
function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

/**
 * Read the registry under `rootDir`. Structural problems go to `report` when
 * one is given (the registry under review); the base branch is read with no
 * reporter, as the reference it is.
 * @param {string} rootDir
 * @param {((file: string, line: number, message: string) => void) | null} report
 * @returns {Registry}
 */
function readRegistry(rootDir, report) {
  const err = report || (() => {});
  /** @type {Registry} */
  const reg = { exists: false, rows: [], manifests: new Map(), boardsBytes: 0, boardFiles: 0 };
  const dir = join(rootDir, REGISTRY_DIR);
  const st = lstatOrNull(dir);
  if (!st || !st.isDirectory()) {
    err(REGISTRY_DIR, 0, 'registry directory not found (run from the repository root)');
    return reg;
  }
  reg.exists = true;

  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    if (!TOP_LEVEL.includes(name) && !OPTIONAL_TOP_LEVEL.includes(name)) {
      err(`${REGISTRY_DIR}/${name}`, 0, `unexpected entry; the registry holds only ${[...TOP_LEVEL, ...OPTIONAL_TOP_LEVEL].join(', ')}`);
    }
  }
  for (const name of OPTIONAL_TOP_LEVEL) {
    const s = lstatOrNull(join(dir, name));
    const rel = `${REGISTRY_DIR}/${name}`;
    if (s?.isSymbolicLink()) err(rel, 0, 'must not be a symlink');
    else if (s && !s.isDirectory()) err(rel, 0, 'must be a directory');
  }
  for (const name of TOP_LEVEL) {
    const s = lstatOrNull(join(dir, name));
    const rel = `${REGISTRY_DIR}/${name}`;
    if (!s) err(rel, 0, 'missing');
    else if (s.isSymbolicLink()) err(rel, 0, 'must not be a symlink');
    else if (TOP_LEVEL_DIRS.has(name) !== s.isDirectory()) err(rel, 0, `must be a ${TOP_LEVEL_DIRS.has(name) ? 'directory' : 'file'}`);
  }

  const cdir = join(dir, 'contributions');
  if (lstatOrNull(cdir)?.isDirectory()) {
    for (const f of readdirSync(cdir).sort()) {
      if (f === '.DS_Store') continue;
      const rel = `${REGISTRY_DIR}/contributions/${f}`;
      const id = f.endsWith('.json') ? f.slice(0, -5) : '';
      if (!MANIFEST_ID_RE.test(id)) { err(rel, 0, 'manifests are named <YYYY-MM-DD>-<slug>.json (lowercase slug)'); continue; }
      if (!lstatOrNull(join(cdir, f))?.isFile()) { err(rel, 0, 'must be a regular file'); continue; }
      const text = readFileSync(join(cdir, f), 'utf8');
      let data = null;
      try { data = JSON.parse(text); } catch (e) { err(rel, 0, `not valid JSON: ${/** @type {Error} */ (e).message}`); }
      reg.manifests.set(id, { file: rel, text, data });
    }
  }

  const bdir = join(dir, 'boards');
  if (lstatOrNull(bdir)?.isDirectory()) {
    for (const ats of readdirSync(bdir).sort()) {
      if (ats === '.DS_Store') continue;
      const atsRel = `${REGISTRY_DIR}/boards/${ats}`;
      if (!BOARD_ATS.includes(ats)) { err(atsRel, 0, `unknown ATS directory; boards/ holds one directory per ATS: ${BOARD_ATS.join(', ')}`); continue; }
      if (!lstatOrNull(join(bdir, ats))?.isDirectory()) { err(atsRel, 0, 'must be a directory'); continue; }
      for (const f of readdirSync(join(bdir, ats)).sort()) {
        if (f === '.DS_Store') continue;
        const rel = `${atsRel}/${f}`;
        if (!/^[a-z0-9]\.ndjson$/.test(f)) { err(rel, 0, 'board files are named <initial>.ndjson: the first letter or digit of the board, lowercase'); continue; }
        if (!lstatOrNull(join(bdir, ats, f))?.isFile()) { err(rel, 0, 'must be a regular file'); continue; }
        const text = readFileSync(join(bdir, ats, f), 'utf8');
        reg.boardsBytes += Buffer.byteLength(text);
        reg.boardFiles += 1;
        if (text === '') { err(rel, 0, 'empty file; delete it'); continue; }
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        else err(rel, lines.length, 'the file must end with a newline');
        lines.forEach((raw, i) => {
          const line = i + 1;
          let content = raw;
          if (content.endsWith('\r')) { err(rel, line, 'CRLF line ending; use LF'); content = content.slice(0, -1); }
          if (!content.trim()) { err(rel, line, 'blank line'); return; }
          let row;
          try { row = JSON.parse(content); } catch (e) { err(rel, line, `not valid JSON: ${/** @type {Error} */ (e).message}`); return; }
          if (!row || typeof row !== 'object' || Array.isArray(row)) { err(rel, line, 'each line is one JSON object'); return; }
          reg.rows.push({ file: rel, line, row, dirAts: ats, initial: f.charAt(0) });
        });
      }
    }
  }
  return reg;
}

/**
 * @typedef {{file: string, parsed: import('./employers-inbox.mjs').InboxName, lines: Array<{line: number, row: any}>}} InboxFile
 * @typedef {{file: string, text: string, data: any, parsed: import('./employers-inbox.mjs').InboxName}} InboxSheet
 * @typedef {{files: InboxFile[], sheets: Map<string, InboxSheet>, lines: number}} Inbox
 */

/**
 * Read employers/inbox/ under `rootDir`: the boards files line by line, and
 * the manifests. A registry with no inbox has an empty one.
 * @param {string} rootDir
 * @param {((file: string, line: number, message: string) => void) | null} report
 * @returns {Inbox}
 */
export function readInbox(rootDir, report) {
  const err = report || (() => {});
  /** @type {Inbox} */
  const inbox = { files: [], sheets: new Map(), lines: 0 };
  const dir = join(rootDir, INBOX_DIR);
  const st = lstatOrNull(dir);
  if (!st || !st.isDirectory()) return inbox; // a symlink or a file is reported by readRegistry
  for (const f of readdirSync(dir).sort()) {
    if (f === '.DS_Store') continue;
    const rel = `${INBOX_DIR}/${f}`;
    const parsed = parseInboxName(f);
    if ('error' in parsed) { err(rel, 0, parsed.error); continue; }
    if (!lstatOrNull(join(dir, f))?.isFile()) { err(rel, 0, 'must be a regular file'); continue; }
    const text = readFileSync(join(dir, f), 'utf8');
    if (parsed.kind === 'sheet') {
      let data = null;
      try { data = JSON.parse(text); } catch (e) { err(rel, 0, `not valid JSON: ${/** @type {Error} */ (e).message}`); }
      inbox.sheets.set(parsed.id, { file: rel, text, data, parsed });
      continue;
    }
    if (text === '') { err(rel, 0, 'empty file; an inbox file holds at least one board'); continue; }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    else err(rel, lines.length, 'the file must end with a newline');
    if (lines.length > INBOX_MAX_LINES) {
      err(rel, INBOX_MAX_LINES + 1, `${lines.length} lines; an inbox file holds up to ${INBOX_MAX_LINES}: split the list into ${parsed.id}-001.ndjson, ${parsed.id}-002.ndjson, …`);
    }
    /** @type {InboxFile} */
    const rec = { file: rel, parsed, lines: [] };
    lines.forEach((raw, i) => {
      const line = i + 1;
      let content = raw;
      if (content.endsWith('\r')) { err(rel, line, 'CRLF line ending; use LF'); content = content.slice(0, -1); }
      if (!content.trim()) { err(rel, line, 'blank line'); return; }
      let row;
      try { row = JSON.parse(content); } catch (e) { err(rel, line, `not valid JSON: ${/** @type {Error} */ (e).message}`); return; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { err(rel, line, 'each line is one JSON object'); return; }
      rec.lines.push({ line, row });
    });
    inbox.lines += rec.lines.length;
    inbox.files.push(rec);
  }
  return inbox;
}

/**
 * Problems with one inbox line: {"ats","board","name"} and, optionally,
 * "website", plus "region" (greenhouse, lever) or "workday_host" (workday) when
 * the board is not on the default host. Empty when the line is valid.
 * @param {any} line
 * @param {Set<string>} [aggregatorDomains]
 * @returns {string[]}
 */
export function inboxLineProblems(line, aggregatorDomains = loadAggregatorDomains()) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return ['each line is one JSON object'];
  const out = [];
  for (const k of Object.keys(line)) if (!INBOX_LINE_KEYS.includes(k)) out.push(`unknown key ${show(k)}; an inbox line has only ${INBOX_LINE_KEYS.join(', ')}`);
  for (const k of INBOX_LINE_REQUIRED) if (!hasOwn(line, k)) out.push(`missing required key ${show(k)}`);

  const atsOk = typeof line.ats === 'string' && BOARD_ATS.includes(line.ats);
  if (hasOwn(line, 'ats') && !atsOk) out.push(`ats ${show(line.ats)} is not one of: ${BOARD_ATS.join(', ')}`);
  if (atsOk && hasOwn(line, 'region')) {
    if (!hasOwn(REGIONAL_BOARD_URL_BUILDERS, line.ats)) out.push(`region is only used on ${Object.keys(REGIONAL_BOARD_URL_BUILDERS).join(' and ')} boards`);
    else if (!REGIONS.includes(line.region)) out.push(`region ${show(line.region)} is not one of: ${REGIONS.join(', ')}`);
  }
  if (atsOk && hasOwn(line, 'workday_host')) {
    if (line.ats !== 'workday') out.push('workday_host is only used on workday boards');
    else if (!WORKDAY_HOSTS.includes(line.workday_host)) out.push(`workday_host ${show(line.workday_host)} is not one of: ${WORKDAY_HOSTS.join(', ')}`);
  }

  if (hasOwn(line, 'board')) {
    const p = atsOk ? boardProblem(line.ats, line.board) : (typeof line.board === 'string' ? null : 'board must be a string');
    if (p) out.push(p);
  }
  if (out.length === 0) {
    const url = inboxCareersUrl(line);
    if (!url) out.push(`ats ${show(line.ats)} and board ${show(line.board)} do not build a board URL`);
    else {
      const agg = aggregatorFor(new URL(url).hostname, aggregatorDomains);
      if (agg) out.push(`the board URL is on ${agg}, an aggregator (data-static/aggregator-domains.txt)`);
    }
  }

  if (hasOwn(line, 'name')) {
    const p = nameProblem(line.name);
    if (p) out.push(p);
  }
  if (hasOwn(line, 'website')) {
    const p = websiteProblem(line.website);
    if (p) out.push(p);
    else {
      const agg = aggregatorFor(line.website, aggregatorDomains);
      if (agg) out.push(`website ${show(line.website)} is an aggregator (data-static/aggregator-domains.txt), not the employer's site`);
    }
  }
  return out;
}

/** How many line numbers a warning lists before it says "…". */
const KNOWN_LINES_SHOWN = 20;

/**
 * Validate the inbox against the registry it sits in. Errors: a bad name, a
 * bad line, a file over the limit, a board listed twice in the inbox, a
 * manifest that does not fit its boards files. Warning: boards already in
 * boards/ (one warning per file, however many lines), which the fold skips.
 * @param {Inbox} inbox
 * @param {RowRecord[]} storeRows
 * @param {{err: (file: string, line: number, message: string) => void, warn: (file: string, line: number, message: string) => void, aggregatorDomains: Set<string>, latestDate: string}} ctx
 * @returns {number} how many inbox lines are already in the registry
 */
function checkInbox(inbox, storeRows, { err, warn, aggregatorDomains, latestDate }) {
  /** @type {Map<string, RowRecord>} */
  const store = new Map();
  for (const r of storeRows) {
    if (typeof r.row.careers_url === 'string' && !store.has(boardIdentity(r.row))) store.set(boardIdentity(r.row), r);
  }
  /** @type {Map<string, {file: string, line: number}>} */
  const seen = new Map();
  /** @type {Map<string, number>} */
  const linesPerId = new Map();
  let knownTotal = 0;

  for (const f of inbox.files) {
    if (f.parsed.date > latestDate) err(f.file, 0, `the date in the file name, ${f.parsed.date}, is in the future`);
    linesPerId.set(f.parsed.id, (linesPerId.get(f.parsed.id) || 0) + f.lines.length);
    /** @type {number[]} */
    const known = [];
    for (const { line, row } of f.lines) {
      const problems = inboxLineProblems(row, aggregatorDomains);
      for (const p of problems) err(f.file, line, p);
      if (problems.length) continue;
      const identity = boardIdentity({ ...inboxCoords(row), careers_url: inboxCareersUrl(row) });
      const first = seen.get(identity);
      if (first) { err(f.file, line, `the same board as ${first.file}:${first.line}; list a board once`); continue; }
      seen.set(identity, { file: f.file, line });
      if (store.has(identity)) known.push(line);
    }
    if (known.length) {
      knownTotal += known.length;
      const shown = known.slice(0, KNOWN_LINES_SHOWN).join(', ') + (known.length > KNOWN_LINES_SHOWN ? ', …' : '');
      warn(f.file, known[0], `${known.length} board${known.length === 1 ? ' is' : 's are'} already in the registry and will be skipped when the inbox is folded in (line${known.length === 1 ? '' : 's'} ${shown})`);
    }
  }

  for (const [id, s] of inbox.sheets) {
    if (s.parsed.date > latestDate) err(s.file, 0, `the date in the file name, ${s.parsed.date}, is in the future`);
    if (!linesPerId.has(id)) err(s.file, 0, `a manifest with no boards: add ${id}.ndjson (or ${id}-001.ndjson, …) next to it`);
    if (s.data === null) continue; // already reported as invalid JSON
    const lines = linesPerId.get(id) || 0;
    for (const p of manifestProblems(id, s.data, lines, latestDate, 'line(s) are in its inbox files')) err(s.file, 0, p);
    const c = s.data && typeof s.data === 'object' ? s.data.contributor : undefined;
    if (typeof c === 'string' && GITHUB_LOGIN_RE.test(c) && c.toLowerCase() !== s.parsed.login) {
      err(s.file, 0, `contributor ${show(c)} is not the login in the file name (${s.parsed.login})`);
    }
  }
  return knownTotal;
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Problems with one manifest.
 * @param {string} id  the id from the file name
 * @param {any} m
 * @param {number} rowCount  rows that name this contribution
 * @param {string} latestDate  the latest acceptable date (YYYY-MM-DD)
 * @param {string} [counted]  what rowCount counts, for the message
 * @returns {string[]}
 */
function manifestProblems(id, m, rowCount, latestDate, counted = 'row(s) name this contribution') {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['a manifest is one JSON object'];
  const out = [];
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.includes(k)) out.push(`unknown key ${show(k)}`);
  for (const k of MANIFEST_REQUIRED) if (!hasOwn(m, k)) out.push(`missing required key ${show(k)}`);
  if (hasOwn(m, 'id') && m.id !== id) out.push(`id ${show(m.id)} does not match the file name (${id}.json)`);
  if (hasOwn(m, 'contributor') && (typeof m.contributor !== 'string' || !GITHUB_LOGIN_RE.test(m.contributor))) {
    out.push('contributor must be the GitHub username of the account that opens the pull request (no @)');
  }
  for (const [key, min, max] of /** @type {const} */ ([['signed_by', 2, 120], ['on_behalf_of', 2, 120], ['origin', 10, 400], ['attribution', 3, 200]])) {
    if (!hasOwn(m, key)) continue;
    const p = textProblem(m[key], key, min, max);
    if (p) out.push(p);
  }
  if (hasOwn(m, 'rows')) {
    if (!Number.isInteger(m.rows) || m.rows < 1) out.push('rows must be a positive integer');
    else if (m.rows !== rowCount) out.push(`rows is ${m.rows}, but ${rowCount} ${counted}`);
  }
  if (hasOwn(m, 'source')) {
    const p = sourceProblem(m.source);
    if (p) out.push(p);
  }
  if (hasOwn(m, 'no_conflicting_contract') && m.no_conflicting_contract !== true) {
    out.push('no_conflicting_contract must be true: no contract may stop this list from being redistributed');
  }
  if (hasOwn(m, 'personal_data') && m.personal_data !== false) out.push('personal_data must be false: the registry holds no personal data');
  if (hasOwn(m, 'exclusive') && m.exclusive !== false) out.push('exclusive must be false: a contribution cannot be exclusive to anyone');
  if (hasOwn(m, 'license') && m.license !== LICENSE_ID) out.push(`license must be ${show(LICENSE_ID)}`);
  if (hasOwn(m, 'also_permits')) {
    const v = m.also_permits;
    const ok = Array.isArray(v) && v.length === ALSO_PERMITS.length && ALSO_PERMITS.every((x) => v.includes(x));
    if (!ok) out.push(`also_permits must be ${show(ALSO_PERMITS)}`);
  }
  if (hasOwn(m, 'date')) {
    if (!isIsoDate(m.date)) out.push(`date ${show(m.date)} is not a YYYY-MM-DD calendar date`);
    else {
      const idDate = MANIFEST_ID_RE.exec(id)?.[1];
      if (idDate && m.date !== idDate) out.push(`date ${m.date} does not match the date in the id (${idDate})`);
      if (m.date > latestDate) out.push(`date ${m.date} is in the future`);
    }
  }
  return out;
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Validate the registry under `root` (and, with `base`, what changed relative
 * to the registry under `base`).
 *
 * @param {{root?: string, base?: string|null, aggregatorDomains?: Set<string>, today?: Date, boardsWarnBytes?: number}} [opts]
 * @returns {{errors: Finding[], warnings: Finding[], stats: {rows: number, files: number, contributions: number, boardsBytes: number, baseFound: boolean|null, inboxFiles: number, inboxLines: number, inboxKnown: number}}}
 */
export function validateRegistry({
  root = process.cwd(), base = null, aggregatorDomains = loadAggregatorDomains(), today = new Date(), boardsWarnBytes = BOARDS_WARN_BYTES,
} = {}) {
  /** @type {Finding[]} */
  const errors = [];
  /** @type {Finding[]} */
  const warnings = [];
  const err = (/** @type {string} */ file, /** @type {number} */ line, /** @type {string} */ message) => errors.push({ file, line, message });
  const warn = (/** @type {string} */ file, /** @type {number} */ line, /** @type {string} */ message) => warnings.push({ file, line, message });

  // A contributor ahead of UTC can write tomorrow's date; anything later is wrong.
  const latestDate = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

  const head = readRegistry(root, err);
  // The base branch, read up front: when a pull request adds a second spelling
  // of a board, the row already merged is the one that stays.
  const prev = base ? readRegistry(base, null) : null;
  /** @type {Set<string>} */
  const prevUrls = new Set((prev?.rows || []).map((r) => r.row.careers_url).filter((u) => typeof u === 'string'));

  /** @type {Map<string, number>} */
  const rowsPerContribution = new Map();
  for (const { row } of head.rows) {
    if (typeof row.contribution === 'string') rowsPerContribution.set(row.contribution, (rowsPerContribution.get(row.contribution) || 0) + 1);
  }

  /** @type {Map<string, any>} id → manifest data, for manifests with no problems */
  const validManifests = new Map();
  for (const [id, m] of head.manifests) {
    if (m.data === null) continue; // already reported as invalid JSON
    const problems = manifestProblems(id, m.data, rowsPerContribution.get(id) || 0, latestDate);
    for (const p of problems) err(m.file, 0, p);
    if (problems.length === 0) validManifests.set(id, m.data);
  }

  /** @type {Map<string, RowRecord>} */
  const byUrl = new Map();
  // One board, several spellings: careers_url in another letter case, or a
  // Workday board under both host forms. Grouped here, judged after the loop.
  /** @type {Map<string, RowRecord[]>} */
  const byIdentity = new Map();
  /** @type {Map<string, RowRecord>} */
  const byWebsite = new Map();
  /** @type {Map<string, RowRecord>} */
  const previousInFile = new Map();

  for (const rec of head.rows) {
    const { row, file, line } = rec;
    const e = (/** @type {string} */ message) => err(file, line, message);

    for (const k of Object.keys(row)) if (!ROW_KEYS.includes(k)) e(`unknown key ${show(k)}`);
    for (const k of ROW_REQUIRED) if (!hasOwn(row, k)) e(`missing required key ${show(k)}`);

    const atsOk = typeof row.ats === 'string' && BOARD_ATS.includes(row.ats);
    if (hasOwn(row, 'ats') && !atsOk) e(`ats ${show(row.ats)} is not one of: ${BOARD_ATS.join(', ')}`);
    else if (atsOk && row.ats !== rec.dirAts) e(`ats ${show(row.ats)} is filed under boards/${rec.dirAts}/; a row lives under boards/<its ats>/`);

    if (atsOk && hasOwn(REGIONAL_BOARD_URL_BUILDERS, row.ats)) {
      if (!hasOwn(row, 'region')) e(`region is required on ${row.ats} rows: ${REGIONS.join(' or ')}`);
      else if (!REGIONS.includes(row.region)) e(`region ${show(row.region)} is not one of: ${REGIONS.join(', ')}`);
    } else if (atsOk && hasOwn(row, 'region')) {
      e(`region is only used on ${Object.keys(REGIONAL_BOARD_URL_BUILDERS).join(' and ')} rows`);
    }

    if (row.ats === 'workday') {
      if (!hasOwn(row, 'workday_host')) e(`workday_host is required on workday rows: ${WORKDAY_HOSTS.join(' or ')}`);
      else if (!WORKDAY_HOSTS.includes(row.workday_host)) e(`workday_host ${show(row.workday_host)} is not one of: ${WORKDAY_HOSTS.join(', ')}`);
    } else if (atsOk && hasOwn(row, 'workday_host')) {
      e('workday_host is only used on workday rows');
    }

    let boardOk = false;
    if (hasOwn(row, 'board')) {
      const p = atsOk ? boardProblem(row.ats, row.board) : (typeof row.board === 'string' ? null : 'board must be a string');
      if (p) e(p);
      else boardOk = atsOk;
      if (boardOk && boardInitial(row.board) !== rec.initial) {
        e(`board ${show(row.board)} belongs in ${boardInitial(row.board)}.ndjson, not ${rec.initial}.ndjson`);
      }
    }

    if (hasOwn(row, 'careers_url')) {
      if (typeof row.careers_url !== 'string') e('careers_url must be a string');
      else {
        const expected = boardOk ? buildBoardUrl(row) : null;
        if (expected && row.careers_url !== expected) {
          e(`careers_url ${show(row.careers_url)} is not the canonical URL for this board; expected ${show(expected)}`);
        }
        let host = '';
        try { host = new URL(row.careers_url).hostname; } catch { /* reported by the canonical check */ }
        const agg = host && aggregatorFor(host, aggregatorDomains);
        if (agg) e(`careers_url is on ${agg}, an aggregator (data-static/aggregator-domains.txt); the registry points at employer boards only`);

        const first = byUrl.get(row.careers_url);
        if (first) e(`duplicate careers_url, already at ${first.file}:${first.line}`);
        else {
          byUrl.set(row.careers_url, rec);
          const identity = boardIdentity(row);
          byIdentity.set(identity, [...(byIdentity.get(identity) || []), rec]);
        }
      }
    }

    if (hasOwn(row, 'name')) {
      const p = nameProblem(row.name);
      if (p) e(p);
    }

    if (hasOwn(row, 'website')) {
      const p = websiteProblem(row.website);
      if (p) e(p);
      else {
        const agg = aggregatorFor(row.website, aggregatorDomains);
        if (agg) e(`website ${show(row.website)} is an aggregator (data-static/aggregator-domains.txt), not the employer's site`);
        const first = byWebsite.get(row.website);
        if (first) warn(file, line, `website ${show(row.website)} is also on ${first.file}:${first.line}; one company can have several boards, so check this is not a duplicate`);
        else byWebsite.set(row.website, rec);
      }
    }

    if (hasOwn(row, 'countries')) {
      const c = row.countries;
      if (!Array.isArray(c) || c.length === 0) e('countries must be a non-empty array of ISO 3166-1 alpha-2 codes');
      else {
        const bad = c.filter((x) => typeof x !== 'string' || !ISO_COUNTRIES.has(x));
        if (bad.length) e(`countries has codes that are not ISO 3166-1 alpha-2 (uppercase): ${bad.map(show).join(', ')}`);
        else if (new Set(c).size !== c.length) e('countries lists a code twice');
      }
    }

    if (hasOwn(row, 'tags')) {
      const c = row.tags;
      const bad = Array.isArray(c) ? c.filter((x) => !TAG_VOCABULARY.includes(x)) : [c];
      if (!Array.isArray(c) || bad.length) {
        e(TAG_VOCABULARY.length ? `tags must come from: ${TAG_VOCABULARY.join(', ')}` : 'tags are not accepted yet: the tag vocabulary is not defined');
      }
    }

    if (hasOwn(row, 'source')) {
      const p = sourceProblem(row.source);
      if (p) e(p);
    }

    let manifest = null;
    if (hasOwn(row, 'contribution')) {
      const id = row.contribution;
      if (typeof id !== 'string' || !MANIFEST_ID_RE.test(id)) e(`contribution ${show(id)} is not a manifest id (<YYYY-MM-DD>-<slug>)`);
      else if (!head.manifests.has(id)) e(`contribution ${show(id)} has no manifest at contributions/${id}.json`);
      else manifest = validManifests.get(id) || null;
    }
    if (manifest && sourceProblem(row.source) === null && row.source !== manifest.source) {
      e(`source ${show(row.source)} differs from its manifest's source ${show(manifest.source)}`);
    }

    if (hasOwn(row, 'added')) {
      if (!isIsoDate(row.added)) e(`added ${show(row.added)} is not a YYYY-MM-DD calendar date`);
      else if (row.added > latestDate) e(`added ${row.added} is in the future`);
      else if (manifest && row.added < manifest.date) e(`added ${row.added} is earlier than its contribution (${manifest.date})`);
    }

    if (hasOwn(row, 'retired') && row.retired !== true) e('retired is either true or absent');
    if (hasOwn(row, 'retired_reason') && !RETIRED_REASONS.includes(row.retired_reason)) {
      e(`retired_reason ${show(row.retired_reason)} is not one of: ${RETIRED_REASONS.join(', ')}`);
    }
    if (row.retired === true && !hasOwn(row, 'retired_reason')) e(`a retired row needs retired_reason: ${RETIRED_REASONS.join(', ')}`);
    if (hasOwn(row, 'retired_reason') && !hasOwn(row, 'retired')) e('retired_reason needs retired: true');

    const before = previousInFile.get(file);
    if (before && compareRows(before.row, row) > 0) {
      e(`out of order: rows are sorted by board, and ${show(row.board)} sorts before ${show(before.row.board)} on line ${before.line}`);
    }
    previousInFile.set(file, rec);
  }

  for (const group of byIdentity.values()) {
    if (group.length < 2) continue;
    // The row already on the base branch keeps its spelling; otherwise the first in file order.
    const keeper = group.find((r) => prevUrls.has(r.row.careers_url)) || group[0];
    const kept = prevUrls.has(keeper.row.careers_url) ? ', which is already merged and keeps its spelling' : '';
    for (const r of group) {
      if (r === keeper) continue;
      const sameUrl = r.row.careers_url.toLowerCase() === keeper.row.careers_url.toLowerCase();
      err(r.file, r.line, sameUrl
        ? `careers_url differs only in letter case from ${keeper.file}:${keeper.line}${kept}; that is the same board`
        : `the same Workday board as ${keeper.file}:${keeper.line}${kept}, under the other host form; list a board once`);
    }
  }

  for (const [id, m] of head.manifests) {
    if (m.data !== null && !rowsPerContribution.has(id)) {
      // manifestProblems already reports rows ≠ 0; this names the cause.
      warn(m.file, 0, 'no row names this contribution');
    }
  }

  const inbox = readInbox(root, err);
  const inboxKnown = checkInbox(inbox, head.rows, { err, warn, aggregatorDomains, latestDate });

  // CHANGELOG.md is not compared with the manifests: a contribution does not
  // touch it, and maintainers regenerate it on main (--write-changelog).
  if (head.exists && head.boardsBytes > boardsWarnBytes) {
    const mb = (/** @type {number} */ n) => `${Number((n / 1048576).toFixed(2))} MB`;
    warn(`${REGISTRY_DIR}/boards`, 0, `boards/ is ${mb(head.boardsBytes)}, above ${mb(boardsWarnBytes)}; a maintainer should check how the registry is stored`);
  }

  let baseFound = null;
  if (prev) {
    baseFound = prev.exists;
    const added = new Set([...head.manifests.keys()].filter((id) => !prev.manifests.has(id)));
    const contributionPr = added.size > 0;

    for (const [id, pm] of prev.manifests) {
      const hm = head.manifests.get(id);
      if (!hm) err(pm.file, 0, 'manifest removed; contributions are never deleted');
      else if (hm.text !== pm.text) warn(hm.file, 0, 'edits a manifest that is already merged; a maintainer has to review the change');
    }

    /** @type {Map<string, RowRecord>} */
    const prevByUrl = new Map();
    for (const r of prev.rows) if (typeof r.row.careers_url === 'string') prevByUrl.set(r.row.careers_url, r);
    const headUrls = new Set(head.rows.map((r) => r.row.careers_url));
    for (const [url, r] of prevByUrl) {
      if (!headUrls.has(url)) {
        err(r.file, 0, `row ${url} (line ${r.line} on the base branch) was removed; rows are retired (retired: true, retired_reason), never deleted`);
      }
    }

    for (const rec of head.rows) {
      const { row } = rec;
      const e = (/** @type {string} */ message) => err(rec.file, rec.line, message);
      if (typeof row.careers_url !== 'string') continue;
      const old = prevByUrl.get(row.careers_url);
      if (!old) {
        if (typeof row.contribution === 'string' && !added.has(row.contribution)) {
          e(`new row names contribution ${show(row.contribution)}, which is already merged; new rows come with their own manifest, added in the same pull request`);
        }
        if (hasOwn(row, 'retired') || hasOwn(row, 'retired_reason')) {
          e('a new row cannot be retired; maintainers retire existing rows');
        }
        continue;
      }
      for (const k of ['contribution', 'source', 'added']) {
        if (!same(old.row[k], row[k])) e(`changes ${k} of an existing row (was ${show(old.row[k])}); provenance is fixed once merged`);
      }
      const retiredChanged = !same(old.row.retired, row.retired) || !same(old.row.retired_reason, row.retired_reason);
      if (retiredChanged && contributionPr) {
        e('a contribution pull request (it adds a manifest) cannot change retired or retired_reason; retiring is a separate maintainer change');
      }
      if (contributionPr && ['name', 'website', 'countries', 'tags'].some((k) => !same(old.row[k], row[k]))) {
        warn(rec.file, rec.line, 'a contribution pull request also edits this existing row');
      }
    }
  }

  const byPlace = (/** @type {Finding} */ a, /** @type {Finding} */ b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  errors.sort(byPlace);
  warnings.sort(byPlace);
  return {
    errors,
    warnings,
    stats: {
      rows: head.rows.length, files: head.boardFiles, contributions: head.manifests.size, boardsBytes: head.boardsBytes, baseFound,
      inboxFiles: inbox.files.length + inbox.sheets.size, inboxLines: inbox.lines, inboxKnown,
    },
  };
}

/**
 * Regenerate CHANGELOG.md under `root` from its manifests.
 * @param {string} root
 * @returns {string} the path written
 */
export function writeChangelog(root) {
  const reg = readRegistry(root, null);
  const path = join(root, REGISTRY_DIR, 'CHANGELOG.md');
  writeFileSync(path, renderChangelog([...reg.manifests.values()].map((m) => m.data)));
  return path;
}

// ── CLI ─────────────────────────────────────────────────────────────────

const USAGE = `Usage: node seeds/employers-validate.mjs [--base <dir>] [--write-changelog]
       node seeds/employers-validate.mjs --inbox-only --base <ref> [--head <ref>]

  Validates employers/ in the current directory (run it from the repository root).

  --base <dir>        also check the changes against <dir>/employers: rows are never
                      deleted, provenance never changes, new rows come with a new manifest,
                      and a contribution does not retire rows. A <dir> without a registry
                      counts as an empty one.
  --write-changelog   regenerate employers/CHANGELOG.md from contributions/, then validate.
                      For maintainers on main: a contribution does not edit CHANGELOG.md.
  --inbox-only        do not validate: print, as one JSON object, whether every change in
                      git diff <base>...<head> adds a new, validly named file directly
                      under employers/inbox/ (status A only: no modify, delete or rename),
                      and which files. Here --base is a git ref, and --head defaults to
                      HEAD. Exit 0 whatever the answer; 2 when git cannot diff.
  --help              show this text.`;

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { base: /** @type {string|null} */ (null), head: /** @type {string|null} */ (null), writeChangelog: false, inboxOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--write-changelog') opts.writeChangelog = true;
    else if (a === '--inbox-only') opts.inboxOnly = true;
    else if (a === '--head') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--head needs a git ref');
      opts.head = v;
    } else if (a.startsWith('--head=')) opts.head = a.slice('--head='.length);
    else if (a === '--base') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--base needs a directory');
      opts.base = v;
    } else if (a.startsWith('--base=')) opts.base = a.slice('--base='.length);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.inboxOnly && !opts.base) throw new Error('--inbox-only needs --base <ref>');
  if (opts.inboxOnly && opts.writeChangelog) throw new Error('--inbox-only does not validate or write anything; drop --write-changelog');
  if (opts.head && !opts.inboxOnly) throw new Error('--head is only used with --inbox-only');
  return opts;
}

/** @param {Finding} f */
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);

// ── GitHub Actions output ───────────────────────────────────────────────
// Workflow commands: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
// The escaping is the one @actions/core applies: the message escapes %, CR
// and LF; a property value (file=) also escapes ":" and ",".

/** @param {string} text */
export const escapeCommandData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** @param {string} text */
export const escapeCommandProperty = (text) => escapeCommandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * One finding as a workflow command. A finding about a whole file (line 0)
 * carries no line.
 * @param {'error'|'warning'} level
 * @param {Finding} f
 */
export function annotation(level, f) {
  const props = [`file=${escapeCommandProperty(f.file)}`];
  if (f.line) props.push(`line=${f.line}`);
  return `::${level} ${props.join(',')}::${escapeCommandData(f.message)}`;
}

/** How many findings the step summary lists; the job log has every one. */
export const SUMMARY_MAX_FINDINGS = 50;

/** Text from the registry, made inert inside a markdown table cell. @param {string} text */
const escapeMarkdown = (text) => text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>|#~!]/g, (c) => `\\${c}`);

/**
 * The markdown summary written to GITHUB_STEP_SUMMARY: the counts, then a table
 * of the first SUMMARY_MAX_FINDINGS findings, errors first.
 * @param {{errors: Finding[], warnings: Finding[], stats: {rows: number, files: number, contributions: number, inboxFiles?: number, inboxLines?: number, inboxKnown?: number}}} result
 */
export function renderStepSummary({ errors, warnings, stats }) {
  const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const lines = ['## Employer registry', ''];
  const counts = `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`;
  lines.push(errors.length
    ? `**Failed**: ${counts}.`
    : `**Valid**: ${plural(stats.rows, 'row')} in ${plural(stats.files, 'file')}, ${plural(stats.contributions, 'contribution')}; ${counts}.`);
  if (stats.inboxFiles) {
    lines.push('', `Inbox: ${plural(stats.inboxLines || 0, 'board')} in ${plural(stats.inboxFiles, 'file')}, ${stats.inboxKnown || 0} already in the registry.`);
  }
  const findings = [
    ...errors.map((f) => ({ level: 'error', f })),
    ...warnings.map((f) => ({ level: 'warning', f })),
  ];
  if (findings.length) {
    lines.push('', '| Level | File | Line | Message |', '|---|---|---|---|');
    for (const { level, f } of findings.slice(0, SUMMARY_MAX_FINDINGS)) {
      lines.push(`| ${level} | ${escapeMarkdown(f.file)} | ${f.line || ''} | ${escapeMarkdown(f.message)} |`);
    }
    if (findings.length > SUMMARY_MAX_FINDINGS) {
      lines.push('', `${findings.length - SUMMARY_MAX_FINDINGS} more in the job log.`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * --inbox-only: print the recognition as JSON; in GitHub Actions also write it
 * to the step's outputs (inbox_only, inbox_files, inbox_logins) and summary.
 * @param {string} base
 * @param {string} head
 */
function mainInboxOnly(base, head) {
  let result;
  try {
    result = recognizeInboxOnly({ base, head });
  } catch (e) {
    console.error(`employers-validate: ${/** @type {Error} */ (e).message}`);
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const write = (/** @type {string|undefined} */ path, /** @type {string} */ text, /** @type {string} */ what) => {
    if (!path) return;
    try { appendFileSync(path, text); } catch (e) { console.error(`employers-validate: could not write the ${what}: ${/** @type {Error} */ (e).message}`); }
  };
  write(process.env.GITHUB_OUTPUT, [
    `inbox_only=${result.inboxOnly}`,
    `inbox_files=${JSON.stringify(result.files)}`,
    `inbox_logins=${JSON.stringify(result.logins)}`,
  ].join('\n') + '\n', 'step outputs');
  write(process.env.GITHUB_STEP_SUMMARY, renderInboxOnlySummary(result), 'step summary');
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`employers-validate: ${/** @type {Error} */ (e).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.inboxOnly) {
    mainInboxOnly(/** @type {string} */ (opts.base), opts.head || 'HEAD');
    return;
  }
  const root = process.cwd();
  if (opts.writeChangelog) {
    const path = writeChangelog(root);
    console.log(`wrote ${path}`);
  }
  const base = opts.base ? resolve(root, opts.base) : null;
  if (base && !existsSync(base)) {
    console.error(`employers-validate: --base ${opts.base} does not exist`);
    process.exit(2);
  }
  const { errors, warnings, stats } = validateRegistry({ root, base });
  if (base && stats.baseFound === false) {
    console.log(`base ${opts.base} has no ${REGISTRY_DIR}/ yet: every row and manifest counts as new`);
  }
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  if (inActions) {
    // Workflow commands go to stdout, where the runner reads them.
    for (const w of warnings) console.log(annotation('warning', w));
    for (const e of errors) console.log(annotation('error', e));
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, renderStepSummary({ errors, warnings, stats }));
      } catch (e) {
        console.error(`employers-validate: could not write the step summary: ${/** @type {Error} */ (e).message}`);
      }
    }
  } else {
    for (const w of warnings) console.error(`warning: ${where(w)}: ${w.message}`);
    for (const e of errors) console.error(`${where(e)}: ${e.message}`);
  }
  if (errors.length) {
    console.error(`\nemployer registry: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`employer registry is valid: ${stats.rows} rows in ${stats.files} files, ${stats.contributions} contribution(s)` +
    (stats.inboxFiles ? `; inbox: ${stats.inboxLines} board(s) in ${stats.inboxFiles} file(s), ${stats.inboxKnown} already in the registry` : '') +
    (warnings.length ? `, ${warnings.length} warning(s)` : ''));
}

if (isMainModule(import.meta.url)) main();
