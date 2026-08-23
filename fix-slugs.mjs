#!/usr/bin/env node

/**
 * fix-slugs.mjs — write verify-portals.mjs's suggested ATS slug fixes back
 * into portals.yml.
 *
 * verify-portals.mjs already probes every tracked company's ATS slug and, for
 * a failing Greenhouse/Ashby/Lever entry, cross-probes slug variants across
 * all three ATSes and attaches `suggested: { ats, slug }` when one resolves
 * (see discoverAlternates() in verify-portals.mjs). That tool is read-only —
 * this script is the write side: it reuses the SAME probe/suggestion logic
 * (no re-implementation, no HTML scraping, no hardcoded company list) and
 * patches the matching `tracked_companies` entry in portals.yml.
 *
 * Only entries verify-portals classifies as `missing` AND carries a
 * `suggested` alternate for are touched. Live/empty entries and genuinely
 * unresolved entries (no suggestion found) are left completely alone.
 *
 * The file is edited as text (line-level surgery inside the matching
 * company's block), not via full YAML parse+dump — portals.yml is full of
 * hand-written comments and documentation blocks that a `yaml.dump()`
 * round-trip would silently discard.
 *
 * Usage:
 *   node fix-slugs.mjs               # dry run (default, safe) — prints the diff, writes nothing
 *   node fix-slugs.mjs --dry-run     # same as above, explicit
 *   node fix-slugs.mjs --fix         # write the resolved slugs back to portals.yml
 *   node fix-slugs.mjs --apply       # alias for --fix
 *   node fix-slugs.mjs --file <path> # use a specific portals file
 *   node fix-slugs.mjs --help        # show this message (-h is an alias)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { verifyPortalsFile } from './verify-portals.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';

const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';

const KNOWN_FLAGS = ['--apply', '--dry-run', '--file', '--fix', '--help', '-h'];
const VALUE_FLAGS = ['--file'];

const USAGE = `Usage:
  node fix-slugs.mjs               # dry run (default, safe) — prints the diff, writes nothing
  node fix-slugs.mjs --dry-run     # same as above, explicit
  node fix-slugs.mjs --fix         # write the resolved slugs back to portals.yml
  node fix-slugs.mjs --apply       # alias for --fix
  node fix-slugs.mjs --file <path> # use a specific portals file
  node fix-slugs.mjs --help        # show this message (-h is an alias)`;

/** Matches a `tracked_companies` list-item start line: `  - name: Foo`. */
const NAME_LINE_RE = /^([ \t]*)-\s*name:\s*(.+?)\s*$/;

/**
 * Split a portals.yml's raw text into per-company blocks, keyed by the exact
 * `name:` value, so a fix can be applied with plain line edits instead of a
 * full YAML re-serialization (which would drop every comment in the file).
 * Commented-out example entries (`# - name: ...`) never match — the regex
 * requires the line to start with `-` after only whitespace.
 *
 * @param {string} text - Raw portals.yml contents.
 * @returns {{lines: string[], blocks: Array<{name: string, indent: string, startLine: number, endLine: number}>}}
 */
export function splitCompanyBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NAME_LINE_RE);
    if (m) {
      if (current) {
        current.endLine = i;
        blocks.push(current);
      }
      current = { name: m[2].trim(), indent: m[1], startLine: i, endLine: null };
    }
  }
  if (current) {
    current.endLine = lines.length;
    blocks.push(current);
  }
  return { lines, blocks };
}

/** Build the replacement careers_url/api pair for a resolved {ats, slug}. */
function resolvedUrls({ ats, slug, eu }) {
  if (ats === 'greenhouse') {
    return {
      careersUrl: `https://job-boards.greenhouse.io/${slug}`,
      api: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    };
  }
  if (ats === 'ashby') {
    return { careersUrl: `https://jobs.ashbyhq.com/${slug}`, api: null };
  }
  // lever
  return {
    careersUrl: `https://jobs.${eu ? 'eu.' : ''}lever.co/${slug}`,
    api: null,
  };
}

