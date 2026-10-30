#!/usr/bin/env node

/**
 * sponsor-check.mjs — UK Skilled Worker sponsor-licence cross-check (zero-LLM)
 *
 * A candidate on a Graduate visa who needs Skilled Worker sponsorship cannot
 * act on a UK posting until one question is answered: does this employer hold
 * a sponsor licence at all? `visa_filter` in scan.mjs only drops postings whose
 * text explicitly REFUSES sponsorship, and most postings say nothing — so the
 * whole pipeline passes them through and the register check happens by hand,
 * once per candidate role. This script is that check, run locally against the
 * Home Office's own published register.
 *
 * ── `not-found` MEANS UNCONFIRMED, NEVER "DOES NOT SPONSOR" ────────────────
 *
 * This is the load-bearing rule of the whole file, and the failure mode it
 * exists to prevent is a FALSE NEGATIVE: a verdict that reads as "they can't
 * sponsor you" and makes the candidate skip a viable employer. Absence from
 * the register is weak evidence, for reasons that are structural and not
 * fixable by better matching:
 *
 *   - The register lists the LICENCE HOLDER's legal name. A UK subsidiary
 *     commonly hires under a parent's or a group entity's licence, and a brand
 *     ("Wayve") is not the registered name ("Wayve Technologies Ltd").
 *   - Postings carry trading names, brand names, agency names and ATS board
 *     slugs — none of which the register knows.
 *   - The register is a daily snapshot and lags new licences.
 *
 * So a `not-found` verdict is phrased, in every output mode, as "not found on
 * this snapshot — UNCONFIRMED", and the next step it suggests is checking the
 * employer's legal entity, never dropping the role. Equally, this script never
 * invents a match: where several register organisations could plausibly be the
 * employer, the verdict is `ambiguous` and the candidate rows are printed as
 * evidence for a human to read, rather than one of them being guessed at.
 *
 * ADVISORY ONLY. Nothing here is wired into scan.mjs, and a verdict is not a
 * filter: turning any of this into a gate is a separate decision, and the
 * asymmetry above is why it is not taken here. Read-only with respect to every
 * user-layer file — the tracker, pipeline.md and portals.yml are read and
 * never written; the only thing this script writes is its own register cache
 * under `data/cache/sponsor-register/`.
 *
 * WHAT A `licensed` VERDICT DOES AND DOES NOT SAY. It says: an organisation of
 * this name holds a licence for the listed route(s) on the cached snapshot. It
 * does NOT say the employer will sponsor THIS role — a licence is a capability,
 * not an offer, and an A-rated sponsor can still decline to assign a Certificate
 * of Sponsorship for a particular req. The route and rating columns are reported
 * for exactly that reason: a sponsor listed only for Creative Worker or
 * Religious Worker cannot sponsor a Skilled Worker role, and presence in the
 * file alone would read as a green light.
 *
 * SOURCE. "Register of licensed sponsors: workers", published on GOV.UK and
 * refreshed most working days. The CSV's URL changes on every publication, so
 * it is discovered through the GOV.UK Content API rather than hardcoded, and
 * cached locally with a staleness marker: a run with a fresh cache makes no
 * network request at all.
 *
 * MATCHING reuses companyTokens()/matchCompany() from linkedin-join.mjs — the
 * tree's existing fuzzy company-identity rule, with its own tests and its own
 * documented reasoning about why "Siemens" ~ "Siemens Digital Industries
 * Software" is safe while "Epic" ~ "Epic Games" is not — rather than growing a
 * second definition of "same company" that is free to drift from it. Exact-key
 * lookup goes through normalizeCompany() (tracker-utils.mjs), the same key the
 * tracker itself uses for same-company identity.
 *
 * Usage:
 *   node sponsor-check.mjs --company "Wayve" [--summary]
 *   node sponsor-check.mjs --tracker [--summary]      # annotate data/applications.md
 *   node sponsor-check.mjs --pipeline [--summary]     # annotate data/pipeline.md
 *   node sponsor-check.mjs --file <path> [--summary]  # annotate either format
 *   node sponsor-check.mjs --cache-status
 *   node sponsor-check.mjs --help
 *
 * Exit code reports whether the CHECK ran, never the verdict: a `not-found` is
 * a legitimate answer and exits 0. Exit 1 means no register was available, or
 * the arguments were unusable.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { normalizeCompany } from './tracker-utils.mjs';
import { companyTokens, matchCompany, parseCsv } from './linkedin-join.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { flagValue, hasFlag, safeIntFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';

const DATA_ROOT = getCareerOpsRoot();
const TRACKER_PATH = resolveTrackerPath(DATA_ROOT);
const PIPELINE_PATH = join(DATA_ROOT, 'data/pipeline.md');
const CACHE_DIR = join(DATA_ROOT, 'data/cache/sponsor-register');
const CACHE_CSV = join(CACHE_DIR, 'register.csv');
const CACHE_META = join(CACHE_DIR, 'register.meta.json');

/** GOV.UK Content API entry for the publication that carries the CSV. */
export const REGISTER_CONTENT_API =
  'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers';

/** Human page, printed in output so a reader can verify a verdict by hand. */
export const REGISTER_PAGE =
  'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers';

/**
 * Days before the cache is re-downloaded. The register is republished most
 * working days, but a week-old snapshot is still a usable advisory signal and
 * an 11MB download on every invocation is not: the point of the cache is that
 * a tracker sweep over 100+ employers costs one fetch, not one per lookup.
 */
export const DEFAULT_MAX_AGE_DAYS = 7;

/** The route this candidate's visa question is about. */
export const SKILLED_WORKER_ROUTE = 'Skilled Worker';

/**
 * Candidate organisations listed before the list is truncated.
 *
 * A generic query ("University", "NHS") contains a token thousands of register
 * rows share, and printing all of them is the same as printing none. The count
 * is reported in full and the list is capped, so the output stays readable
 * without hiding how wide the match actually was.
 */
export const MAX_CANDIDATES = 25;

const VALUE_FLAGS = ['--company', '--file', '--register', '--max-age-days'];
const KNOWN_FLAGS = [
  '--company', '--tracker', '--pipeline', '--file', '--register',
  '--max-age-days', '--refresh', '--offline', '--cache-status',
  '--summary', '--self-test', '--help', '-h',
];

const USAGE = `Usage: node sponsor-check.mjs [options]

Cross-checks an employer against the Home Office "Register of licensed
sponsors: workers". Advisory only — never wired into scan.mjs as a filter.

  --company <name>      Check ONE employer
  --tracker             Annotate every employer in the applications tracker
  --pipeline            Annotate every employer in data/pipeline.md
  --file <path>         Annotate a tracker-table or pipeline-list file
  --summary             Human-readable output (default: JSON)
  --register <path>     Use a local register CSV instead of the cache
  --max-age-days <n>    Re-download when the cache is older (default: ${DEFAULT_MAX_AGE_DAYS})
  --refresh             Re-download now, whatever the cache's age
  --offline             Never fetch; fail if there is no cache at all
  --cache-status        Report the cache's age and source, check nothing
  --self-test           Run the inline checks (no network, no files)
  --help, -h            Show this message

A 'not-found' verdict means UNCONFIRMED, never "does not sponsor": the
register lists licence holders' legal names, so a subsidiary hiring under a
parent's licence, a trading name, or a licence granted since the snapshot all
read as absent. Confirm at the employer before dropping a role.

Exit code reports whether the check RAN, not what it found.`;

// ── Register parsing ───────────────────────────────────────────────────────

/**
 * Column labels in the published CSV, matched case-insensitively by name.
 *
 * Resolved by NAME rather than position for the same reason parseConnections()
 * does it: the Home Office has changed this file's shape before (the pre-2021
 * register carried Tier/sub-tier columns), and a positional read of a reordered
 * file does not fail — it silently reports the town as the route.
 */
const COLUMN_ALIASES = {
  name: ['organisation name', 'organization name', 'organisation', 'name'],
  town: ['town/city', 'town / city', 'town', 'city'],
  county: ['county'],
  rating: ['type & rating', 'type and rating', 'type & rating ', 'tier & rating'],
  route: ['route', 'sub tier', 'sub-tier'],
};

/**
 * Map the header row onto field names.
 *
 * @param {string[]} header - Raw header cells.
 * @returns {Record<string, number>} Field name -> column index (absent fields omitted).
 */
export function resolveRegisterColumns(header) {
  const lower = (header || []).map((c) => String(c || '').trim().toLowerCase());
  const colmap = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = lower.findIndex((cell) => aliases.includes(cell));
    if (idx !== -1) colmap[field] = idx;
  }
  return colmap;
}

/**
 * Pull the rating letter out of a "Type & Rating" cell.
 *
 * Shapes seen live: "Worker (A rating)", "Temporary Worker (A rating)",
 * "Worker (B rating)", "Worker (UK Expansion Worker: Provisional )". The letter
 * is what matters to a candidate — a B-rated sponsor is on an action plan and
 * its licence is at risk — so it is extracted, while the full cell is kept
 * verbatim as the evidence actually published.
 *
 * @param {string} cell
 * @returns {{raw: string, type: string|null, rating: string|null}}
 */
