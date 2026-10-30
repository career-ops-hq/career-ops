#!/usr/bin/env node

/**
 * cv-sync-check.mjs — Validates that the career-ops setup is consistent.
 *
 * Checks:
 * 1. cv.md exists
 * 2. config/profile.yml exists and has required fields
 * 3. No hardcoded metrics in _shared.md or batch/batch-prompt.md
 * 4. article-digest.md freshness (if exists)
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getCareerOpsRoot, getProfilePath, hasProfileOverride } from './path-resolver.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadYaml } from './lib/yaml-document.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();

// ── CLI flags + help ────────────────────────────────────────────────
//
// docs/SCRIPTS.md lists `node cv-sync-check.mjs` as a runnable command, but the
// script read no arguments at all: a mistyped flag was ignored and the checks
// ran anyway, so `--hlep` looked like a successful run of whatever the caller
// meant (#3565). KNOWN_FLAGS is exactly --help/-h because that is every flag
// this file parses. Unrecognized flags exit 1 naming the flag; --help/-h print
// USAGE and exit 0.

const KNOWN_FLAGS = ['--help', '-h'];

const USAGE = `Usage:
  node cv-sync-check.mjs            # run the cv.md / profile.yml / prompt checks
  node cv-sync-check.mjs --help|-h  # print this usage block and exit`;

// Numbers that look like candidate metrics ("170+ hours", "300+ tests") belong
// in cv.md or article-digest.md. A time window ("less than 24 hours old",
// "within 48 hours") is a rule, not a claim about the candidate.
const METRIC_RE = /\b\d{2,4}\+?\s*(hours?|%|evals?|layers?|tests?|fields?|bases?)\b/gi;
const WINDOW_BEFORE_RE = /\b(?:less than|fewer than|older than|within|every)\s*\**\s*$/i;
const WINDOW_AFTER_RE = /^\s*\**\s*(?:old|ago)\b/i;

export function hardcodedMetrics(content) {
  const found = [];
  String(content).split('\n').forEach((line, i) => {
    if (line.includes('NEVER hardcode') || line.includes('NUNCA hardcode') || line.startsWith('#') || line.startsWith('<!--')) return;
    for (const m of line.matchAll(METRIC_RE)) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      if (WINDOW_BEFORE_RE.test(before) || WINDOW_AFTER_RE.test(after)) continue;
      found.push({ line: i + 1, match: m[0] });
      return;
    }
  });
  return found;
}

function main() {
  validateFlags(process.argv.slice(2), KNOWN_FLAGS, USAGE);

  const warnings = [];
  const errors = [];

  // 1. Check cv.md exists
  const cvPath = join(DATA_ROOT, 'cv.md');
  if (!existsSync(cvPath)) {
    errors.push('cv.md not found in project root. Create it with your CV in markdown format.');
  } else {
    const cvContent = readFileSync(cvPath, 'utf-8');
    if (cvContent.trim().length < 100) {
      warnings.push('cv.md seems too short. Make sure it contains your full CV.');
    }
  }

  // 2. Check profile.yml exists
  const profilePath = getProfilePath();
  if (!existsSync(profilePath)) {
    errors.push(hasProfileOverride()
      ? `config/profile.yml not found: CAREER_OPS_PROFILE names ${profilePath}. Create that file, or unset the variable.`
      : 'config/profile.yml not found. Copy from config/profile.example.yml and fill in your details.');
  } else {
    const profileContent = readFileSync(profilePath, 'utf-8');
    // Match the VALUE of each required field under `candidate`, against the
    // parsed YAML only. The shipped template documents optional fields with
    // commented-out examples (`#   # signature_name: "Jane Smith"`), and a
    // whole-file substring search treated that comment as proof the profile
    // was unedited — then reported the first field it checked (`full_name`),
    // naming an innocent field on a correctly filled profile. A line-based
    // regex was not enough either: it was not scoped to `candidate` (an
    // unrelated top-level `location:` mapping satisfied the check), and its
    // `\s*` could consume the newline after an empty `full_name:` and capture
    // the next key, hiding the missing value. Parse the document with loadYaml
    // (lib/yaml-document.mjs, the shared entry point: it returns null for an
    // empty or comment-only file instead of throwing) so only a real
    // `candidate[field]` string counts.
    let candidate;
    try {
      candidate = loadYaml(profileContent)?.candidate ?? {};
    } catch (err) {
      candidate = null;
      warnings.push(`config/profile.yml could not be parsed as YAML: ${err.message.split('\n')[0]}`);
    }
    if (candidate !== null) {
      const requiredFields = ['full_name', 'email', 'location'];
      for (const field of requiredFields) {
        const raw = candidate[field];
        // Only a string is a usable value for these three fields. Coercing with
        // String() made `full_name: {first: Jane}` pass as "[object Object]" and
        // a bare `email: 12345` pass as "12345" — an invalid field the check was
        // meant to catch, accepted without a warning.
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value || value.toLowerCase() === 'jane smith') {
          // A string with no content (`full_name: ""`) is still a text value, so
          // it is "missing or empty"; only a wrong type is "not a text value".
          const detail = value
            ? ` (still "${value}")`
            : raw == null || typeof raw === 'string'
              ? ' (missing or empty)'
              : ' (not a text value)';
          warnings.push(`config/profile.yml may still have example data. Check field: ${field}${detail}`);
          break;
        }
      }
    }
  }

  // 3. Check for hardcoded metrics in prompt files
  const filesToCheck = [
    { path: join(CODE_ROOT, 'modes', '_shared.md'), name: '_shared.md' },
    { path: join(CODE_ROOT, 'modes', '_writing.md'), name: '_writing.md' },
    { path: join(CODE_ROOT, 'batch', 'batch-prompt.md'), name: 'batch-prompt.md' },
  ];

  for (const { path, name } of filesToCheck) {
    if (!existsSync(path)) continue;
    for (const { line, match } of hardcodedMetrics(readFileSync(path, 'utf-8'))) {
      warnings.push(`${name}:${line} — Possible hardcoded metric: "${match}". Should this be read from cv.md/article-digest.md?`);
    }
  }

  // 4. Check article-digest.md freshness
  const digestPath = join(DATA_ROOT, 'article-digest.md');
  if (existsSync(digestPath)) {
    const stats = statSync(digestPath);
    const daysSinceModified = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (daysSinceModified > 30) {
      warnings.push(`article-digest.md is ${Math.round(daysSinceModified)} days old. Consider updating if your projects have new metrics.`);
    }
  }

  // Output results
  console.log('\n=== career-ops sync check ===\n');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('All checks passed.');
  } else {
    if (errors.length > 0) {
      console.log(`ERRORS (${errors.length}):`);
      errors.forEach(e => console.log(`  ERROR: ${e}`));
    }
    if (warnings.length > 0) {
      console.log(`\nWARNINGS (${warnings.length}):`);
      warnings.forEach(w => console.log(`  WARN: ${w}`));
    }
  }

  console.log('');
  process.exit(errors.length > 0 ? 1 : 0);
}

if (isMainModule(import.meta.url)) main();
