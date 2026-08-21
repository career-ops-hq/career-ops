#!/usr/bin/env node
/**
 * reports-index.mjs — shared, stat-validated Machine-Summary cache over reports/
 *
 * Three analytics scripts (analyze-patterns.mjs, upskill.mjs, salary-gap.mjs)
 * each parsed every report's `## Machine Summary` fence with their own private
 * copy of the same fence regex + js-yaml load. That is three parsers to keep in
 * sync and O(reports) YAML parses on every run of every script. This module is
 * the ONE canonical parser plus a disposable on-disk cache keyed by (mtimeMs,
 * size): a report whose file stat is unchanged since it was last indexed is
 * trusted from cache and never re-read/re-parsed.
 *
 * The cache (data/reports-index.json) is a derived user-layer artifact: it is
 * never a source of truth, is safe to delete at any time, and is rebuilt on the
 * next run. Bumping INDEX_VERSION invalidates every on-disk entry.
 *
 * Schema split (per maintainer directive, #2385):
 *   - `summary`  = the parsed object filtered to CORE_SUMMARY_FIELDS — the
 *                  fields the pattern/upskill analyses consume.
 *   - `extras.salaryGap.advertised_comp` = namespaced out of the core allowlist
 *                  because only salary-gap.mjs reads it. Keeping it out of
 *                  `summary` means a new salary-only field never widens the core
 *                  allowlist the batch-prompt cross-check guards.
 *
 * Run: node reports-index.mjs --self-test
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
} from 'fs';
import { join, dirname, relative, isAbsolute, resolve, basename, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { writeFileAtomic } from './tracker-utils.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

// Bump to invalidate the entire on-disk cache. Any structural change to what an
// entry stores (fields, extras shape, stat semantics) MUST bump this so a stale
// cache from an older layout is rebuilt rather than trusted.
export const INDEX_VERSION = 1;

// The single source of truth for the core Machine-Summary allowlist. This is
// analyze-patterns.mjs's historical MACHINE_SUMMARY_FIELDS MINUS `advertised_comp`
// (now namespaced under extras.salaryGap). It MUST keep `via` and
// `company_confidential` — test-all.mjs's batch-prompt↔allowlist cross-check
// reads this set and asserts both are present.
export const CORE_SUMMARY_FIELDS = new Set([
  'company',
  'role',
  'score',
  'legitimacy_tier',
  'archetype',
  'final_decision',
  'hard_stops',
  'soft_gaps',
  'top_strengths',
  'risk_level',
  'confidence',
  'next_action',
  // Optional context fields accepted for future reports.
  'domain',
  'seniority',
  'remote',
  'team_size',
  // Issue 1380: predicted skip/discard reasons from the agent.
  'discard_reasons',
  'via',
  'company_confidential',
  'risk_summary',
  // Work-authorization / visa-sponsorship tier from Block A (report + Machine
  // Summary only). Allowlisted so it round-trips; no consumer logic yet.
  'work_auth',
  // Reporting line stated by the JD, verbatim (report + Machine Summary only).
  // Allowlisted so it round-trips; no consumer logic yet.
  'reports_to',
]);

// Report filename shape — same as salary-gap.mjs's REPORT_FILE_RE, so sentinels
// ({n}-RESERVED.md) and other junk in reports/ are skipped by enumeration.
export const REPORT_FILE_RE = /^(\d{3})-.*-(\d{4}-\d{2}-\d{2})\.md$/;

const DEFAULT_REPORTS_DIR = join(CAREER_OPS, 'reports');
const DEFAULT_CACHE_PATH = join(CAREER_OPS, 'data', 'reports-index.json');

/**
 * The ONE canonical Machine-Summary parser. Fence accepts yaml/yml/json (JSON
 * is a YAML subset, so js-yaml loads all three). Returns the FULL parsed object
 * unfiltered, or null on: no fence, empty fence, parse error, or a non-object
 * (scalar/array) top level.
 *
 * @param {string} content - Full report file content.
 * @returns {object|null} Parsed Machine-Summary object, or null.
 */
