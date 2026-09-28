// tests/yaml-syntax.test.mjs — every tracked YAML file must parse.
//
// Matches *.yml/*.yaml case-insensitively over `git ls-files` and parses each
// one with the repo's js-yaml. A file that does not parse fails the check. This
// is the only YAML validation in the suite — `npm run lint` runs `node --check`
// on .mjs files only.
//
// Parse-only, not schema validation: it catches a value that silently
// restructures the document (an unquoted scalar with an embedded `: `, a bad
// indent) without coupling the test to GitHub's issue-form or workflow schemas.
//
// Parsed with yaml.load — the same call every non-.github/ consumer uses
// (scan.mjs: `const parseYaml = yaml.load`), so a multi-document file that would
// throw in the runtime ("expected a single document") fails here too. .github/
// YAML is read by GitHub's own issue-form / workflow parsers, not by this repo's
// code, so it is parsed with loadAll instead — a multi-document stream there is
// not a syntax error this gate should invent.
//
// Files are discovered, not listed, so a new YAML file is covered as soon as it
// is tracked. `git ls-files` is the set that ships, needs no skip-list, and
// cannot wander into untracked scratch.

import { pass, fail, ROOT } from './helpers.mjs';
import { lstatSync, readFileSync } from 'fs';
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
    // record and silently drop a file from the sweep. No pathspec: list every
    // tracked path and match the extension below, so this one filter is the
    // single source of truth for what counts as YAML — a `.YAML`/`.YML` file
    // (git pathspecs are case-sensitive) is still swept.
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = out
      .split('\0')
      .filter((p) => {
        const lower = p.toLowerCase();
        return lower.endsWith('.yml') || lower.endsWith('.yaml');
      })
      .map((p) => join(ROOT, p));
    return { files, error: null };
  } catch (err) {
    return { files: [], error: err.message.split('\n')[0] };
  }
}

// Guard the guard: a parse step that silently swallowed errors, or a `load` that
// had been swapped for something inert, would report a clean sweep forever.
// Prove it rejects an unquoted value with an embedded `: `, accepts the quoted
// form, and that yaml.load (the non-.github/ path) rejects a multi-document
// stream that loadAll would wave through.
const BROKEN_FIXTURE = "attributes:\n  description: A generic client (`User-agent: *`)?\n";
const FIXED_FIXTURE = 'attributes:\n  description: "A generic client (`User-agent: *`)?"\n';
const MULTIDOC_FIXTURE = 'a: 1\n---\nb: 2\n';
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
let loadRejectsMultiDoc = false;
try {
  yaml.load(MULTIDOC_FIXTURE);
} catch {
  loadRejectsMultiDoc = true;
}
if (detectorRejects && detectorAccepts && loadRejectsMultiDoc) {
  pass('parser rejects an unquoted embedded `: `, accepts the quoted form, and load() rejects a multi-document stream');
} else {
  fail(
    `detector broken: rejects=${detectorRejects} accepts=${detectorAccepts} loadRejectsMultiDoc=${loadRejectsMultiDoc} — it would pass the sweep regardless of the files`,
  );
}

const offenders = [];
// A file that cannot be read is not a file that passes — report it as its own
// failure rather than skip it, so the sweep cannot go green while covering less
// of the tree than it claims.
const unreadable = [];

const { files, error: discoveryError } = yamlFiles();
for (const file of files) {
  const rel = relative(ROOT, file);
  let text;
  try {
    // lstat before read, and reject anything that is not a regular file.
    // git ls-files lists tracked symlinks too, and readFileSync follows them:
    // a symlink to /dev/zero reads unboundedly, a FIFO blocks — neither ever
    // reaches the catch below. A non-regular entry has to be turned away
    // before the read, and into unreadable (a hard failure), never skipped.
    if (!lstatSync(file).isFile()) {
      unreadable.push(`${rel} (not a regular file)`);
      continue;
    }
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    unreadable.push(`${rel} (${err.code || err.message})`);
    continue;
  }
  // .github/ YAML is consumed by GitHub, not by this repo — tolerate a
  // multi-document stream there. Everything else is read by yaml.load, which
  // throws on a second document, so parse it the way the runtime will.
  const isGithub = rel.split(/[\\/]/)[0] === '.github';
  try {
    if (isGithub) yaml.loadAll(text);
    else yaml.load(text);
  } catch (err) {
    offenders.push(`${rel}: ${err.message.split('\n')[0]}`);
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
  fail(`YAML file(s) that do not parse: ${offenders.join(' · ')}`);
}