export function parseTypeRating(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return { raw: '', type: null, rating: null };
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw);
  if (!m) return { raw, type: raw, rating: null };
  const inner = m[2].trim();
  const letter = /^([AB])\s+rating$/i.exec(inner);
  return {
    raw,
    type: m[1].trim() || null,
    rating: letter ? letter[1].toUpperCase() : inner.replace(/\s+/g, ' ') || null,
  };
}

/**
 * Parse the register CSV into one entry per licensed organisation.
 *
 * The file carries ONE ROW PER (organisation, route) pair, so a sponsor
 * licensed for three routes appears three times. Rows are folded into a single
 * organisation entry whose `routes` list is the real answer to "what can they
 * sponsor?" — reporting raw rows would make one sponsor look like three, and
 * reporting mere presence would hide that a Creative Worker sponsor cannot
 * sponsor a Skilled Worker role at all.
 *
 * Organisations are keyed by published NAME + TOWN + COUNTY, case-folded for
 * the key and spelled as published in the output. Name alone is not an
 * identity: 244 names in the live file carry more than one town, which is two
 * licence holders (or two licensed sites) sharing a name, and folding them
 * would quietly discard one entity's town — the very field a human uses to
 * tell them apart — and report a single confident answer where there are two.
 * Town is safe to key on here because the file is consistent about it: exactly
 * one row in the live register has an empty town cell, and no name mixes empty
 * and filled, so this cannot split one organisation over a blank cell.
 *
 * @param {string} csvText - Raw CSV.
 * @returns {{organisations: object[], rowCount: number, columns: Record<string, number>, header: string[]}}
 */
export function parseRegister(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { organisations: [], rowCount: 0, columns: {}, header: [] };

  const header = rows[0].map((c) => String(c || '').trim());
  const columns = resolveRegisterColumns(header);
  if (columns.name === undefined) {
    throw new Error(
      `register CSV has no recognizable organisation-name column (header: ${header.join(', ') || '<empty>'})`,
    );
  }

  const byName = new Map();
  let rowCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // parseCsv emits a trailing single-empty-cell row for a file ending in a
    // newline; a blank line mid-file is the same shape and equally not a row.
    const name = String(cells[columns.name] ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    rowCount++;

    const route = String(cells[columns.route] ?? '').replace(/\s+/g, ' ').trim();
    const typeRating = parseTypeRating(cells[columns.rating]);
    const town = cleanPlace(cells[columns.town]);
    const county = cleanPlace(cells[columns.county]);

    const key = `${name.toLowerCase()}|${town.toLowerCase()}|${county.toLowerCase()}`;
    let org = byName.get(key);
    if (!org) {
      org = { name, town, county, routes: [], ratings: [], rows: [] };
      byName.set(key, org);
    }
    if (route && !org.routes.includes(route)) org.routes.push(route);
    if (typeRating.raw && !org.ratings.includes(typeRating.raw)) org.ratings.push(typeRating.raw);
    org.rows.push({ route, ...typeRating, town, county });
  }

  const organisations = [...byName.values()].map((org) => ({
    ...org,
    skilledWorker: org.routes.includes(SKILLED_WORKER_ROUTE),
    // The letter a candidate cares about, where the rows agree on one.
    rating: (() => {
      const letters = [...new Set(org.rows.map((r) => r.rating).filter((r) => r === 'A' || r === 'B'))];
      return letters.length === 1 ? letters[0] : null;
    })(),
  }));

  return { organisations, rowCount, columns, header };
}

/**
 * Tidy a town/county cell.
 *
 * The published file quotes these cells when they contain a comma and often
 * leaves the separator in with nothing after it — `"HAMILTON, "`,
 * `"Colchester, "`, `"Bexhill, "`. Whitespace-trimming alone leaves
 * "Colchester," in the output, which reads as truncated data rather than as
 * the register's own punctuation. Only leading/trailing separators are
 * removed; an internal one ("Walsall, West Midlands") is real content.
 */
function cleanPlace(cell) {
  return String(cell ?? '').replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '');
}

/**
 * Build the lookup indexes over parsed organisations.
 *
 * Four indexes, each answering a different tier of the lookup below:
 *   - `byExactKey`      normalizeCompany() key -> organisation ids (tracker identity)
 *   - `byTokenKey`      companyTokens().key    -> ids ("GoDaddy" ~ "Go Daddy")
 *   - `byDistinctive`   sorted distinctive set -> ids (matchCompany 'strong')
 *   - `byToken`         one distinctive token  -> ids (containment candidates)
 *
 * @param {object[]} organisations - From parseRegister().
 * @returns {object} Index consumed by lookupSponsor().
 */
export function buildRegisterIndex(organisations) {
  const orgs = organisations || [];
  const byExactKey = new Map();
  const byTokenKey = new Map();
  const byTrimmedKey = new Map();
  const byDistinctive = new Map();
  const byJurisdictionFolded = new Map();
  const byToken = new Map();
  const tokensById = [];

  const add = (map, key, id) => {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) bucket.push(id);
    else map.set(key, [id]);
  };

  orgs.forEach((org, id) => {
    const tokens = companyTokens(org.name);
    tokensById.push(tokens);
    add(byExactKey, normalizeCompany(org.name), id);
    add(byTokenKey, tokens.key, id);
    for (const trimmed of trimmedKeys(tokens)) add(byTrimmedKey, trimmed, id);
    add(byDistinctive, distinctiveKey(tokens.distinctive), id);
    add(byJurisdictionFolded, jurisdictionFoldedKey(tokens.distinctive), id);
    for (const token of new Set(tokens.distinctive)) add(byToken, token, id);
  });

  return {
    organisations: orgs, tokensById,
    byExactKey, byTokenKey, byTrimmedKey, byDistinctive, byJurisdictionFolded, byToken,
  };
}

/** Order-independent key for a distinctive token set. */
function distinctiveKey(distinctive) {
  return [...new Set(distinctive)].sort().join('|');
}

/**
 * Tokens that cannot discriminate between two organisations IN THIS FILE.
 *
 * companyTokens()'s GENERIC set is written for a global LinkedIn join, where
 * "UK" is a real distinguishing token (Siemens vs Siemens UK are different
 * employers to a connections export). Inside a register of UK sponsors it
 * distinguishes nothing: every organisation in the file is a UK licence
 * holder, and `{Brand} UK Limited` is simply how a multinational's UK hiring
 * entity is named — AstraZeneca UK Limited, Palantir UK Limited, Google UK
 * Limited. Treating it as identity-bearing made the single most common real
 * pattern in the candidate's own tracker fall to the weakest tier.
 *
 * Deliberately NOT added to linkedin-join.mjs's GENERIC: that set is correct
 * for what it does, and this is a property of this data source, not of company
 * names in general. Kept to the two tokens that are purely jurisdictional —
 * "British" (British Airways) and "London" (London Stock Exchange) carry real
 * identity and are not here.
 */
const JURISDICTION_FILLER = new Set(['uk', 'gb']);

/**
 * Distinctive-token key with jurisdiction markers removed, or '' when nothing
 * identifying survives (a bare "UK Ltd" must never match anything).
 */
function jurisdictionFoldedKey(distinctive) {
  const kept = [...new Set(distinctive)].filter((t) => !JURISDICTION_FILLER.has(t));
  if (!kept.length || !kept.some((t) => t.length >= 3)) return '';
  return kept.sort().join('|');
}

/**
 * Concatenated keys for a name with its TRAILING filler tokens progressively
 * trimmed, strongest (longest) first.
 *
 * companyTokens().key concatenates every token, so "ElevenLabs" (one token)
 * never equals "Eleven Labs Ltd" ('elevenlabsltd') — the legal suffix the
 * register always carries and a posting never does defeats the whole tier. The
 * distinctive-set tiers do not rescue it either: 'labs' is sector filler, so
 * the register name reduces to {eleven} while the query is the single token
 * {elevenlabs}, and the two sets are simply different strings.
 *
 * Trimming from the END only, and only tokens that carry no identifying signal
 * (whatever companyTokens() dropped from `distinctive`), gives the keys a
 * posting is actually likely to spell: "Eleven Labs Ltd" -> 'elevenlabs',
 * 'eleven'; "London Stock Exchange Group plc" -> 'londonstockexchangegroup',
 * 'londonstockexchange'.
 *
 * Every key keeps at least one distinctive token and at least three
 * characters. Without the first, a generic-only register name ("Digital
 * Solutions Ltd") trims to 'digital' and claims any posting spelled that way;
 * without the second, "S&P Global Limited" trims past 'spglobal' to 'sp', a
 * two-letter key that is coincidence as often as signal (the same floor the
 * fuzzy tiers apply).
 *
 * @param {{all: string[], distinctive: string[]}} tokens
 * @returns {string[]} Keys longest-first, excluding the full key itself.
 */
function trimmedKeys(tokens) {
  const distinctive = new Set(tokens.distinctive);
  const keys = [];
  const rest = [...tokens.all];
  while (rest.length > 1 && !distinctive.has(rest[rest.length - 1])) {
    rest.pop();
    if (!rest.some((t) => distinctive.has(t))) break;
    const key = rest.join('');
    if (key.length < 3) break;
    keys.push(key);
  }
  return keys;
}