/**
 * Find an existing `field: value` line within a block's line range.
 *
 * @returns {number} Line index, or -1 if the field isn't present in the block.
 */
function findFieldLine(lines, startLine, endLine, fieldIndent, field) {
  const re = new RegExp(`^${fieldIndent}${field}:\\s*(.*)$`);
  for (let i = startLine; i < endLine; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/** Escape a plain-scalar string so it's safe to wrap in a double-quoted YAML scalar. */
function escapeForDoubleQuoted(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Append a migration note to an existing `notes:` field, without corrupting
 * the surrounding YAML — handles three shapes:
 *
 *   1. Block scalar (`notes: |` / `notes: >`, with optional chomping
 *      indicator and explicit indentation digit): the header must NOT be
 *      rewritten as a plain scalar (that would silently truncate/garble any
 *      multi-line content). Instead, the note is appended as a new
 *      continuation line at the scalar's own content indentation.
 *   2. Double-quoted plain scalar (`notes: "..."`): the existing escaped
 *      content is reused as-is (already valid inside a `"..."` scalar) and
 *      the note is appended before the closing quote.
 *   3. Single-quoted or unquoted plain scalar: any embedded quote/backslash
 *      characters are escaped before the value is re-wrapped in double
 *      quotes, so an embedded `"` (or a single-quoted `''` YAML escape)
 *      can't break the rewritten line.
 *
 * @param {string[]} lines - Full file, split by line (mutated).
 * @param {{indent: string, startLine: number, endLine: number}} block - Mutated in place (endLine grows on insert).
 * @param {number} notesLine - Line index of the existing `notes:` field.
 * @param {string} fieldIndent - Indentation of fields inside this block.
 * @param {string} note - The migration note text to append (no quoting needed — built from ats/slug/date).
 */
function appendNote(lines, block, notesLine, fieldIndent, note) {
  const keyIdx = lines[notesLine].indexOf('notes:');
  const afterKey = lines[notesLine].slice(keyIdx + 'notes:'.length).trim();

  const blockScalarMatch = afterKey.match(/^([|>])[-+]?\d*\s*(#.*)?$/);
  if (blockScalarMatch) {
    // Walk the scalar's continuation lines to find their indentation and the
    // insertion point (first line at/under the field's own indent, or the
    // end of the block, ends the scalar).
    let contentIndent = null;
    let insertAt = notesLine + 1;
    for (let i = notesLine + 1; i < block.endLine; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        insertAt = i + 1;
        continue;
      }
      const lineIndent = line.match(/^[ \t]*/)[0];
      if (lineIndent.length <= fieldIndent.length) break; // dedent — scalar ended
      contentIndent = lineIndent;
      insertAt = i + 1;
    }
    const noteIndent = contentIndent || `${fieldIndent}  `;
    lines.splice(insertAt, 0, `${noteIndent}${note}`);
    block.endLine += 1;
    return;
  }

  // A trailing inline comment must be split off BEFORE the quote-type check —
  // otherwise a quoted value followed by `# comment` doesn't end with the
  // closing quote character and falls through to the unquoted branch, which
  // escapes the comment text itself into the value instead of leaving it as
  // a real YAML comment.
  const doubleQuotedRe = /^"((?:[^"\\]|\\.)*)"[ \t]*(#.*)?$/;
  const singleQuotedRe = /^'((?:[^']|'')*)'[ \t]*(#.*)?$/;

  let inner;
  let comment = '';
  const dq = afterKey.match(doubleQuotedRe);
  const sq = !dq && afterKey.match(singleQuotedRe);
  if (dq) {
    // Already double-quoted: the content between the quotes is already valid
    // double-quoted-scalar text (any embedded `"`/`\` is already escaped) —
    // reuse it verbatim rather than re-escaping already-escaped sequences.
    inner = dq[1];
    comment = dq[2] || '';
  } else if (sq) {
    // Single-quoted YAML escapes a literal `'` as `''` — undo that, then
    // escape for the double-quoted scalar we're about to produce.
    inner = escapeForDoubleQuoted(sq[1].replace(/''/g, "'"));
    comment = sq[2] || '';
  } else {
    // Unquoted plain scalar — may itself contain unescaped `"` or `\`
    // characters that would break a naive re-wrap, and may carry its own
    // trailing `# comment` (a YAML comment must start at the line or be
    // preceded by whitespace, so scan for the first such `#`).
    let hashIdx = -1;
    for (let i = 0; i < afterKey.length; i++) {
      if (afterKey[i] === '#' && (i === 0 || /\s/.test(afterKey[i - 1]))) {
        hashIdx = i;
        break;
      }
    }
    const value = hashIdx === -1 ? afterKey : afterKey.slice(0, hashIdx).trimEnd();
    comment = hashIdx === -1 ? '' : afterKey.slice(hashIdx);
    inner = escapeForDoubleQuoted(value);
  }
  lines[notesLine] = `${fieldIndent}notes: "${inner} ${note}"${comment ? ` ${comment}` : ''}`;
}