export function parseMachineSummary(content) {
  const fenceMatch = String(content ?? '').match(
    /##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i,
  );
  if (!fenceMatch) return null;
  const raw = fenceMatch[1].trim();
  if (!raw) return null;
  try {
    const parsed = yamlLoad(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Split a parsed Machine Summary into the core `summary` (filtered to
 * CORE_SUMMARY_FIELDS) and `extras` (currently just salary-gap's namespaced
 * advertised_comp). Deterministic: extras.salaryGap.advertised_comp is always
 * emitted, value-or-null.
 *
 * @param {object} parsed - Output of parseMachineSummary (a non-null object).
 * @returns {{summary: object, extras: {salaryGap: {advertised_comp: *}}}}
 */
export function splitEntry(parsed) {
  const summary = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) {
      if (CORE_SUMMARY_FIELDS.has(key)) summary[key] = value;
    }
  }
  return {
    summary,
    extras: { salaryGap: { advertised_comp: parsed?.advertised_comp ?? null } },
  };
}

// An entry for a report with no usable Machine Summary: summary is null so
// consumers can tell "no summary" apart from "empty summary object".
function emptyExtras() {
  return { salaryGap: { advertised_comp: null } };
}

function buildEntry(content, stat) {
  const parsed = parseMachineSummary(content);
  const split = parsed ? splitEntry(parsed) : { summary: null, extras: emptyExtras() };
  return {
    summary: split.summary,
    extras: split.extras,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

// Resolve an absolute-or-relative report path to the key the index uses (the
// bare filename). Returns null when the path does not live directly inside
// reportsDir — the same containment intent as analyze-patterns' lexical guard.
function toRelKey(p, reportsDir) {
  if (!p || typeof p !== 'string') return null;
  const abs = isAbsolute(p) ? p : join(reportsDir, basename(p));
  const rel = relative(reportsDir, resolve(abs));
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes('/') || rel.includes(sep)) {
    return null;
  }
  return rel;
}

// realpath-containment guard for every on-disk read this module performs. The
// filename filter (REPORT_FILE_RE) and toRelKey() are LEXICAL only: a symlink
// planted inside reportsDir (e.g. reports/042-evil-2026-01-01.md → /etc/passwd)
// has a perfectly valid lexical path, so statSync()/readFileSync() would follow
// it and splice an out-of-tree file's Machine Summary into the shared index and
// data/reports-index.json. Canonicalize the candidate with realpathSync and
// require it to stay inside the canonical reportsDir before any read (#2762).
// realRoot is resolved once per load; a candidate whose realpath cannot be
// resolved (broken/dangling link) is rejected. Mirrors withinReports() in
// analyze-patterns.mjs / upskill.mjs, applied here at the read site.
function realRootOf(reportsDir) {
  try {
    return realpathSync(reportsDir);
  } catch {
    return null;
  }
}

function withinRealRoot(abs, realRoot) {
  if (!realRoot) return false;
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    // ENOENT/ENOTDIR (missing or broken symlink) or any resolve failure: do not
    // read it. Enumeration already filtered to existing dir entries, so this is
    // an escaping/broken link, not a normal missing file.
    return false;
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  return real === realRoot || real.startsWith(rootWithSep);
}

function serializeIndex(entries) {
  const obj = { version: INDEX_VERSION, entries: {} };
  // Sorted keys → deterministic on-disk bytes across runs.
  for (const key of [...entries.keys()].sort()) {
    const e = entries.get(key);
    obj.entries[key] = {
      summary: e.summary,
      extras: e.extras,
      mtimeMs: e.mtimeMs,
      size: e.size,
    };
  }
  return JSON.stringify(obj, null, 2) + '\n';
}

// A cache entry is only safe to reuse if BOTH its stat metadata AND its nested
// payload are well-formed. Top-level version/shape checks are not enough: a
// stat-matching entry with a malformed `summary` or a missing
// `extras.salaryGap.advertised_comp` would be trusted and then crash a consumer
// (salary-gap.mjs reads `entry.extras.salaryGap.advertised_comp` directly). One
// bad entry poisons the whole cache, so any malformed entry forces a full
// rebuild rather than a silent per-entry repair (#2762).
function isValidCacheEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.mtimeMs !== 'number' || !Number.isFinite(e.mtimeMs)) return false;
  if (typeof e.size !== 'number' || !Number.isFinite(e.size)) return false;
  // summary is either null (no usable Machine Summary) or a plain object.
  if (e.summary !== null && (typeof e.summary !== 'object' || Array.isArray(e.summary))) return false;
  // extras must carry salaryGap.advertised_comp (value-or-null) so salary-gap's
  // `entry.extras.salaryGap.advertised_comp` read never dereferences undefined.
  const sg = e.extras && typeof e.extras === 'object' && !Array.isArray(e.extras)
    ? e.extras.salaryGap
    : null;
  if (!sg || typeof sg !== 'object' || Array.isArray(sg) || !('advertised_comp' in sg)) return false;
  return true;
}