/** Every non-empty subset of `tokens`, smaller sets last. Used for candidate ⊆ query. */
function subsets(tokens) {
  const unique = [...new Set(tokens)];
  const out = [];
  for (let mask = 1; mask < (1 << unique.length); mask++) {
    const subset = unique.filter((_, i) => mask & (1 << i));
    out.push(subset);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Hard ceiling on the query token count considered for subset enumeration.
 *
 * subsets() is 2^n, and a register organisation name can run to a dozen
 * distinctive tokens ("Mrs Prashanthy Shathyakaran T/A Manor News"). Past this
 * point the candidate ⊆ query direction is skipped — the query ⊆ candidate
 * direction, which is the one that finds "Wayve" inside "Wayve Technologies
 * Ltd", is an index intersection and has no such cost.
 */
const MAX_SUBSET_TOKENS = 12;

/**
 * Read an all-caps query as a possible initialism, or null.
 *
 * Postings and trackers routinely name an employer by its initials while the
 * register carries the expansion: "LSEG" is "London Stock Exchange Group plc",
 * which shares not one token with the query and so reads as absent at every
 * other tier. Requiring the ORIGINAL to be upper-case is what keeps this from
 * firing on ordinary short names ("Rex", "Meta", "Bolt"), and the result is
 * only ever a candidate to check by hand — an expansion can never be a
 * confident licence match, since three letters pick out unrelated companies
 * ("PWC" also initialises "Pearly Whites Clinic Ltd").
 *
 * @param {string} raw - The query as the caller typed it.
 * @returns {string|null} Lower-cased letters, or null when this is not an initialism.
 */
export function initialismKey(raw) {
  const letters = String(raw || '').replace(/[^A-Za-z]/g, '');
  if (letters.length < 2 || letters.length > 6) return null;
  if (letters !== letters.toUpperCase()) return null;
  return letters.toLowerCase();
}

/**
 * Register organisations whose leading token initials spell `key`.
 *
 * Any PREFIX of the name's tokens counts, because the expansion is usually
 * followed by a legal form the initialism omits: "London Stock Exchange Group
 * plc" must be found by "LSEG", not only by "LSEGP".
 *
 * @param {object} index - From buildRegisterIndex().
 * @param {string} key - From initialismKey().
 * @returns {number[]} Organisation ids.
 */
export function initialismCandidates(index, key) {
  const ids = [];
  for (let id = 0; id < index.tokensById.length; id++) {
    const all = index.tokensById[id].all;
    if (all.length < 2) continue;
    let acc = '';
    for (let k = 0; k < all.length && acc.length < key.length; k++) {
      acc += all[k][0];
      if (k >= 1 && acc === key) { ids.push(id); break; }
    }
  }
  return ids;
}

/**
 * Answer "does this employer hold a sponsor licence?" from the register.
 *
 * Tiers, strongest first. The first tier that yields exactly ONE organisation
 * wins as `licensed`; a tier yielding several yields `ambiguous` with all of
 * them as evidence, and the weakest tier never yields `licensed` at all:
 *
 *   1. exact    normalizeCompany() keys equal — the tracker's own identity rule.
 *   2. token    separator-free token keys equal ("Go Daddy" ~ "GoDaddy").
 *  2b. token-trimmed  the query equals a register key with its TRAILING filler
 *               dropped. This is the workhorse: it resolves "Wayve" ->
 *               "Wayve Technologies Ltd", "ElevenLabs" -> "Eleven Labs Ltd",
 *               "S&P Global" -> "S&P Global Limited". Still key equality, and
 *               nothing is trimmed from the middle (see trimmedKeys).
 *   3. strong   matchCompany() 'strong': distinctive token sets EQUAL, so only
 *               legal/sector filler differs, in any order or spelling the
 *               trimmed keys miss ("Wayve Technology" vs "Wayve
 *               Technologies Ltd"). Safe for the reason matchCompany
 *               documents: an extra DISTINCTIVE token on either side changes
 *               the entity and drops to tier 4.
 *  3b. jurisdiction  the same equality, with "UK"/"GB" dropped from both sides
 *               because they cannot discriminate inside a register of UK
 *               sponsors. Resolves "AstraZeneca" -> "AstraZeneca UK Limited".
 *   4. partial  one name's distinctive tokens are a subset of the other's
 *               ("Essex" vs "University of Essex"), or (4b) an ALL-CAPS query
 *               spells the initials of a longer register name ("LSEG" ->
 *               "London Stock Exchange Group plc"). Both report as the
 *               `partial` tier and always as `ambiguous` candidates, NEVER as
 *               a match — this is precisely where a guessed single answer
 *               would invent a licence. Each candidate carries a `relation`
 *               saying which of the four shapes it is. A fourth sub-tier (4c)
 *               runs only when nothing above produced a candidate at all:
 *               names sharing two or more substantive words, which is what
 *               finds a long public-sector name spelled with an abbreviation
 *               ("... NHS FT" vs "... NHS Foundation Trust").
 *
 * A name with no distinctive tokens ("?", "Stealth Startup", "Confidential")
 * is never matched: it would pair with whichever register row happens to be
 * typed the same way. A query whose only tokens are shorter than three
 * characters is likewise kept out of the FUZZY tiers, where such an overlap is
 * coincidence as often as signal (matchCompany's own rule) — the equality
 * tiers above still apply to it, which is how "S&P Global" resolves at all.
 *
 * @param {object} index - From buildRegisterIndex().
 * @param {string} company - Employer name as the posting/tracker spells it.
 * @returns {object} `{query, verdict, matchTier, skilledWorker, organisations, candidates, candidateCount, truncated, note}`
 */
export function lookupSponsor(index, company) {
  const query = String(company ?? '').trim();
  const base = {
    query,
    verdict: 'not-found',
    matchTier: null,
    skilledWorker: null,
    organisations: [],
    candidates: [],
    candidateCount: 0,
    truncated: false,
  };

  if (!query) {
    return { ...base, note: 'no company name given — nothing was checked' };
  }

  const tokens = companyTokens(query);
  const resolve = (ids) => [...new Set(ids)].map((id) => index.organisations[id]);

  // Tiers 1, 2 and 2b are all key EQUALITY, so they are pooled rather than
  // tried in turn: "Foo Bar" is the exact name of one licence holder and the
  // suffix-trimmed name of another ("Foo Bar Ltd"), and stopping at the first
  // tier that hits would report one of two equally good matches as the
  // answer. Several organisations here are reported, never picked between.
  // The tier named is the strongest one that contributed a match.
  //
  // Tier 1: exact identity.
  const exactIds = index.byExactKey.get(normalizeCompany(query)) || [];
  // Tier 2: the same tokens, spaced or punctuated differently.
  const tokenIds = index.byTokenKey.get(tokens.key) || [];
  // Tier 2b: the query spells a register name minus the legal suffix the
  // register always carries — "ElevenLabs" -> "Eleven Labs Ltd", "S&P Global"
  // -> "S&P Global Limited". Against a key built by dropping only trailing
  // filler (see trimmedKeys); it runs before the short-token guard below
  // precisely because "S&P Global" reduces to tokens of one and two letters
  // and would otherwise never be compared at all.
  const trimmedIds = index.byTrimmedKey.get(tokens.key) || [];
  const equal = resolve([...exactIds, ...tokenIds, ...trimmedIds]);
  if (equal.length) {
    const tier = exactIds.length ? 'exact' : tokenIds.length ? 'token' : 'token-trimmed';
    return decide(base, equal, tier);
  }

  if (!tokens.distinctive.length) {
    return {
      ...base,
      note: `"${query}" carries no identifying tokens (placeholder or generic-only name), so it was not matched against the register`,
    };
  }

  const substantive = tokens.distinctive.some((t) => t.length >= 3);
  if (!substantive) {
    return {
      ...base,
      note: `"${query}" reduces to tokens shorter than three characters, where a fuzzy match is coincidence as often as signal — checked for an exact register name only`,
    };
  }

  // Tier 3: distinctive sets equal — matchCompany()'s 'strong'.
  const strong = resolve(index.byDistinctive.get(distinctiveKey(tokens.distinctive)) || [])
    .filter((org) => matchCompany(tokens, companyTokens(org.name)) === 'strong');
  if (strong.length) return decide(base, strong, 'strong');

  // Tier 3b: distinctive sets equal once jurisdiction markers are dropped —
  // "AstraZeneca" -> "AstraZeneca UK Limited". Still EQUALITY, not containment:
  // the only token allowed to differ is one that cannot discriminate inside a
  // UK-only register (see JURISDICTION_FILLER). Where two hiring entities both
  // reduce to the same key ("Palantir UK Limited" and "Palantir Technologies
  // UK Limited") this reports both rather than choosing.
  const folded = jurisdictionFoldedKey(tokens.distinctive);
  if (folded) {
    const jurisdiction = resolve(index.byJurisdictionFolded.get(folded) || []);
    if (jurisdiction.length) return decide(base, jurisdiction, 'jurisdiction');
  }

  // Tier 4: containment, both directions. Candidates only, never a verdict.
  const candidateIds = new Set();

  // query ⊆ candidate: intersect the posting lists of every query token.
  const postings = tokens.distinctive.map((t) => index.byToken.get(t) || []);
  if (postings.every((p) => p.length)) {
    const smallest = postings.reduce((a, b) => (a.length <= b.length ? a : b));
    const others = postings.filter((p) => p !== smallest).map((p) => new Set(p));
    for (const id of smallest) {
      if (others.every((set) => set.has(id))) candidateIds.add(id);
    }
  }

  // candidate ⊆ query: look up each proper subset of the query's tokens.
  if (tokens.distinctive.length <= MAX_SUBSET_TOKENS) {
    for (const subset of subsets(tokens.distinctive)) {
      if (subset.length === tokens.distinctive.length) continue;
      if (!subset.some((t) => t.length >= 3)) continue;
      for (const id of index.byDistinctive.get(distinctiveKey(subset)) || []) candidateIds.add(id);
    }
  }

  // Tier 4b: an all-caps query read as an initialism of a longer register name.
  // Candidates only — see initialismKey() for why an expansion can never be a
  // confident match.
  const initialism = initialismKey(query);
  const initialismIds = initialism ? new Set(initialismCandidates(index, initialism)) : new Set();
  for (const id of initialismIds) candidateIds.add(id);

  // Tier 4c, last resort: names sharing TWO OR MORE substantive distinctive
  // tokens, neither containing the other. This is what stands between a long
  // public-sector name and a flat "not found": "Greater Manchester Mental
  // Health NHS FT" and "Greater Manchester Mental Health NHS Foundation Trust"
  // are obviously the same employer to a reader and share four tokens, but
  // neither set contains the other (FT vs Foundation Trust), so every tier
  // above misses it. Two shared tokens is the floor because one is routinely
  // coincidence ("Manchester", "Group"); it runs only when nothing else
  // produced a candidate, so it can never dilute a better list, and like the
  // rest of tier 4 it yields candidates to read, never a licensed verdict.
  const overlapIds = new Set();
  if (!candidateIds.size) {
    const counts = new Map();
    for (const token of new Set(tokens.distinctive.filter((t) => t.length >= 3))) {
      for (const id of index.byToken.get(token) || []) counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count >= 2) { overlapIds.add(id); candidateIds.add(id); }
    }
  }

  if (!candidateIds.size) {
    return {
      ...base,
      note: `"${query}" is not on this snapshot of the register — UNCONFIRMED, not a refusal. The register lists licence holders' legal names, so a subsidiary sponsored under a parent's licence, a trading name, or a licence granted since the snapshot all read as absent. Confirm the hiring entity's legal name before dropping the role.`,
    };
  }

  const queryTokens = new Set(tokens.distinctive);
  const candidates = [...candidateIds]
    .map((id) => ({
      ...index.organisations[id],
      // How many of the query's distinctive words this row actually shares.
      // It is the ranking signal AND the evidence: with fourteen rows sharing
      // the word "Manchester", "shares 4 words" is what tells the reader which
      // one to read first, and sorting by name length alone buried the real
      // match ("... NHS Foundation Trust") under a shorter coincidence
      // ("Groundwork Greater Manchester").
      sharedWords: index.tokensById[id].distinctive.filter((t) => queryTokens.has(t)).length,
      // Which direction the containment runs tells the reader what they are
      // looking at: a longer register name (likely the same employer's legal
      // entity) or a shorter one (likely a different, broader organisation).
      relation: initialismIds.has(id)
        ? 'register-name-expands-the-initials'
        : overlapIds.has(id)
          ? 'shares-two-or-more-words'
          : isSubset(tokens.distinctive, index.tokensById[id].distinctive)
            ? 'register-name-is-longer'
            : 'register-name-is-shorter',
    }))
    .sort((a, b) => b.sharedWords - a.sharedWords
      || a.name.length - b.name.length
      || a.name.localeCompare(b.name));

  return {
    ...base,
    verdict: 'ambiguous',
    matchTier: 'partial',
    skilledWorker: null,
    candidates: candidates.slice(0, MAX_CANDIDATES),
    candidateCount: candidates.length,
    truncated: candidates.length > MAX_CANDIDATES,
    // One candidate and many candidates are different situations for the
    // reader, and collapsing them into one sentence wastes the only thing this
    // tier can offer: a name to go and check. One longer register name
    // containing the whole query ("Keele University" inside "Keele University
    // - Human Resources") is usually the same employer and is worth saying so,
    // as long as it is still labelled unconfirmed; thirty partial hits on a
    // shared word are not.
    note: candidates.length === 1 && candidates[0].relation === 'register-name-expands-the-initials'
      ? `"${query}" reads as the initials of one register organisation, "${candidates[0].name}" (${candidates[0].routes.join('; ') || 'no route published'}) — plausible but NOT confirmed: an initialism of three or four letters also picks out unrelated companies. Check that this is the hiring entity before relying on it.`
      : candidates.length === 1 && candidates[0].relation === 'register-name-is-longer'
      ? `"${query}" appears inside one register organisation's longer name, "${candidates[0].name}" (${candidates[0].routes.join('; ') || 'no route published'}) — very often the same employer's full legal name, but NOT confirmed here: an extra distinctive word can also mean a different entity. Check the hiring entity's legal name against that row.`
      : `"${query}" partially matches ${candidates.length} register organisation(s) — none is confirmed as the employer. Read the candidates and check the hiring entity's legal name; this is UNCONFIRMED either way.`,
  };
}

function isSubset(a, b) {
  const set = new Set(b);
  return a.every((t) => set.has(t));
}

/** Shape a resolved tier into a verdict, keeping "several matches" honest. */
function decide(base, orgs, tier) {
  if (orgs.length === 1) {
    const org = orgs[0];
    return {
      ...base,
      verdict: 'licensed',
      matchTier: tier,
      skilledWorker: org.skilledWorker,
      organisations: [org],
      candidateCount: 1,
      note: org.skilledWorker
        ? `"${org.name}" holds a licence covering the ${SKILLED_WORKER_ROUTE} route (${org.ratings.join('; ') || 'rating not published'}). A licence is a capability, not an offer — it does not mean this role comes with sponsorship.`
        : `"${org.name}" is on the register but NOT for the ${SKILLED_WORKER_ROUTE} route (listed for: ${org.routes.join('; ') || 'no route published'}). It cannot sponsor a Skilled Worker role on this licence.`,
    };
  }
  return {
    ...base,
    verdict: 'ambiguous',
    matchTier: tier,
    skilledWorker: null,
    organisations: orgs,
    candidates: orgs.map((org) => ({ ...org, relation: 'equally-good-match' })),
    candidateCount: orgs.length,
    note: `${orgs.length} register organisations match "${base.query}" equally well — separate licence holders whose names differ only by filler (a group and its UK hiring entity, or two unrelated namesakes). Pick by town/county against the hiring entity rather than assuming either; each one's routes are listed, and they can differ.`,
  };
}

// ── Input extraction (read-only) ──────────────────────────────────────────

/**
 * Employers named by a tracker table, one per distinct normalized company.
 *
 * Rows are read through resolveColumns()/parseTrackerRow() so a tracker with a
 * reordered or extra column (Location, URL) is read by header name rather than
 * by position, and so this sees exactly the company string the rest of the
 * pipeline sees.
 *
 * @param {string} content - applications.md text.
 * @returns {{company: string, rows: object[]}[]}
 */
export function extractTrackerCompanies(content) {
  const lines = String(content || '').split('\n');
  const colmap = resolveColumns(lines);
  const seen = new Map();
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row || !row.company) continue;
    const key = normalizeCompany(row.company) || row.company.toLowerCase();
    if (!seen.has(key)) seen.set(key, { company: row.company, rows: [] });
    seen.get(key).rows.push({ num: row.num, role: row.role, status: row.status, score: row.score });
  }
  return [...seen.values()];
}