/**
 * Apply one resolved suggestion to a company's block in-place (mutates `lines`).
 *
 * @param {string[]} lines - Full file, split by line (mutated).
 * @param {{name: string, indent: string, startLine: number, endLine: number}} block
 * @param {{ats: string, slug: string, eu?: boolean}} suggested - The new ATS/slug.
 * @param {string} oldAts - The ATS the entry used to resolve to (for the note).
 * @param {string} dateStr - YYYY-MM-DD, embedded in the migration note.
 * @returns {{careersUrlOld: string, careersUrlNew: string}} Summary for the diff printout.
 */
function applyFix(lines, block, suggested, oldAts, dateStr) {
  const fieldIndent = `${block.indent}  `;
  const { careersUrl, api } = resolvedUrls(suggested);

  const careersLine = findFieldLine(lines, block.startLine, block.endLine, fieldIndent, 'careers_url');
  const careersUrlOld = careersLine !== -1 ? lines[careersLine].split(':').slice(1).join(':').trim() : '';
  let insertAfter = careersLine;
  if (careersLine !== -1) {
    lines[careersLine] = `${fieldIndent}careers_url: ${careersUrl}`;
  } else {
    lines.splice(block.startLine + 1, 0, `${fieldIndent}careers_url: ${careersUrl}`);
    insertAfter = block.startLine + 1;
    block.endLine += 1;
  }

  const apiLine = findFieldLine(lines, block.startLine, block.endLine, fieldIndent, 'api');
  if (api) {
    if (apiLine !== -1) {
      lines[apiLine] = `${fieldIndent}api: ${api}`;
      insertAfter = Math.max(insertAfter, apiLine);
    } else {
      lines.splice(insertAfter + 1, 0, `${fieldIndent}api: ${api}`);
      block.endLine += 1;
      insertAfter += 1;
    }
  } else if (apiLine !== -1) {
    // Migrating away from Greenhouse — a stale `api:` field would point at a
    // dead boards-api.greenhouse.io endpoint the scanner would still try.
    lines.splice(apiLine, 1);
    block.endLine -= 1;
  }

  const note = `(slug migrated ${oldAts}->${suggested.ats} ${dateStr}, verify-portals)`;
  const notesLine = findFieldLine(lines, block.startLine, block.endLine, fieldIndent, 'notes');
  if (notesLine !== -1) {
    appendNote(lines, block, notesLine, fieldIndent, note);
  } else {
    lines.splice(insertAfter + 1, 0, `${fieldIndent}notes: "${note}"`);
    block.endLine += 1;
  }

  return { careersUrlOld, careersUrlNew: careersUrl };
}

/**
 * Compute the set of fixes to apply from a verify-portals run, and (unless
 * dryRun) write them into the raw text.
 *
 * @param {string} rawText - Current portals.yml contents.
 * @param {Array<object>} results - verifyCompanies()/verifyPortalsFile() rows.
 * @param {{dryRun?: boolean, dateStr?: string}} [opts]
 * @returns {{text: string, fixes: Array<{name: string, oldAts: string, newAts: string, careersUrlOld: string, careersUrlNew: string}>}}
 */
