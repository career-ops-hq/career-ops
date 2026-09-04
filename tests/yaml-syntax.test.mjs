// tests/yaml-syntax.test.mjs — every tracked YAML file must parse.
//
// Enumerates *.yml/*.yaml via `git ls-files` and parses each one with the
// repo's js-yaml. A file that does not parse fails the check. This is the only
// YAML validation in the suite — `npm run lint` runs `node --check` on .mjs
// files only.
//
// Parse-only, not schema validation: it catches a value that silently
// restructures the document (an unquoted scalar with an embedded `: `, a bad
// indent) without coupling the test to GitHub's issue-form or workflow schemas.
//
// loadAll, not load: load() throws on a legitimately multi-document file
// ("expected a single document"), which must not read as a syntax error.
//
// Files are discovered, not listed, so a new YAML file is covered as soon as it
// is tracked. `git ls-files` is the set that ships, needs no skip-list, and
// cannot wander into untracked scratch.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, relative } from 'path';
import * as yaml from 'js-yaml';

console.log('\nevery tracked YAML file must parse');

/**
 * @returns {{files: string[], error: string|null}} every tracked *.yml/*.yaml.
 * The error is returned, not thrown: an uncaught throw here kills the process
 * before the reporting below runs, so a missing git or a ROOT that is not a work
 * tree would surface as a crash instead of a counted failure.
 */
function yamlFiles() {
  try {
    // -z: NUL-separated, so a path containing a newline or quote cannot split a
    // record and silently drop a file from the sweep.
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '*.yml', '*.yaml'], {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = out
      .split('\0')
      .filter((p) => p && (p.endsWith('.yml') || p.endsWith('.yaml')))
      .map((p) => join(ROOT, p));
    return { files, error: null };
  } catch (err) {
    return { files: [], error: err.message.split('\n')[0] };
  }
}

// Guard the guard: a parse step that silently swallowed errors, or a `load` that
// had been swapped for something inert, would report a clean sweep forever.
// Prove it rejects an unquoted value with an embedded `: ` and accepts the
// quoted form.
const BROKEN_FIXTURE = "attributes:\n  description: A generic client (`User-agent: *`)?\n";
const FIXED_FIXTURE = 'attributes:\n  description: "A generic client (`User-agent: *`)?"\n';
let detectorRejects = false;
try {
  yaml.loadAll(BROKEN_FIXTURE);
} catch {
  detectorRejects = true;
}
let detectorAccepts = true;
try {
  yaml.loadAll(FIXED_FIXTURE);
} catch {
  detectorAccepts = false;
}
if (detectorRejects && detectorAccepts) {
  pass('parser rejects an unquoted value with an embedded `: ` and accepts the quoted form');
} else {
  fail(`detector broken: rejects=${detectorRejects} accepts=${detectorAccepts} — it would pass the sweep regardless of the files`);
}

const offenders = [];
// A file that cannot be read is not a file that passes — report it as its own
// failure rather than skip it, so the sweep cannot go green while covering less
// of the tree than it claims.
const unreadable = [];

const { files, error: discoveryError } = yamlFiles();
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    unreadable.push(`${relative(ROOT, file)} (${err.code || err.message})`);
    continue;
  }
  try {
    yaml.loadAll(text);
  } catch (err) {
    offenders.push(`${relative(ROOT, file)}: ${err.message.split('\n')[0]}`);
  }
}

if (discoveryError !== null) {
  fail(`could not list tracked YAML files, so the sweep ran against nothing: ${discoveryError}`);
} else if (files.length === 0) {
  fail('git ls-files produced no *.yml/*.yaml — the YAML syntax sweep scanned nothing');
} else if (unreadable.length > 0) {
  fail(`could not read ${unreadable.length} tracked YAML file(s), so the sweep is incomplete: ${unreadable.join(', ')}`);
} else if (offenders.length === 0) {
  pass(`all ${files.length} tracked YAML files parse`);
} else {
  fail(`YAML file(s) that do not parse — a GitHub Issue Form or workflow in this set will not load: ${offenders.join(' · ')}`);
}