/**
 * Employers named by a pipeline inbox list.
 *
 * Pending rows are `- [ ] {url} | {company} | {role} | …`, but processed rows
 * lead with a report number (`- [x] #143 | {url} | {company} | {role} | …`), so
 * the company is the field *after the URL field*, not a fixed position. A row
 * with no company field (a bare pasted URL, which is the documented minimum
 * form) contributes nothing rather than being parsed out of the URL's host —
 * guessing an employer from a multi-tenant ATS hostname is how the wrong entity
 * gets checked. Pre-screen discards (`- [x] #-- | {url} | skipped (…)`) are
 * skipped too: the field after their URL is a discard reason, not a company.
 *
 * @param {string} content - pipeline.md text.
 * @returns {{company: string, rows: object[]}[]}
 */
export function extractPipelineCompanies(content) {
  const seen = new Map();
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trim();
    const m = /^-\s*\[[^\]]*\]\s*(.+)$/.exec(line);
    if (!m) continue;
    const fields = m[1].split('|').map((f) => f.trim());
    if (fields[0].startsWith('#--')) continue;
    const urlIndex = fields.findIndex((f) => /^https?:\/\//i.test(f));
    if (urlIndex < 0) continue;
    const company = fields[urlIndex + 1];
    if (!company) continue;
    const key = normalizeCompany(company) || company.toLowerCase();
    if (!seen.has(key)) seen.set(key, { company, rows: [] });
    seen.get(key).rows.push({ url: fields[urlIndex], role: fields[urlIndex + 2] || null });
  }
  return [...seen.values()];
}