export function computeFixes(rawText, results, { dateStr = new Date().toISOString().slice(0, 10) } = {}) {
  const { lines, blocks } = splitCompanyBlocks(rawText);
  const blocksByName = new Map(blocks.map((b) => [b.name, b]));

  // Pair each resolvable result with its block first, WITHOUT applying any
  // edits yet. Line insertions/removals inside one block shift the absolute
  // line numbers of every block further down the file — if we applied fixes
  // in `results` order (which has no relation to file position), fixing an
  // earlier-in-file company first could invalidate the startLine/endLine of
  // a later-in-file company still waiting to be processed (or vice versa).
  // Processing strictly bottom-to-top (highest startLine first) guarantees
  // every edit only ever shifts lines that are BELOW it, so a block still
  // pending above the current edit point never has its recorded position
  // invalidated by a fix applied further down.
  const pending = [];
  for (const r of results) {
    if (r.status !== 'missing' || !r.suggested) continue;
    const block = blocksByName.get(r.name);
    if (!block) continue; // name mismatch — leave untouched rather than guess
    pending.push({ r, block });
  }
  pending.sort((a, b) => b.block.startLine - a.block.startLine);

  const fixesByName = new Map();
  for (const { r, block } of pending) {
    const { careersUrlOld, careersUrlNew } = applyFix(lines, block, r.suggested, r.ats || 'unknown', dateStr);
    fixesByName.set(r.name, {
      name: r.name,
      oldAts: r.ats || 'unknown',
      newAts: r.suggested.ats,
      careersUrlOld,
      careersUrlNew,
    });
  }

  // Report fixes back in the caller's original `results` order (diff output
  // should read like the verify-portals run, not our bottom-to-top processing order).
  const fixes = results.map((r) => fixesByName.get(r.name)).filter(Boolean);

  return { text: lines.join('\n'), fixes };
}

function printDiff(fixes, { dryRun }) {
  if (fixes.length === 0) {
    console.log('No resolvable slug fixes found — nothing to do.');
    return;
  }
  console.log(`${dryRun ? '[dry run] Would fix' : 'Fixed'} ${fixes.length} entr${fixes.length === 1 ? 'y' : 'ies'}:\n`);
  for (const f of fixes) {
    console.log(`  ${f.name}: ${f.oldAts} -> ${f.newAts}`);
    console.log(`    - ${f.careersUrlOld}`);
    console.log(`    + ${f.careersUrlNew}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (hasFlag(args, '--file')) {
    const rawVal = flagValue(args, '--file');
    if (rawVal === undefined || rawVal === '' || rawVal.startsWith('-')) {
      console.error('Error: --file requires a value');
      process.exit(1);
    }
  }

  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS });

  const fix = args.includes('--fix') || args.includes('--apply');
  const dryRun = !fix; // default is always safe — writing requires an explicit flag

  const fileVal = flagValue(args, '--file');
  const filePath = resolve(fileVal || DEFAULT_PORTALS_PATH);

  if (!existsSync(filePath)) {
    console.log(`fix-slugs: no portals file at ${filePath} — nothing to fix.`);
    return;
  }

  const { results } = await verifyPortalsFile(filePath);
  const rawText = readFileSync(filePath, 'utf-8');
  const { text, fixes } = computeFixes(rawText, results);

  printDiff(fixes, { dryRun });

  if (!dryRun && fixes.length > 0) {
    writeFileSync(filePath, text, 'utf-8');
    console.log(`\nportals.yml updated (${fixes.length} fixed).`);
  } else if (dryRun && fixes.length > 0) {
    console.log('\nRun with --fix to write these changes to portals.yml.');
  }
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`fix-slugs failed: ${err.message}`);
    process.exit(1);
  });
}