function readCache(cachePath) {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === INDEX_VERSION &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    ) {
      // Validate every entry's nested shape before trusting ANY of them; a
      // single malformed entry rejects the whole cache (force rebuild).
      for (const key of Object.keys(parsed.entries)) {
        if (!isValidCacheEntry(parsed.entries[key])) return null;
      }
      return parsed.entries;
    }
  } catch {
    // Missing/corrupt/version-mismatch → rebuild from scratch.
  }
  return null;
}

/**
 * Load (or build) the stat-validated reports index.
 *
 * @param {object} [opts]
 * @param {string} [opts.reportsDir] - Directory of report files (default: <CAREER_OPS>/reports).
 * @param {string} [opts.cachePath] - On-disk cache path (default: <CAREER_OPS>/data/reports-index.json).
 * @param {boolean} [opts.noCache=false] - When true, never read and never write the JSON.
 * @returns {{get: Function, entries: Function, meta: object, [Symbol.iterator]: Function}}
 */
export function loadReportsIndex({
  reportsDir = DEFAULT_REPORTS_DIR,
  cachePath = DEFAULT_CACHE_PATH,
  noCache = false,
} = {}) {
  let files = [];
  try {
    files = readdirSync(reportsDir).filter((f) => REPORT_FILE_RE.test(f));
  } catch {
    files = [];
  }

  const cache = noCache ? null : readCache(cachePath);
  const realRoot = realRootOf(reportsDir);

  const entries = new Map();
  let reused = 0;
  let parsed = 0;
  for (const file of files) {
    const abs = join(reportsDir, file);
    // Reject a symlinked candidate whose realpath escapes reportsDir BEFORE any
    // stat/read — a lexically-valid filename is not proof the bytes live inside
    // reports/ (#2762).
    if (!withinRealRoot(abs, realRoot)) continue;
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    const cached = cache?.[file];
    // Trust the cache ONLY when BOTH mtimeMs and size match the fresh stat.
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      entries.set(file, {
        summary: cached.summary ?? null,
        extras: cached.extras ?? emptyExtras(),
        mtimeMs: cached.mtimeMs,
        size: cached.size,
      });
      reused += 1;
      continue;
    }
    let content;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    entries.set(file, buildEntry(content, stat));
    parsed += 1;
  }

  // Entries for files that no longer exist on disk are simply never added above,
  // so they drop out of both the in-memory index and the rewritten cache.
  if (!noCache) {
    try {
      writeFileAtomic(cachePath, serializeIndex(entries));
    } catch {
      // A read-only or missing data/ dir must not break analysis — the cache is
      // an optimization, not a requirement. Fall through with the in-memory map.
    }
  }

  return {
    meta: {
      version: INDEX_VERSION,
      count: entries.size,
      reused,
      parsed,
      reportsDir,
      cachePath: noCache ? null : cachePath,
    },
    /**
     * Entry for a report under reportsDir, parsing on demand if the path is in
     * reportsDir but not yet indexed. Returns null when the path is outside
     * reportsDir or the file cannot be read.
     */
    get(p) {
      const key = toRelKey(p, reportsDir);
      if (key === null) return null;
      if (entries.has(key)) return entries.get(key);
      const abs = join(reportsDir, key);
      // Same realpath-containment guard as the enumeration loop: toRelKey is
      // lexical, so an on-demand lookup of a symlink escaping reports/ must not
      // be read either (#2762).
      if (!withinRealRoot(abs, realRoot)) return null;
      let stat;
      let content;
      try {
        stat = statSync(abs);
        content = readFileSync(abs, 'utf-8');
      } catch {
        return null;
      }
      const entry = buildEntry(content, stat);
      entries.set(key, entry);
      return entry;
    },
    entries() {
      return entries.entries();
    },
    [Symbol.iterator]() {
      return entries.entries();
    },
  };
}