/** Pick the extractor by content shape, so --file accepts either format. */
export function extractCompanies(content) {
  const tracker = extractTrackerCompanies(content);
  if (tracker.length) return { source: 'tracker', companies: tracker };
  return { source: 'pipeline', companies: extractPipelineCompanies(content) };
}

/**
 * Look every employer up and roll the verdicts into a resolution rate.
 *
 * The rate is the number the candidate actually needs: it says how much the
 * fuzzy matching is buying over an exact-name-only check, and how much of the
 * pipeline is still a manual register lookup.
 *
 * @param {object} index - From buildRegisterIndex().
 * @param {{company: string, rows: object[]}[]} companies
 * @returns {{employers: object[], totals: object}}
 */
export function annotateCompanies(index, companies) {
  const employers = (companies || []).map((entry) => ({
    ...lookupSponsor(index, entry.company),
    rows: entry.rows,
  }));

  const totals = {
    employers: employers.length,
    licensed: employers.filter((e) => e.verdict === 'licensed').length,
    licensedSkilledWorker: employers.filter((e) => e.verdict === 'licensed' && e.skilledWorker).length,
    licensedOtherRouteOnly: employers.filter((e) => e.verdict === 'licensed' && e.skilledWorker === false).length,
    ambiguous: employers.filter((e) => e.verdict === 'ambiguous').length,
    notFound: employers.filter((e) => e.verdict === 'not-found').length,
    byTier: {},
  };
  for (const e of employers) {
    const tier = e.matchTier || 'none';
    totals.byTier[tier] = (totals.byTier[tier] || 0) + 1;
  }
  totals.resolvedRate = totals.employers ? Number((totals.licensed / totals.employers).toFixed(4)) : 0;

  return { employers, totals };
}

// ── Cache ──────────────────────────────────────────────────────────────────

/**
 * Read the cache's staleness marker.
 *
 * The marker is written AFTER the CSV and is the only thing that makes a cache
 * usable, so a download killed mid-write leaves a partial CSV with no marker
 * and is treated as no cache at all — rather than as a fresh register that
 * happens to be missing 90% of its sponsors, which would turn every lookup
 * into a false `not-found`.
 *
 * @returns {object|null}
 */
