// tests/portals-template-in-registry.test.mjs — a company added to the
// template's tracked_companies on a board the employer registry accepts is in
// the registry too.
//
// templates/portals.example.yml is copied into each new user's portals.yml and
// never updated there, while employers/ is the list that keeps growing. When a
// pull request adds a company to the template on an ATS the registry supports
// (Greenhouse, Lever, Ashby, Workday…), the same board goes into
// employers/inbox/ in that pull request, or it is already in employers/. The
// template then never holds a board the registry lacks.
//
// Only companies new against the base of the pull request are checked: the
// boards already in the template are being moved into the registry in their
// own batch. The base is HEAD^1, which in CI is main (the PR merge commit and
// the merge queue commit both have main as their first parent; test.yml checks
// out with fetch-depth: 2). Without that commit the repository check is
// skipped, and the rule itself is still tested below.
//
// Run:  node --test tests/portals-template-in-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { parseBoardUrl, importList } from '../seeds/employers-import.mjs';
import { boardIdentity, readInbox } from '../seeds/employers-validate.mjs';
import { inboxCoords, inboxCareersUrl } from '../seeds/employers-inbox.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = 'templates/portals.example.yml';

/**
 * Registry boards of tracked_companies, keyed by board identity. A company
 * whose careers_url is not a board the registry accepts is left out.
 * @param {string} text  the template's YAML
 * @returns {Map<string, {name: string, careers_url: string}>}
 */
function registryBoardsOf(text) {
  const doc = /** @type {any} */ (yamlLoad(text)) || {};
  const out = new Map();
  for (const c of Array.isArray(doc.tracked_companies) ? doc.tracked_companies : []) {
    if (!c || typeof c.careers_url !== 'string') continue;
    const parsed = parseBoardUrl(c.careers_url);
    if ('error' in parsed) continue;
    out.set(boardIdentity(parsed), { name: String(c.name ?? ''), careers_url: c.careers_url });
  }
  return out;
}

/**
 * Companies the template adds against its base, on a board the registry
 * accepts, that the registry does not list.
 * @param {{template: string, base: string, registry: Set<string>}} input
 * @returns {Array<{name: string, careers_url: string, inboxLine: string|null, reason: string|null}>}
 */
export function missingFromRegistry({ template, base, registry }) {
  const before = registryBoardsOf(base);
  const missing = [];
  for (const [identity, c] of registryBoardsOf(template)) {
    if (before.has(identity) || registry.has(identity)) continue;
    const cell = (/** @type {string} */ v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const { lines, rejected } = importList(`url,name\n${cell(c.careers_url)},${cell(c.name)}\n`);
    missing.push({
      name: c.name,
      careers_url: c.careers_url,
      inboxLine: lines.length ? JSON.stringify(lines[0]) : null,
      reason: rejected.length ? rejected[0].reason : null,
    });
  }
  return missing;
}

/** Board identities in employers/boards/ and employers/inbox/ under `root`. */
function registryIdentities(root) {
  const ids = new Set();
  const boards = join(root, 'employers', 'boards');
  for (const ats of existsSync(boards) ? readdirSync(boards) : []) {
    for (const f of readdirSync(join(boards, ats))) {
      if (!f.endsWith('.ndjson')) continue;
      for (const line of readFileSync(join(boards, ats, f), 'utf8').split('\n')) {
        if (line.trim()) ids.add(boardIdentity(JSON.parse(line)));
      }
    }
  }
  for (const f of readInbox(root, null).files) {
    for (const { row } of f.lines) ids.add(boardIdentity({ ...inboxCoords(row), careers_url: inboxCareersUrl(row) }));
  }
  return ids;
}

/** @param {ReturnType<typeof missingFromRegistry>} missing */
function explain(missing) {
  return missing.map((m) => (m.inboxLine
    ? `${m.name} (${m.careers_url}) is new in ${TEMPLATE} and its board is not in the employer registry.\n`
      + `  Add this line to employers/inbox/<YYYY-MM-DD>-<your-github-login>.ndjson in this pull request:\n  ${m.inboxLine}\n`
      + '  Then run: node seeds/employers-validate.mjs (employers/README.md explains the inbox).'
    : `${m.name} (${m.careers_url}) is new in ${TEMPLATE}, but the registry would reject its board: ${m.reason}`)).join('\n\n');
}

const tpl = (/** @type {string} */ body) => `tracked_companies:\n${body}`;
const ACME = '  - name: Acme\n    careers_url: https://job-boards.greenhouse.io/acme\n    enabled: true\n';
const OWN_SITE = '  - name: Own Site Co\n    careers_url: https://www.example.com/careers\n    enabled: true\n';

test('a new company on a supported board that the registry lacks is reported with its inbox line', () => {
  const missing = missingFromRegistry({ template: tpl(ACME), base: tpl(''), registry: new Set() });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'Acme');
  assert.deepEqual(JSON.parse(/** @type {string} */ (missing[0].inboxLine)), { ats: 'greenhouse', region: 'us', board: 'acme', name: 'Acme' });
  assert.match(explain(missing), /Add this line to employers\/inbox\/<YYYY-MM-DD>-<your-github-login>\.ndjson/);
});

test('the same company passes once its board is in the registry or the inbox', () => {
  const identity = boardIdentity(/** @type {any} */ (parseBoardUrl('https://job-boards.greenhouse.io/acme')));
  assert.deepEqual(missingFromRegistry({ template: tpl(ACME), base: tpl(''), registry: new Set([identity]) }), []);
});

test('a company already in the base template is not checked, and neither is one off the registry ATSs', () => {
  assert.deepEqual(missingFromRegistry({ template: tpl(ACME), base: tpl(ACME), registry: new Set() }), []);
  assert.deepEqual(missingFromRegistry({ template: tpl(OWN_SITE), base: tpl(''), registry: new Set() }), []);
});

test('a company renamed in the template is the same board, not a new one', () => {
  const renamed = ACME.replace('name: Acme', 'name: Acme Corp');
  assert.deepEqual(missingFromRegistry({ template: tpl(renamed), base: tpl(ACME), registry: new Set() }), []);
});

test(`every company this branch adds to ${TEMPLATE} on a registry ATS is in the employer registry`, (t) => {
  let base;
  try {
    base = execFileSync('git', ['show', `HEAD^1:${TEMPLATE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    t.skip('no HEAD^1 to compare against (shallow clone or not a git checkout)');
    return;
  }
  const template = readFileSync(join(ROOT, TEMPLATE), 'utf8');
  const missing = missingFromRegistry({ template, base, registry: registryIdentities(ROOT) });
  assert.equal(missing.length, 0, explain(missing));
});
