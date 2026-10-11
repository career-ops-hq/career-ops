// tests/agent-docs-script-refs.test.mjs — every `*.mjs` a top-level agent
// document names has to exist.
//
// AGENTS.md is loaded into every agent session, so a path in it is not prose:
// it is an instruction an agent will act on. A name that resolves to nothing
// costs a tool call every time one goes looking, and the agent has no way to
// tell "this was renamed" from "I am in the wrong directory".
//
// The one this was written for is `scan-apify.mjs`, listed in the jds/ capture
// table beside plugins/apify/index.mjs. It never existed — no commit in the
// history ever added or removed it — so it was wrong from the day it was
// written rather than stale, which is the kind of error only a check like this
// finds.
//
// Scoped to .mjs on purpose. These documents also name templates, data files
// and paths that are created at runtime or belong to the user layer, none of
// which need to exist in a fresh checkout. A script does.
//
// Run:  node --test tests/agent-docs-script-refs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The documents a CLI loads automatically. DATA_CONTRACT.md is included because
// the agent instructions point at it as the authority on file ownership.
const AGENT_DOCS = [
  'AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'OPENCODE.md',
  'GEMINI.md', 'KIMI.md', 'DATA_CONTRACT.md',
];

// Backticked only. Prose can discuss a script that a user might write, and a
// code fence can hold an example invocation; a backticked path is a reference.
const MJS_REF = /`([A-Za-z0-9_./-]+\.mjs)`/g;

// The updater does not ship the optional web application. Keep checking its
// script references in full checkouts, while CLI-only installs omit that tree.
function missingScriptRefs(src, root) {
  const webInstalled = existsSync(join(root, 'web'));
  return [...new Set([...src.matchAll(MJS_REF)].map((m) => m[1]))]
    .filter((ref) => !(ref.startsWith('web/') && !webInstalled))
    .filter((ref) => !existsSync(join(root, ref)))
    .sort();
}

for (const doc of AGENT_DOCS) {
  test(`${doc} names no script that does not exist`, () => {
    const path = join(ROOT, doc);
    if (!existsSync(path)) return;   // not every CLI's file ships in every fork
    const src = readFileSync(path, 'utf-8');
    const missing = missingScriptRefs(src, ROOT);
    assert.deepEqual(
      missing,
      [],
      `${doc} names ${missing.length} script(s) that do not exist: ${missing.join(', ')}. `
      + 'An agent reading this will spend a tool call looking for each one.',
    );
  });
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'co-agent-doc-script-refs-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  return root;
}

test('CLI-only installs allow references to the absent optional web tree', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'core.mjs'), '');
  assert.deepEqual(missingScriptRefs('`core.mjs` and `web/scripts/optional.mjs`', root), []);
});

test('CLI-only installs still report missing core scripts', (t) => {
  const root = fixture(t);
  assert.deepEqual(
    missingScriptRefs('`missing-core.mjs` and `web/scripts/optional.mjs`', root),
    ['missing-core.mjs'],
  );
});

test('full checkouts still report missing web scripts', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'web'));
  assert.deepEqual(missingScriptRefs('`web/scripts/missing.mjs`', root), ['web/scripts/missing.mjs']);
});

test('full checkouts accept existing web scripts', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'web', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'web', 'scripts', 'present.mjs'), '');
  assert.deepEqual(missingScriptRefs('`web/scripts/present.mjs`', root), []);
});