export function readCacheMeta(metaPath = CACHE_META, csvPath = CACHE_CSV) {
  if (!existsSync(metaPath) || !existsSync(csvPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const bytes = statSync(csvPath).size;
    // A marker describing a different file than the one on disk is not a
    // marker for this cache. Size is the cheap, sufficient check: a truncated
    // CSV is the failure that matters and it always changes the size.
    if (Number.isInteger(meta?.bytes) && meta.bytes !== bytes) {
      return { ...meta, bytes, corrupt: true };
    }
    return { ...meta, bytes };
  } catch {
    return null;
  }
}

/**
 * Is the cached register young enough to use without re-downloading?
 *
 * @param {object|null} meta - From readCacheMeta().
 * @param {number} maxAgeDays
 * @param {number} [now] - Epoch ms, injectable for tests.
 * @returns {boolean}
 */
export function isCacheFresh(meta, maxAgeDays, now = Date.now()) {
  if (!meta || meta.corrupt || !meta.fetchedAt) return false;
  const fetched = Date.parse(meta.fetchedAt);
  if (!Number.isFinite(fetched)) return false;
  const ageMs = now - fetched;
  // A marker dated in the future is a clock change, not a fresh cache; treat
  // it as stale so the next run replaces it rather than trusting it forever.
  if (ageMs < 0) return false;
  return ageMs <= maxAgeDays * 86_400_000;
}

/** Age of a cache in whole days, or null when there is none. */
export function cacheAgeDays(meta, now = Date.now()) {
  if (!meta?.fetchedAt) return null;
  const fetched = Date.parse(meta.fetchedAt);
  if (!Number.isFinite(fetched)) return null;
  return Math.max(0, Math.floor((now - fetched) / 86_400_000));
}

/**
 * Find the register CSV's current URL in a GOV.UK Content API response.
 *
 * The asset URL carries a content hash and changes on every publication, so it
 * cannot be hardcoded — a pinned URL keeps serving one frozen day's snapshot
 * (or 404s) with nothing in the output saying so. The publication's own
 * attachment list is the authority.
 *
 * @param {object} payload - Parsed Content API JSON.
 * @returns {{url: string, filename: string|null, publishedAt: string|null}}
 */
export function pickRegisterCsvUrl(payload) {
  const attachments = payload?.details?.attachments;
  if (!Array.isArray(attachments) || !attachments.length) {
    throw new Error('GOV.UK Content API returned no attachments for the sponsor register');
  }
  const csv = attachments.find(
    (a) => a?.url && (a.content_type === 'text/csv' || /\.csv$/i.test(String(a.url))),
  );
  if (!csv) {
    throw new Error(
      `GOV.UK Content API lists ${attachments.length} attachment(s) but no CSV — the publication's format changed; check ${REGISTER_PAGE}`,
    );
  }
  return {
    url: registerAssetUrl(csv.url, REGISTER_PAGE).href,
    filename: csv.filename || null,
    publishedAt: payload?.public_updated_at || payload?.updated_at || null,
  };
}

/**
 * Hosts the register CSV may be downloaded from. The URL comes out of a JSON
 * payload, so it is checked before anything is fetched: a changed or tampered
 * response must not point an 11 MB download at an arbitrary or internal host.
 */
const REGISTER_ASSET_HOSTS = new Set(['assets.publishing.service.gov.uk', 'www.gov.uk']);

/**
 * Resolve `href` against `base` and refuse anything that is not https on a
 * REGISTER_ASSET_HOSTS host.
 *
 * @returns {URL}
 */
function registerAssetUrl(href, base) {
  const url = new URL(href, base);
  if (url.protocol !== 'https:' || !REGISTER_ASSET_HOSTS.has(url.hostname)) {
    throw new Error(`refusing register CSV from an unexpected host: ${url.href}`);
  }
  return url;
}

/** Redirects followed for one CSV download before giving up. */
const MAX_REGISTER_REDIRECTS = 5;

/**
 * Fetch the register CSV, following redirects one hop at a time.
 *
 * GOV.UK redirects a superseded asset URL to the current snapshot (the
 * 2026-10-23 file 301s to the 2026-10-27 one), so redirects cannot simply be
 * refused. fetch()'s automatic following would skip the host check on every
 * hop after the first, so each Location is checked the same way the attachment
 * URL was before it is requested.
 *
 * @param {string} url - Already checked by pickRegisterCsvUrl().
 * @returns {Promise<{res: Response, url: string}>} The final response and the URL it came from.
 */
export async function fetchRegisterCsv(url, { timeoutMs = 120_000, fetchImpl = fetch } = {}) {
  let current = registerAssetUrl(url);
  for (let hop = 0; hop <= MAX_REGISTER_REDIRECTS; hop++) {
    const res = await fetchImpl(current.href, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/csv' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return { res, url: current.href };
    current = registerAssetUrl(location, current);
  }
  throw new Error(`register CSV download redirected more than ${MAX_REGISTER_REDIRECTS} times (${url})`);
}

/** Minimum plausible register size, below which a download is treated as truncated. */
const MIN_REGISTER_ROWS = 1000;

/**
 * Download the current register and replace the cache.
 *
 * Written CSV-first, marker-last, each through a temp file and a rename, for
 * the reason readCacheMeta() documents: a half-written cache must look absent,
 * never fresh. The row count is checked before the marker is written, so a
 * truncated or error-page response is rejected instead of being cached as a
 * register in which every employer is missing.
 *
 * @returns {Promise<{meta: object, csvText: string}>}
 */
export async function refreshCache({ timeoutMs = 120_000, cacheDir = CACHE_DIR, csvPath = CACHE_CSV, metaPath = CACHE_META } = {}) {
  const headers = { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'application/json' };

  const apiRes = await fetch(REGISTER_CONTENT_API, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!apiRes.ok) throw new Error(`GOV.UK Content API returned HTTP ${apiRes.status} for the sponsor register`);
  const source = pickRegisterCsvUrl(await apiRes.json());

  const { res: csvRes, url: csvUrl } = await fetchRegisterCsv(source.url, { timeoutMs });
  if (!csvRes.ok) throw new Error(`register CSV download returned HTTP ${csvRes.status} (${csvUrl})`);
  const csvText = await csvRes.text();

  const parsed = parseRegister(csvText);
  if (parsed.rowCount < MIN_REGISTER_ROWS) {
    throw new Error(
      `register CSV parsed to only ${parsed.rowCount} row(s) — refusing to cache a truncated register, since every lookup against it would read as "not found". Source: ${csvUrl}`,
    );
  }

  mkdirSync(cacheDir, { recursive: true });
  writeAtomic(csvPath, csvText);

  const meta = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: csvUrl,
    // After a redirect the file served is not the one the Content API named.
    sourceFilename: csvUrl === source.url ? source.filename : decodeURIComponent(new URL(csvUrl).pathname.split('/').pop()) || null,
    publishedAt: source.publishedAt,
    contentApi: REGISTER_CONTENT_API,
    registerPage: REGISTER_PAGE,
    rowCount: parsed.rowCount,
    organisationCount: parsed.organisations.length,
    bytes: Buffer.byteLength(csvText, 'utf-8'),
    columns: parsed.header,
  };
  writeAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  return { meta, csvText };
}

/** Write via temp file + rename, so a reader never sees a partial file. */
function writeAtomic(filePath, text) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    writeFileSync(tempPath, text, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (err) {
    try { unlinkSync(tempPath); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Get a usable register, fetching only when the cache cannot serve the run.
 *
 * Precedence: an explicit `--register` path (hermetic, never fetches) > a fresh
 * cache > a download > a STALE cache with a loud warning. The last one matters:
 * offline, a week-old register is a far better answer than none, because the
 * alternative is reporting every employer as unconfirmed for a reason that has
 * nothing to do with the register.
 *
 * @returns {Promise<{csvText: string, meta: object, stale: boolean, fetched: boolean, warnings: string[]}>}
 */
export async function loadRegister({ registerPath = null, maxAgeDays = DEFAULT_MAX_AGE_DAYS, refresh = false, offline = false } = {}) {
  const warnings = [];

  if (registerPath) {
    if (!existsSync(registerPath)) throw new Error(`register file not found: ${registerPath}`);
    return {
      csvText: readFileSync(registerPath, 'utf-8'),
      meta: { source: 'local', path: registerPath, fetchedAt: null },
      stale: false,
      fetched: false,
      warnings,
    };
  }

  const meta = readCacheMeta();
  if (meta?.corrupt) {
    warnings.push('cached register CSV does not match its staleness marker (interrupted download?) — re-downloading');
  }
  const fresh = !refresh && isCacheFresh(meta, maxAgeDays);

  if (fresh) {
    return { csvText: readFileSync(CACHE_CSV, 'utf-8'), meta, stale: false, fetched: false, warnings };
  }

  if (offline) {
    if (meta && !meta.corrupt) {
      warnings.push(`--offline: using a cached register ${cacheAgeDays(meta)} day(s) old (max age ${maxAgeDays})`);
      return { csvText: readFileSync(CACHE_CSV, 'utf-8'), meta, stale: true, fetched: false, warnings };
    }
    throw new Error(`--offline and no usable cached register at ${CACHE_CSV}. Run once without --offline, or pass --register <path>.`);
  }

  try {
    const { meta: freshMeta, csvText } = await refreshCache();
    return { csvText, meta: freshMeta, stale: false, fetched: true, warnings };
  } catch (err) {
    if (meta && !meta.corrupt) {
      warnings.push(
        `register download failed (${err.message}) — falling back to the cached snapshot, ${cacheAgeDays(meta)} day(s) old. Verdicts below do not reflect licences granted or revoked since then.`,
      );
      return { csvText: readFileSync(CACHE_CSV, 'utf-8'), meta, stale: true, fetched: false, warnings };
    }
    throw new Error(`could not obtain the sponsor register and no cache exists: ${err.message}`);
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

const ICON = { licensed: '✅', ambiguous: '❓', 'not-found': '⚠️' };

const UNCONFIRMED_FOOTER = [
  '',
  'READ "not-found" AS UNCONFIRMED, NEVER AS "DOES NOT SPONSOR".',
  'The register lists licence holders\' LEGAL names. A UK subsidiary hiring under',
  'a parent\'s licence, a trading or brand name, and a licence granted since this',
  'snapshot all read as absent here. Confirm the hiring entity before dropping a',
  'role — skipping a viable employer is the expensive mistake, not one extra check.',
  `Verify by hand: ${REGISTER_PAGE}`,
  '',
].join('\n');

function registerProvenance(meta, stale) {
  if (!meta) return 'register: unknown source';
  if (meta.source === 'local') return `register: local file ${meta.path}`;
  const age = cacheAgeDays(meta);
  const published = meta.publishedAt ? `, published ${String(meta.publishedAt).slice(0, 10)}` : '';
  return `register: cached snapshot ${age === null ? 'of unknown age' : `${age} day(s) old`}${published}${stale ? ' — STALE' : ''}`;
}

function renderOrgLine(org, indent = '    ') {
  const where = [org.town, org.county].filter(Boolean).join(', ');
  // On a candidate list of a dozen rows sharing one common word, "shares 4
  // words" is the fastest way for a reader to find the row worth checking.
  const shared = typeof org.sharedWords === 'number' && org.sharedWords > 0
    ? ` · shares ${org.sharedWords} word(s) with the query`
    : '';
  const routes = org.routes?.length ? org.routes.join('; ') : 'no route published';
  const ratings = org.ratings?.length ? org.ratings.join('; ') : 'rating not published';
  return [
    `${indent}${org.name}${where ? ` — ${where}` : ''}${shared}`,
    `${indent}  routes: ${routes}`,
    `${indent}  type/rating: ${ratings}`,
  ].join('\n');
}

export function renderCompanySummary(result, meta, stale, warnings = []) {
  const lines = ['', `SPONSOR LICENCE CHECK — ${result.query || '(no name)'}`, ''];
  for (const w of warnings) lines.push(`  ⚠️  ${w}`);
  if (warnings.length) lines.push('');
  lines.push(`  ${ICON[result.verdict]} ${result.verdict.toUpperCase()}${result.matchTier ? ` (match: ${result.matchTier})` : ''}`);
  if (result.verdict === 'licensed') {
    lines.push(`  ${SKILLED_WORKER_ROUTE} route: ${result.skilledWorker ? 'YES' : 'NO — other routes only'}`);
  }
  lines.push('');
  lines.push(`  ${result.note}`);
  if (result.organisations.length) {
    lines.push('', '  Register evidence:');
    for (const org of result.organisations) lines.push(renderOrgLine(org));
  }
  if (result.candidates.length && !result.organisations.length) {
    lines.push('', `  Candidate register organisations (${result.candidateCount}${result.truncated ? `, showing ${result.candidates.length}` : ''}) — none confirmed:`);
    for (const org of result.candidates) lines.push(renderOrgLine(org));
  }
  lines.push('', `  ${registerProvenance(meta, stale)}`);
  lines.push(UNCONFIRMED_FOOTER);
  return lines.join('\n');
}

export function renderAnnotationSummary({ employers, totals }, meta, stale, label, warnings = []) {
  const lines = ['', `SPONSOR LICENCE CROSS-CHECK — ${label}`, ''];
  for (const w of warnings) lines.push(`  ⚠️  ${w}`);
  if (warnings.length) lines.push('');

  const order = { licensed: 0, ambiguous: 1, 'not-found': 2 };
  const sorted = [...employers].sort(
    (a, b) => order[a.verdict] - order[b.verdict] || a.query.localeCompare(b.query),
  );

  for (const e of sorted) {
    const routes = e.organisations[0]?.routes?.join('; ');
    const detail = e.verdict === 'licensed'
      ? `${e.organisations[0].name}${e.organisations[0].rating ? ` (${e.organisations[0].rating} rating)` : ''}${e.skilledWorker ? '' : ' — NOT Skilled Worker'}`
      : e.verdict === 'ambiguous'
        ? `${e.candidateCount} candidate(s), none confirmed`
        : 'not on this snapshot — UNCONFIRMED';
    lines.push(`  ${ICON[e.verdict]} ${e.query}`);
    lines.push(`       ${detail}`);
    if (e.verdict === 'licensed' && !e.skilledWorker) lines.push(`       routes: ${routes || 'none published'}`);
  }

  const pct = totals.employers ? Math.round((totals.licensed / totals.employers) * 100) : 0;
  lines.push(
    '',
    `  ${totals.employers} employer(s): ${totals.licensed} licensed (${pct}%), ${totals.ambiguous} ambiguous, ${totals.notFound} unconfirmed`,
    `  of the licensed: ${totals.licensedSkilledWorker} cover ${SKILLED_WORKER_ROUTE}, ${totals.licensedOtherRouteOnly} do NOT`,
    `  match tiers: ${Object.entries(totals.byTier).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    '',
    `  ${registerProvenance(meta, stale)}`,
  );
  lines.push(UNCONFIRMED_FOOTER);
  return lines.join('\n');
}

// ── Self-test ──────────────────────────────────────────────────────────────

/**
 * Fixture mirroring the real file's shape: one row per (organisation, route),
 * quoted fields containing commas, leading spaces in the name column, and a
 * sponsor licensed for a non-Skilled-Worker route only.
 */
export const REGISTER_FIXTURE = [
  'Organisation Name,Town/City,County,Type & Rating,Route',
  ' Wayve Technologies Ltd,London,,Worker (A rating),Skilled Worker',
  ' Wayve Technologies Ltd,London,,Worker (A rating),Global Business Mobility: Senior or Specialist Worker',
  'Northwind Robotics Limited,"Colchester, ",Essex,Worker (A rating),Skilled Worker',
  'Northwind Robotics Holdings Ltd,Ipswich,Suffolk,Worker (B rating),Skilled Worker',
  'Globex Creative Ltd,Manchester,,Temporary Worker (A rating),Creative Worker',
  'University of Essex,Colchester,Essex,Worker (A rating),Skilled Worker',
  'Go Daddy Operating Company UK Ltd,London,,Worker (A rating),Skilled Worker',
  'Acme Ltd,Leeds,,Worker (A rating),Skilled Worker',
  'Acme Ltd,Bristol,,Worker (A rating),Skilled Worker',
  'Zephyr Analytics UK Limited,Reading,Berkshire,Worker (A rating),Skilled Worker',
  'Colne Valley Data Systems Ltd,Colchester,Essex,Worker (A rating),Skilled Worker',
  'Lumen Labs Ltd,Bath,,Worker (A rating),Skilled Worker',
  'Eastside Community Mental Health NHS Foundation Trust,Ipswich,Suffolk,Worker (A rating),Skilled Worker',
  '',
].join('\n');

function selfTest() {
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  const parsed = parseRegister(REGISTER_FIXTURE);
  const index = buildRegisterIndex(parsed.organisations);

  assert(parsed.rowCount === 13, `fixture has 13 data rows, parsed ${parsed.rowCount}`);
  // The two Wayve rows are one organisation on two routes; the two Acme rows
  // share a name but sit in different towns, so they stay two licence holders.
  assert(parsed.organisations.length === 12, `fixture folds to 12 organisations, got ${parsed.organisations.length}`);

  const wayveOrg = parsed.organisations.find((o) => o.name === 'Wayve Technologies Ltd');
  assert(wayveOrg.routes.length === 2, 'both of one organisation\'s routes are folded into one entry');
  assert(wayveOrg.skilledWorker === true, 'Skilled Worker route is detected');
  assert(wayveOrg.rating === 'A', 'rating letter is extracted from "Worker (A rating)"');

  // The headline case: a brand name resolving to the registered legal name.
  const wayve = lookupSponsor(index, 'Wayve');
  assert(wayve.verdict === 'licensed', `"Wayve" -> licensed, got ${wayve.verdict}`);
  // 'token-trimmed' rather than 'strong': dropping the register's legal suffix
  // makes the two names the SAME key, which is a stricter match than equal
  // distinctive sets, so that tier is reached first.
  assert(wayve.matchTier === 'token-trimmed', `"Wayve" matches on the token-trimmed tier, got ${wayve.matchTier}`);
  assert(wayve.skilledWorker === true, '"Wayve" licence covers Skilled Worker');

  // Exact name, and the separator-free key.
  assert(lookupSponsor(index, 'wayve technologies ltd').matchTier === 'exact', 'exact tier is case-insensitive');
  assert(lookupSponsor(index, 'GoDaddy Operating Company UK Ltd').verdict === 'licensed', 'spacing variant matches');

  // "UK" cannot discriminate inside a UK-only register, so the dominant
  // multinational shape resolves rather than falling to the weakest tier.
  const zephyr = lookupSponsor(index, 'Zephyr Analytics');
  assert(zephyr.verdict === 'licensed', `"Zephyr Analytics" -> licensed, got ${zephyr.verdict}`);
  assert(zephyr.matchTier === 'jurisdiction', `on the jurisdiction tier, got ${zephyr.matchTier}`);
  assert(zephyr.organisations[0].name === 'Zephyr Analytics UK Limited', 'the UK hiring entity is the evidence');
  // ...but a name made only of jurisdiction filler identifies nobody.
  for (const bare of ['UK', 'UK Ltd', 'GB Limited']) {
    const r = lookupSponsor(index, bare);
    assert(r.verdict !== 'licensed', `"${bare}" must not match an organisation, got ${r.verdict}`);
  }

  // On the register, wrong route — must not read as a green light.
  const globex = lookupSponsor(index, 'Globex Creative');
  assert(globex.verdict === 'licensed', `"Globex Creative" is on the register, got ${globex.verdict}`);
  assert(globex.skilledWorker === false, 'a Creative-Worker-only sponsor is flagged as NOT Skilled Worker');
  assert(/NOT for the Skilled Worker/.test(globex.note), 'the note says the route is not covered');

  // "Holdings" is corporate filler, so "Northwind Robotics" and "Northwind
  // Robotics Holdings Ltd" have the SAME distinctive tokens — two different
  // legal entities this rule genuinely cannot tell apart. That is reported as
  // ambiguous with both rows, never resolved to whichever one sorts first.
  const northwind = lookupSponsor(index, 'Northwind Robotics');
  assert(northwind.verdict === 'ambiguous', `"Northwind Robotics" -> ambiguous, got ${northwind.verdict}`);
  assert(northwind.matchTier === 'token-trimmed', `the ambiguity surfaces on the token-trimmed tier, got ${northwind.matchTier}`);
  assert(northwind.candidateCount === 2, `both Northwind entities are reported, got ${northwind.candidateCount}`);
  assert(
    northwind.candidates.some((o) => o.name === 'Northwind Robotics Limited')
    && northwind.candidates.some((o) => o.name === 'Northwind Robotics Holdings Ltd'),
    'both same-token entities appear as evidence',
  );
  // An exact name still beats the tie: the full registered name resolves to one.
  const northwindExact = lookupSponsor(index, 'Northwind Robotics Limited');
  assert(northwindExact.verdict === 'licensed', `the full legal name resolves, got ${northwindExact.verdict}`);
  assert(northwindExact.matchTier === 'exact', `on the exact tier, got ${northwindExact.matchTier}`);
  assert(northwindExact.organisations[0].rating === 'A', 'the A-rated entity is the one reported');

  // Two licence holders sharing a name in different towns -> ambiguous, both reported.
  const acme = lookupSponsor(index, 'Acme Ltd');
  assert(acme.verdict === 'ambiguous', `two same-named licence holders -> ambiguous, got ${acme.verdict}`);
  assert(acme.candidateCount === 2, `both Acme rows are reported, got ${acme.candidateCount}`);

  // Containment is a candidate list, never a verdict.
  const essex = lookupSponsor(index, 'Essex');
  assert(essex.verdict === 'ambiguous', `"Essex" -> ambiguous, got ${essex.verdict}`);
  assert(essex.matchTier === 'partial', `"Essex" is a partial match, got ${essex.matchTier}`);
  assert(essex.organisations.length === 0, 'a partial match never fills organisations[]');

  // The legal suffix the register always carries and a posting never does.
  const lumen = lookupSponsor(index, 'LumenLabs');
  assert(lumen.verdict === 'licensed', `"LumenLabs" -> licensed, got ${lumen.verdict}`);
  assert(lumen.matchTier === 'token-trimmed', `on the token-trimmed tier, got ${lumen.matchTier}`);
  assert(lumen.organisations[0].name === 'Lumen Labs Ltd', 'the spaced, suffixed register name is the evidence');

  // Two or more shared words, neither name containing the other (FT vs
  // Foundation Trust) — the last-resort tier, and the real row must rank first.
  const trust = lookupSponsor(index, 'Eastside Community Mental Health NHS FT');
  assert(trust.verdict === 'ambiguous', `an abbreviated trust name -> ambiguous, got ${trust.verdict}`);
  assert(trust.candidates[0].name === 'Eastside Community Mental Health NHS Foundation Trust',
    'the row sharing the most words ranks first');
  assert(trust.candidates[0].relation === 'shares-two-or-more-words', 'the relation names the shape');
  assert(trust.candidates[0].sharedWords >= 2, 'the shared-word count is reported as evidence');

  // An ALL-CAPS query read as an initialism of a longer registered name.
  const cvds = lookupSponsor(index, 'CVDS');
  assert(cvds.verdict === 'ambiguous', `"CVDS" -> ambiguous, got ${cvds.verdict}`);
  assert(cvds.candidateCount === 1 && cvds.candidates[0].name === 'Colne Valley Data Systems Ltd',
    'the expansion is offered as a candidate');
  assert(cvds.candidates[0].relation === 'register-name-expands-the-initials', 'the relation names the shape');
  assert(/NOT confirmed/.test(cvds.note), 'an initialism candidate is never presented as confirmed');
  // Mixed case is an ordinary short name, not an initialism — "Rex" must not
  // be expanded into every register name starting R-E.
  assert(initialismKey('Cvds') === null, 'a mixed-case query is not an initialism');
  assert(initialismKey('LSEG') === 'lseg', 'an all-caps query is');
  assert(initialismKey('L.S.E.G.') === 'lseg', 'punctuation in an initialism is ignored');
  assert(initialismKey('CONFIDENTIAL') === null, 'a long all-caps word is not an initialism');
  assert(lookupSponsor(index, 'Cvds').verdict === 'not-found', 'mixed case does not reach the initialism tier');

  // Absence is UNCONFIRMED and says so.
  const missing = lookupSponsor(index, 'Zetatech Research');
  assert(missing.verdict === 'not-found', `an absent employer -> not-found, got ${missing.verdict}`);
  assert(/UNCONFIRMED/.test(missing.note), 'the not-found note says UNCONFIRMED');
  assert(!/does not sponsor|cannot sponsor/i.test(missing.note), 'the not-found note never claims the employer cannot sponsor');

  // Placeholders never match anything.
  for (const placeholder of ['?', 'Stealth Startup', 'Confidential', '']) {
    const r = lookupSponsor(index, placeholder);
    assert(r.verdict === 'not-found', `placeholder "${placeholder}" -> not-found, got ${r.verdict}`);
    assert(r.organisations.length === 0 && r.candidates.length === 0, `placeholder "${placeholder}" matched nothing`);
  }

  // Staleness arithmetic.
  const now = Date.parse('2026-10-23T12:00:00Z');
  const metaAt = (iso) => ({ fetchedAt: iso, bytes: 1 });
  assert(isCacheFresh(metaAt('2026-10-22T12:00:00Z'), 7, now), 'a 1-day-old cache is fresh');
  assert(!isCacheFresh(metaAt('2026-10-01T12:00:00Z'), 7, now), 'a 22-day-old cache is stale');
  assert(!isCacheFresh(metaAt('2026-11-01T12:00:00Z'), 7, now), 'a future-dated cache is treated as stale');
  assert(!isCacheFresh(null, 7, now), 'no cache is not fresh');
  assert(!isCacheFresh({ ...metaAt('2026-10-22T12:00:00Z'), corrupt: true }, 7, now), 'a corrupt cache is not fresh');
  assert(cacheAgeDays(metaAt('2026-10-16T12:00:00Z'), now) === 7, 'cache age in whole days');

  // Content API attachment selection.
  const picked = pickRegisterCsvUrl({
    public_updated_at: '2026-10-23T08:32:45Z',
    details: {
      attachments: [
        { url: 'https://assets.publishing.service.gov.uk/media/x/notes.pdf', content_type: 'application/pdf' },
        { url: 'https://assets.publishing.service.gov.uk/media/x/reg.csv', content_type: 'text/csv', filename: 'reg.csv' },
      ],
    },
  });
  assert(picked.url.endsWith('reg.csv'), 'the CSV attachment is picked over the PDF');
  assert(picked.publishedAt === '2026-10-23T08:32:45Z', 'the publication date is carried through');
  let threw = false;
  try { pickRegisterCsvUrl({ details: { attachments: [{ url: 'a.pdf', content_type: 'application/pdf' }] } }); }
  catch { threw = true; }
  assert(threw, 'a publication with no CSV throws rather than guessing');

  // Input extraction.
  const trackerFixture = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-05 | Wayve | AI Engineer | 4.1/5 | Evaluated | ✅ | [1](r1.md) | n |',
    '| 2 | 2026-10-06 | Wayve | Junior SWE | 4.0/5 | Applied | ✅ | [2](r2.md) | n |',
    '| 3 | 2026-10-06 | Zetatech Research | Research Analyst | 3.8/5 | Evaluated | ❌ | [3](r3.md) | n |',
  ].join('\n');
  const trackerCompanies = extractTrackerCompanies(trackerFixture);
  assert(trackerCompanies.length === 2, `two distinct tracker employers, got ${trackerCompanies.length}`);
  assert(trackerCompanies[0].rows.length === 2, 'both rows for one employer are kept as context');

  const pipelineFixture = [
    '## Pending',
    '',
    '- [ ] https://jobs.ashbyhq.com/wayve/abc | Wayve | AI Engineer | London | rank: 4.0/5',
    '- [x] https://job-boards.greenhouse.io/globex/1 | Globex Creative | Designer | Manchester',
    '- [ ] https://example.invalid/bare-url-with-no-company',
    '- [ ] not-a-url | Nope | Role',
  ].join('\n');
  const pipelineCompanies = extractPipelineCompanies(pipelineFixture);
  assert(pipelineCompanies.length === 2, `pipeline rows with a company field only, got ${pipelineCompanies.length}`);
  assert(!pipelineCompanies.some((c) => c.company === 'Nope'), 'a row whose first field is not a URL is skipped');

  // Roll-up.
  const { employers, totals } = annotateCompanies(index, trackerCompanies);
  assert(employers.length === 2, 'one verdict per distinct employer');
  assert(totals.licensed === 1 && totals.notFound === 1, `roll-up counts verdicts: ${JSON.stringify(totals)}`);
  assert(totals.resolvedRate === 0.5, `resolution rate is reported: ${totals.resolvedRate}`);

  if (failures.length) {
    for (const f of failures) console.error(`SELF-TEST FAIL: ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('sponsor-check self-test OK (register parsing, match tiers, verdict wording, cache staleness, extraction, roll-up)');
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (hasFlag(args, '--self-test')) { selfTest(); return; }

  const summaryMode = hasFlag(args, '--summary');
  const registerPath = flagValue(args, '--register') || null;
  const maxAgeDaysRaw = flagValue(args, '--max-age-days');
  const maxAgeDays = safeIntFlag(maxAgeDaysRaw, DEFAULT_MAX_AGE_DAYS);
  if (maxAgeDaysRaw !== undefined && String(maxAgeDaysRaw) !== String(maxAgeDays)) {
    console.error(`Error: --max-age-days must be a non-negative integer (got "${maxAgeDaysRaw}")`);
    process.exitCode = 1;
    return;
  }
  const refresh = hasFlag(args, '--refresh');
  const offline = hasFlag(args, '--offline');

  if (hasFlag(args, '--cache-status')) {
    const meta = readCacheMeta();
    const status = {
      cached: Boolean(meta),
      path: CACHE_CSV,
      ageDays: cacheAgeDays(meta),
      fresh: isCacheFresh(meta, maxAgeDays),
      maxAgeDays,
      meta,
    };
    if (summaryMode) {
      console.log('');
      console.log(`SPONSOR REGISTER CACHE — ${CACHE_CSV}`);
      console.log('');
      if (!meta) console.log('  not cached yet — the next check downloads it once');
      else {
        console.log(`  fetched: ${meta.fetchedAt} (${status.ageDays} day(s) ago)${status.fresh ? '' : ' — STALE'}`);
        console.log(`  published: ${meta.publishedAt || 'unknown'}`);
        console.log(`  rows: ${meta.rowCount} across ${meta.organisationCount} organisation(s)`);
        console.log(`  source: ${meta.sourceUrl}`);
        if (meta.corrupt) console.log('  ⚠️  the CSV does not match this marker — it will be re-downloaded');
      }
      console.log('');
    } else {
      console.log(JSON.stringify(status, null, 2));
    }
    return;
  }

  const company = flagValue(args, '--company') ?? null;
  const filePath = flagValue(args, '--file') ?? null;
  const trackerMode = hasFlag(args, '--tracker');
  const pipelineMode = hasFlag(args, '--pipeline');

  const modes = [company !== null, filePath !== null, trackerMode, pipelineMode].filter(Boolean).length;
  if (modes === 0) {
    console.error('Error: nothing to check — pass --company <name>, --tracker, --pipeline or --file <path>.\n');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (modes > 1) {
    console.error('Error: pass exactly ONE of --company, --tracker, --pipeline, --file — their outputs are different shapes.');
    process.exitCode = 1;
    return;
  }

  let register;
  try {
    register = await loadRegister({ registerPath, maxAgeDays, refresh, offline });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const parsed = parseRegister(register.csvText);
  const index = buildRegisterIndex(parsed.organisations);
  const registerMeta = {
    ...register.meta,
    stale: register.stale,
    fetchedThisRun: register.fetched,
    rowCount: parsed.rowCount,
    organisationCount: parsed.organisations.length,
  };

  if (company !== null) {
    const result = lookupSponsor(index, company);
    if (summaryMode) console.log(renderCompanySummary(result, register.meta, register.stale, register.warnings));
    else {
      console.log(JSON.stringify({
        ...result,
        unconfirmedMeans: 'not-found means UNCONFIRMED, never "does not sponsor" — the register lists licence holders\' legal names and lags new licences',
        register: registerMeta,
        warnings: register.warnings,
      }, null, 2));
    }
    return;
  }

  const target = filePath ?? (trackerMode ? TRACKER_PATH : PIPELINE_PATH);
  if (!existsSync(target)) {
    console.error(`Error: no file to annotate at ${target}`);
    process.exitCode = 1;
    return;
  }
  const content = readFileSync(target, 'utf-8');
  const { source, companies } = filePath
    ? extractCompanies(content)
    : { source: trackerMode ? 'tracker' : 'pipeline', companies: trackerMode ? extractTrackerCompanies(content) : extractPipelineCompanies(content) };

  if (!companies.length) {
    console.error(`Error: no employer names found in ${target} (read as ${source} format)`);
    process.exitCode = 1;
    return;
  }

  const annotated = annotateCompanies(index, companies);
  if (summaryMode) {
    console.log(renderAnnotationSummary(annotated, register.meta, register.stale, `${source}: ${target}`, register.warnings));
  } else {
    console.log(JSON.stringify({
      source,
      path: target,
      ...annotated,
      unconfirmedMeans: 'not-found means UNCONFIRMED, never "does not sponsor" — the register lists licence holders\' legal names and lags new licences',
      register: registerMeta,
      warnings: register.warnings,
    }, null, 2));
  }
}

// Only run main() when invoked directly, not when imported — the arg parsing
// above would otherwise read an importing test's argv.
if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exitCode = 1;
  });
}
