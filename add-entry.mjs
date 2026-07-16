#!/usr/bin/env node
/**
 * add-entry.mjs — Deterministic dedup + insertion for `/career-ops add`.
 *
 * The `add` mode (agent) does the fetching, extraction, ATS-bullet writing,
 * preview, and confirm-before-write gate. This helper does ONE thing: take a
 * structured payload of already-written markdown and insert it into the user's
 * `cv.md` and/or `article-digest.md` idempotently — skipping anything that is
 * already there. It never fabricates or rewrites content; it only places the
 * blocks the agent produced.
 *
 * Usage:
 *   node add-entry.mjs <payload.json> [--dry-run]
 *   node add-entry.mjs --stdin [--dry-run]        (read payload JSON from stdin)
 *
 * Payload shape (both keys optional, at least one required):
 *   {
 *     "cv": {
 *       "section": "Projects",                 // heading to insert under (## Projects)
 *       "dedupKey": "FraudShield",             // used to detect an existing entry
 *       "entry": "- **FraudShield** (Open Source) -- Real-time fraud detection..."
 *     },
 *     "articleDigest": {
 *       "dedupKey": "FraudShield",
 *       "entry": "## FraudShield -- Real-Time Fraud Detection\n\n**Hero metrics:** ..."
 *     }
 *   }
 *
 * Output: a JSON result to stdout, e.g.
 *   { "dryRun": false,
 *     "cv": { "status": "added", "section": "Projects" },
 *     "articleDigest": { "status": "duplicate" } }
 *
 * Exit codes: 0 on success (including a no-op "duplicate"); non-zero only on a
 * hard error (bad/empty payload, a requested target file missing, unwritable).
 *
 * Test isolation: CAREER_OPS_CV / CAREER_OPS_ARTICLE_DIGEST override the target
 * files so tests never touch a real user CV.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

const CV_FILE = process.env.CAREER_OPS_CV || join(CAREER_OPS, 'cv.md');
const ARTICLE_DIGEST_FILE = process.env.CAREER_OPS_ARTICLE_DIGEST || join(CAREER_OPS, 'article-digest.md');

// Normalize a title/heading for duplicate detection: lowercase, collapse to
// alphanumerics only. "FraudShield", "Fraud-Shield", "fraud shield" all match.
export function normalizeKey(s) {
  return typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
}

// Split a markdown doc into the block belonging to a `## <section>` heading:
// { before, heading, body, after }. `body` runs up to the next `## ` heading
// (or EOF). Returns null when the section is absent.
export function locateSection(md, section) {
  const target = normalizeKey(section);
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.*\S)\s*$/);
    if (m && normalizeKey(m[1]) === target) {
      let end = i + 1;
      while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
      return {
        before: lines.slice(0, i).join('\n'),
        heading: lines[i],
        body: lines.slice(i + 1, end).join('\n'),
        after: lines.slice(end).join('\n'),
      };
    }
  }
  return null;
}

// The identifiers an entry can be recognized by within a section: bold spans
// (**Name**) and any sub-headings (### / ####). Matching dedup against these
// discrete names — not the raw section text — stops a short key like "AI" from
// colliding with an unrelated substring (e.g. the "ai" inside "email").
export function extractIdentifiers(body) {
  const ids = [];
  for (const m of body.matchAll(/\*\*([^*]+)\*\*/g)) ids.push(m[1]);
  for (const m of body.matchAll(/^#{3,}\s+(.*\S)\s*$/gm)) ids.push(m[1]);
  return ids;
}

// Does the named CV section already contain an entry matching dedupKey?
// Compares the key against each entry's identifier (normalized equality), not a
// substring of the whole section body.
export function cvHasEntry(md, section, dedupKey) {
  const key = normalizeKey(dedupKey);
  if (!key) return false;
  const loc = locateSection(md, section);
  if (!loc) return false;
  return extractIdentifiers(loc.body).some(id => normalizeKey(id) === key);
}

// Insert a pre-formatted entry under `## <section>`, creating the section at
// end-of-file when absent. Trailing whitespace inside the section is trimmed so
// entries stack cleanly with a single blank line between the heading and body.
export function insertIntoCvSection(md, section, entry) {
  const block = entry.replace(/\s+$/, '');
  const loc = locateSection(md, section);
  if (!loc) {
    const base = md.replace(/\s+$/, '');
    return `${base}\n\n## ${section}\n\n${block}\n`;
  }
  const body = loc.body.replace(/\s+$/, '');
  const newBody = body ? `${body}\n${block}` : block;
  const parts = [loc.before, loc.heading, '', newBody, ''];
  const after = loc.after.replace(/^\n+/, '');
  const rebuilt = parts.join('\n') + (after ? `\n${after}` : '');
  return rebuilt.replace(/\n{3,}/g, '\n\n');
}

// article-digest.md is a sequence of `## <name> -- <tagline>` blocks separated
// by `---`. Dedup on the name (the heading text before the dash), matched by
// normalized equality or prefix so "## FraudShield -- Detection" matches the key
// "FraudShield" without a short key colliding on unrelated heading text.
export function articleDigestHasEntry(md, dedupKey) {
  const key = normalizeKey(dedupKey);
  if (!key) return false;
  for (const m of md.matchAll(/^##\s+(.*\S)\s*$/gm)) {
    const name = m[1].split(/\s+[—–-]{1,2}\s+/)[0];
    const n = normalizeKey(name);
    if (n === key || n.startsWith(key)) return true;
  }
  return false;
}

export function appendArticleDigest(md, entry) {
  const block = entry.replace(/\s+$/, '');
  const base = md.replace(/\s+$/, '');
  // Keep the existing `---`-separated block rhythm.
  return `${base}\n\n---\n\n${block}\n`;
}

/**
 * Pure core: given the current file contents and a payload, compute the new
 * contents and a per-target status. No I/O — this is what the tests exercise.
 * @returns {{ cv: string, articleDigest: string, result: object }}
 */
export function applyAdd(payload, { cvText = null, articleText = null } = {}) {
  if (!payload || typeof payload !== 'object' || (!payload.cv && !payload.articleDigest)) {
    throw new Error('payload must include at least one of: cv, articleDigest');
  }

  const result = {};
  let cv = cvText;
  let articleDigest = articleText;

  if (payload.cv) {
    const { section, dedupKey, entry } = payload.cv;
    if (!section || !entry) throw new Error('payload.cv requires { section, entry }');
    // dedupKey is what makes the insert idempotent — refuse to add without one
    // rather than silently allowing duplicate re-runs.
    if (!normalizeKey(dedupKey)) throw new Error('payload.cv requires a non-empty dedupKey (used for dedup/idempotency)');
    if (cvText === null) throw new Error(`cv.md not found — cannot add to a CV that does not exist`);
    if (cvHasEntry(cvText, section, dedupKey)) {
      result.cv = { status: 'duplicate', section };
    } else {
      cv = insertIntoCvSection(cvText, section, entry);
      result.cv = { status: 'added', section };
    }
  }

  if (payload.articleDigest) {
    const { dedupKey, entry } = payload.articleDigest;
    if (!entry) throw new Error('payload.articleDigest requires { entry }');
    if (!normalizeKey(dedupKey)) throw new Error('payload.articleDigest requires a non-empty dedupKey (used for dedup/idempotency)');
    // article-digest.md is optional; create it from a header when missing.
    const current = articleText === null
      ? '# Article Digest -- Proof Points\n\nCompact proof points from portfolio projects. Read by career-ops at evaluation time.\n'
      : articleText;
    if (articleDigestHasEntry(current, dedupKey)) {
      result.articleDigest = { status: 'duplicate' };
      articleDigest = articleText;
    } else {
      articleDigest = appendArticleDigest(current, entry);
      result.articleDigest = { status: articleText === null ? 'created' : 'added' };
    }
  }

  return { cv, articleDigest, result };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const useStdin = args.includes('--stdin');
  const fileArg = args.find(a => !a.startsWith('--'));

  if (!useStdin && !fileArg) {
    console.error('Usage: node add-entry.mjs <payload.json> [--dry-run]  (or --stdin)');
    process.exit(1);
  }

  let payload;
  try {
    const raw = useStdin ? await readStdin() : readFileSync(fileArg, 'utf-8');
    payload = JSON.parse(raw);
  } catch (e) {
    console.error(`add-entry: could not read/parse payload: ${e.message}`);
    process.exit(1);
  }

  const cvText = existsSync(CV_FILE) ? readFileSync(CV_FILE, 'utf-8') : null;
  const articleText = existsSync(ARTICLE_DIGEST_FILE) ? readFileSync(ARTICLE_DIGEST_FILE, 'utf-8') : null;

  let out;
  try {
    out = applyAdd(payload, { cvText, articleText });
  } catch (e) {
    console.error(`add-entry: ${e.message}`);
    process.exit(1);
  }

  if (!dryRun) {
    // Track what actually landed so a failure on the second write reports which
    // file was already mutated (the two writes aren't transactional).
    const written = [];
    try {
      if (payload.cv && out.result.cv?.status === 'added') {
        writeFileSync(CV_FILE, out.cv);
        written.push('cv.md');
      }
      if (payload.articleDigest && (out.result.articleDigest?.status === 'added' || out.result.articleDigest?.status === 'created')) {
        writeFileSync(ARTICLE_DIGEST_FILE, out.articleDigest);
        written.push('article-digest.md');
      }
    } catch (e) {
      console.error(`add-entry: write failed after writing [${written.join(', ') || 'nothing'}]: ${e.message}`);
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ dryRun, ...out.result }, null, 2));
}

// Only run main() when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