// ─────────────────────────────── Self-test ───────────────────────────────

async function _selfTest() {
  const fs = await import('fs');
  const os = await import('os');
  const { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, unlinkSync } = fs;
  const failures = [];
  const tmpRoots = [];

  const makeWorkspace = () => {
    const root = mkdtempSync(join(os.tmpdir(), 'reports-index-selftest-'));
    tmpRoots.push(root);
    const reportsDir = join(root, 'reports');
    const dataDir = join(root, 'data');
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    return { root, reportsDir, cachePath: join(dataDir, 'reports-index.json') };
  };

  const canonicalReport = (company = 'Acme', adv = '80-90k EUR') => `# 042 - ${company}

Some prose.

## Machine Summary

\`\`\`yaml
company: "${company}"
role: "Staff AI Engineer"
score: 4.4
via: "Hays"
company_confidential: true
advertised_comp: "${adv}"
\`\`\`
`;

  try {
    // ── 1. Fresh build parses a canonical report ────────────────────────────
    {
      const ws = makeWorkspace();
      const file = join(ws.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file, canonicalReport());
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const entry = idx.get(file);
      if (!entry) failures.push('1: fresh build returned no entry');
      if (entry?.summary?.company !== 'Acme') failures.push('1: core field company not parsed into summary');
      if (entry?.summary?.role !== 'Staff AI Engineer') failures.push('1: non-salary field role missing from summary');
      if (entry?.summary?.score !== 4.4) failures.push('1: numeric score not parsed');
      if (entry?.summary?.via !== 'Hays') failures.push('1: via not preserved in core summary');
      if (entry?.summary?.company_confidential !== true) failures.push('1: company_confidential not preserved in core summary');
      if ('advertised_comp' in (entry?.summary ?? {})) failures.push('1: advertised_comp must NOT be in core summary');
      if (entry?.extras?.salaryGap?.advertised_comp !== '80-90k EUR') failures.push('1: advertised_comp not extracted into extras.salaryGap');
    }

    // ── 2. Cache-trust proof: stat-match ⇒ trust; stat-mismatch ⇒ reparse ───
    {
      const ws = makeWorkspace();
      const file = join(ws.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file, canonicalReport('Acme', '80-90k EUR'));
      const st = fs.statSync(file);
      // Cache entry with a deliberately WRONG summary + WRONG advertised_comp,
      // but the file's REAL mtimeMs+size.
      const poisoned = {
        version: INDEX_VERSION,
        entries: {
          '042-acme-2026-01-01.md': {
            summary: { company: 'WRONG-CACHED', role: 'stale', score: 0.1 },
            extras: { salaryGap: { advertised_comp: '999k WRONG' } },
            mtimeMs: st.mtimeMs,
            size: st.size,
          },
        },
      };
      writeFileSync(ws.cachePath, JSON.stringify(poisoned));
      const idx1 = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const e1 = idx1.get(file);
      if (e1?.summary?.company !== 'WRONG-CACHED') failures.push('2: stat-match did not trust cache (reparsed instead of trusting)');
      if (e1?.extras?.salaryGap?.advertised_comp !== '999k WRONG') failures.push('2: stat-match did not trust cached advertised_comp');
      if (idx1.meta.reused !== 1 || idx1.meta.parsed !== 0) failures.push('2: expected reused=1 parsed=0 on stat-match');

      // Modify the file so size changes → cache entry must be invalidated.
      appendFileSync(file, '\nAppended bytes to change size.\n');
      const idx2 = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const e2 = idx2.get(file);
      if (e2?.summary?.company !== 'Acme') failures.push('2: stat-mismatch did not trigger reparse (still cached wrong summary)');
      if (e2?.extras?.salaryGap?.advertised_comp !== '80-90k EUR') failures.push('2: stat-mismatch did not reparse advertised_comp');
      if (idx2.meta.parsed !== 1) failures.push('2: expected parsed=1 after stat-mismatch');
    }

    // ── 3. Deleted report drops from index and rewritten cache ──────────────
    {
      const ws = makeWorkspace();
      const keep = join(ws.reportsDir, '001-keep-2026-01-01.md');
      const gone = join(ws.reportsDir, '002-gone-2026-01-02.md');
      writeFileSync(keep, canonicalReport('KeepCo'));
      writeFileSync(gone, canonicalReport('GoneCo'));
      loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath }); // seeds cache with both
      unlinkSync(gone);
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const names = [...idx].map(([k]) => k);
      if (names.includes('002-gone-2026-01-02.md')) failures.push('3: deleted report still present in loaded index');
      if (!names.includes('001-keep-2026-01-01.md')) failures.push('3: surviving report missing from index');
      const onDisk = JSON.parse(fs.readFileSync(ws.cachePath, 'utf-8'));
      if ('002-gone-2026-01-02.md' in onDisk.entries) failures.push('3: deleted report not dropped from rewritten cache');
    }

    // ── 4. Version bump rebuilds (stale entries ignored) ────────────────────
    {
      const ws = makeWorkspace();
      const file = join(ws.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file, canonicalReport('Acme'));
      const st = fs.statSync(file);
      const stale = {
        version: INDEX_VERSION - 1,
        entries: {
          '042-acme-2026-01-01.md': {
            summary: { company: 'STALE-VERSION' },
            extras: { salaryGap: { advertised_comp: null } },
            mtimeMs: st.mtimeMs,
            size: st.size,
          },
        },
      };
      writeFileSync(ws.cachePath, JSON.stringify(stale));
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const e = idx.get(file);
      if (e?.summary?.company !== 'Acme') failures.push('4: version mismatch did not force a full rebuild');
      if (idx.meta.parsed !== 1) failures.push('4: version mismatch should reparse, not reuse');
    }

    // ── 5. noCache: never reads, never writes ───────────────────────────────
    {
      const ws = makeWorkspace();
      const file = join(ws.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file, canonicalReport('Acme'));
      const st = fs.statSync(file);
      // A wrong cache that noCache must ignore, and must NOT overwrite.
      const wrongCacheBytes = JSON.stringify({
        version: INDEX_VERSION,
        entries: {
          '042-acme-2026-01-01.md': {
            summary: { company: 'SHOULD-BE-IGNORED' },
            extras: { salaryGap: { advertised_comp: null } },
            mtimeMs: st.mtimeMs,
            size: st.size,
          },
        },
      });
      writeFileSync(ws.cachePath, wrongCacheBytes);
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath, noCache: true });
      const e = idx.get(file);
      if (e?.summary?.company !== 'Acme') failures.push('5: noCache read the on-disk cache instead of reparsing');
      if (fs.readFileSync(ws.cachePath, 'utf-8') !== wrongCacheBytes) failures.push('5: noCache wrote/overwrote the cache file');

      // And when no cache exists, noCache must not create one.
      const ws2 = makeWorkspace();
      const file2 = join(ws2.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file2, canonicalReport('Acme'));
      const idx2 = loadReportsIndex({ reportsDir: ws2.reportsDir, cachePath: ws2.cachePath, noCache: true });
      if (idx2.get(file2)?.summary?.company !== 'Acme') failures.push('5: noCache fresh build produced wrong data');
      if (fs.existsSync(ws2.cachePath)) failures.push('5: noCache wrote a cache file where none existed');
    }

    // ── 6. Fence variants + malformed input ─────────────────────────────────
    {
      const ws = makeWorkspace();
      const write = (name, body) => writeFileSync(join(ws.reportsDir, name), body);
      write('010-yaml-2026-01-01.md', '## Machine Summary\n\n```yaml\ncompany: "YamlCo"\n```\n');
      write('011-yml-2026-01-01.md', '## Machine Summary\n\n```yml\ncompany: "YmlCo"\n```\n');
      write('012-json-2026-01-01.md', '## Machine Summary\n\n```json\n{"company": "JsonCo", "advertised_comp": "100k EUR"}\n```\n');
      write('013-nofence-2026-01-01.md', '# No machine summary here at all\n\nJust prose.\n');
      write('014-empty-2026-01-01.md', '## Machine Summary\n\n```yaml\n\n```\n');
      write('015-malformed-2026-01-01.md', '## Machine Summary\n\n```yaml\ncompany: "Unterminated\n  - : : bad\n```\n');
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const g = (n) => idx.get(join(ws.reportsDir, n));
      if (g('010-yaml-2026-01-01.md')?.summary?.company !== 'YamlCo') failures.push('6: yaml fence not parsed');
      if (g('011-yml-2026-01-01.md')?.summary?.company !== 'YmlCo') failures.push('6: yml fence not parsed');
      if (g('012-json-2026-01-01.md')?.summary?.company !== 'JsonCo') failures.push('6: json fence not parsed');
      if (g('012-json-2026-01-01.md')?.extras?.salaryGap?.advertised_comp !== '100k EUR') failures.push('6: json fence advertised_comp not extracted');
      if (g('013-nofence-2026-01-01.md')?.summary !== null) failures.push('6: missing fence must yield summary null');
      if (g('014-empty-2026-01-01.md')?.summary !== null) failures.push('6: empty fence must yield summary null');
      if (g('015-malformed-2026-01-01.md')?.summary !== null) failures.push('6: malformed yaml must yield summary null (no throw)');
    }

    // ── 7. parseMachineSummary/splitEntry direct contract ───────────────────
    {
      if (parseMachineSummary('no fence here') !== null) failures.push('7: parseMachineSummary should return null on no fence');
      if (parseMachineSummary('## Machine Summary\n\n```yaml\n- a\n- b\n```\n') !== null) failures.push('7: array top-level must be null');
      const { summary, extras } = splitEntry({ company: 'X', advertised_comp: '5k', not_a_field: 'drop' });
      if (summary.company !== 'X') failures.push('7: splitEntry dropped a core field');
      if ('not_a_field' in summary) failures.push('7: splitEntry kept a non-core field');
      if ('advertised_comp' in summary) failures.push('7: splitEntry leaked advertised_comp into summary');
      if (extras.salaryGap.advertised_comp !== '5k') failures.push('7: splitEntry did not namespace advertised_comp');
      if (splitEntry({ company: 'Y' }).extras.salaryGap.advertised_comp !== null) failures.push('7: splitEntry must emit advertised_comp=null when absent');
      // CORE_SUMMARY_FIELDS invariants the test-all cross-check depends on.
      if (!CORE_SUMMARY_FIELDS.has('via') || !CORE_SUMMARY_FIELDS.has('company_confidential')) failures.push('7: CORE_SUMMARY_FIELDS must contain via + company_confidential');
      if (CORE_SUMMARY_FIELDS.has('advertised_comp')) failures.push('7: CORE_SUMMARY_FIELDS must NOT contain advertised_comp');
    }

    // ── 8. Symlink escaping reportsDir is never stat/read into the index ─────
    // A lexically-valid report filename that is really a symlink whose target
    // lives OUTSIDE reportsDir must be rejected before any read, so an out-of-
    // tree file's Machine Summary never enters the shared index or the on-disk
    // cache (#2762). symlinkSync needs privilege on Windows — skip (do not fail)
    // the assertion when the platform refuses.
    {
      const ws = makeWorkspace();
      const real = join(ws.reportsDir, '001-real-2026-01-01.md');
      writeFileSync(real, canonicalReport('RealCo'));
      const outsideFile = join(ws.root, 'secret.md');
      writeFileSync(outsideFile, canonicalReport('LEAKED-SECRET'));
      const link = join(ws.reportsDir, '999-leak-2026-01-01.md');
      let linked = false;
      try {
        fs.symlinkSync(outsideFile, link);
        linked = true;
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'ENOSYS') {
          console.log(`reports-index self-test: skipping symlink-escape assertion (platform refused symlink: ${err.code})`);
        } else {
          throw err;
        }
      }
      if (linked) {
        const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
        const names = [...idx].map(([k]) => k);
        if (names.includes('999-leak-2026-01-01.md')) failures.push('8: symlink escaping reportsDir was read into the index (#2762)');
        if (idx.get(link) !== null) failures.push('8: get() followed a symlink escaping reportsDir (#2762)');
        if (!names.includes('001-real-2026-01-01.md')) failures.push('8: real in-tree report wrongly dropped alongside the symlink guard');
        const onDisk = JSON.parse(fs.readFileSync(ws.cachePath, 'utf-8'));
        if ('999-leak-2026-01-01.md' in onDisk.entries) failures.push('8: symlink escape leaked into the on-disk cache (#2762)');
      }
    }

    // ── 9. A malformed cache entry rejects the WHOLE cache (rebuild) ─────────
    // Valid JSON, correct version, stat-matching entry — but its nested payload
    // is malformed (extras.salaryGap missing). Trusting it would later crash
    // salary-gap's `entry.extras.salaryGap.advertised_comp` read, so a single
    // bad entry must force a full rebuild from disk (#2762).
    {
      const ws = makeWorkspace();
      const file = join(ws.reportsDir, '042-acme-2026-01-01.md');
      writeFileSync(file, canonicalReport('Acme', '80-90k EUR'));
      const st = fs.statSync(file);
      const malformed = {
        version: INDEX_VERSION,
        entries: {
          '042-acme-2026-01-01.md': {
            summary: { company: 'STALE' },
            extras: {}, // salaryGap.advertised_comp missing → malformed
            mtimeMs: st.mtimeMs,
            size: st.size,
          },
        },
      };
      writeFileSync(ws.cachePath, JSON.stringify(malformed));
      const idx = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      const e = idx.get(file);
      if (e?.summary?.company !== 'Acme') failures.push('9: malformed cache entry was trusted instead of forcing a rebuild (#2762)');
      if (e?.extras?.salaryGap?.advertised_comp !== '80-90k EUR') failures.push('9: rebuilt entry missing advertised_comp after malformed-cache rejection');
      if (idx.meta.parsed !== 1 || idx.meta.reused !== 0) failures.push('9: expected a full rebuild (parsed=1 reused=0) after a malformed cache entry');
      // The rewritten cache must now be well-formed and reusable next load.
      const idx2 = loadReportsIndex({ reportsDir: ws.reportsDir, cachePath: ws.cachePath });
      if (idx2.meta.reused !== 1) failures.push('9: rebuilt cache was not reused on the subsequent load');
    }
  } finally {
    for (const root of tmpRoots) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  if (failures.length > 0) {
    console.error(`reports-index self-test failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('reports-index self-test OK (fresh build + stat-trust/invalidate + deletion + version bump + no-cache + fence variants + split contract + symlink-escape guard + malformed-cache rebuild)');
  process.exit(0);
}

// ─────────────────────────────── CLI ─────────────────────────────────────

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.slice(2).includes('--self-test')) {
    _selfTest();
  } else {
    // Default: rebuild/refresh the on-disk cache and print a one-line summary.
    const idx = loadReportsIndex({ noCache: process.argv.slice(2).includes('--no-cache') });
    console.log(JSON.stringify(idx.meta, null, 2));
  }
}
