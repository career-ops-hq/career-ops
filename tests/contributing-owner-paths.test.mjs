// tests/contributing-owner-paths.test.mjs — CONTRIBUTING.md's owner-reviewed
// paths stay equal to CODEOWNERS, and the agent-facing files that point at
// CONTRIBUTING.md keep pointing at sections that exist.
import { pass, fail, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

// #4890: CONTRIBUTING.md lists the owner-reviewed paths so every contributor,
// and every coding agent AGENTS.md points there, sees them; before that only
// the Copilot instructions named any, as a hard stop that reviewers then cited
// against linked-issue contributor PRs. The list is the CODEOWNERS entries
// above the "Area owners" block, which route review and are not red lines.
const codeowners = read('.github/CODEOWNERS');
const areaMarker = codeowners.indexOf('── Area owners');
const ownerReviewed = codeowners.slice(0, areaMarker).split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split(/\s+/)[0].replace(/^\//, ''));

function contributingOwnerList() {
  const lines = read('CONTRIBUTING.md').split('\n');
  const start = lines.findIndex(l => /^#{2,3} Owner-reviewed paths\s*$/.test(l));
  assert.ok(start !== -1, 'CONTRIBUTING.md has an "Owner-reviewed paths" heading');
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith('- ')) {
    assert.ok(!lines[i].startsWith('#'), 'the section opens with its path list');
    i++;
  }
  const paths = [];
  for (; i < lines.length && lines[i].startsWith('- '); i++) {
    paths.push(...[...lines[i].matchAll(/`([^`]+)`/g)].map(m => m[1]));
  }
  return paths;
}

ok('CONTRIBUTING.md lists exactly the owner-reviewed CODEOWNERS paths', () => {
  assert.ok(areaMarker !== -1, 'CODEOWNERS still has its "Area owners" block');
  assert.ok(ownerReviewed.includes('AGENTS.md') && !ownerReviewed.includes('tests/'), 'split at the area owners block');
  const listed = contributingOwnerList();
  const norm = (p) => p.replace(/\/$/, '');
  const missing = ownerReviewed.filter(p => !listed.map(norm).includes(norm(p)));
  const extra = listed.filter(p => !ownerReviewed.map(norm).includes(norm(p)));
  assert.deepEqual(missing, [], `in CODEOWNERS but missing from CONTRIBUTING.md: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `in CONTRIBUTING.md but not an owner-reviewed CODEOWNERS entry: ${extra.join(', ')}`);
});

ok('AGENTS.md sends an agent changing the repo to CONTRIBUTING.md', () => {
  const bullet = read('AGENTS.md').split('\n').find(l => l.startsWith('- **Contributing:**'));
  assert.ok(bullet, 'AGENTS.md has its Contributing bullet');
  assert.ok(bullet.includes('`CONTRIBUTING.md`'), 'the Contributing bullet names CONTRIBUTING.md');
});

ok('copilot-instructions scopes its hard stop to unattended sessions', () => {
  const doc = read('.github/copilot-instructions.md');
  const section = doc.slice(doc.indexOf('## Files you must not touch'), doc.indexOf('## How to work'));
  assert.ok(/unattended/.test(section), 'names the unattended case');
  assert.ok(section.includes('`CONTRIBUTING.md`'), 'points attended sessions at CONTRIBUTING.md');
});

// Review on #7118: "docs go straight to a PR" contradicted the issue-first rule
// for owner-reviewed paths (README*.md is one), so each direct-to-PR summary
// has to carry the exception.
ok('every direct-to-PR summary names the owner-reviewed exception', () => {
  const contributing = read('CONTRIBUTING.md').split('\n').find(l => l.startsWith('**Going straight to a PR'));
  const agents = read('AGENTS.md').split('\n').find(l => l.startsWith('- **Contributing:**'));
  assert.ok(contributing && /owner-reviewed path/.test(contributing), 'CONTRIBUTING.md direct-to-PR paragraph');
  assert.ok(agents && /straight to a PR, unless they change an owner-reviewed path/.test(agents), 'AGENTS.md Contributing bullet');
});

// The pointers name CONTRIBUTING.md sections so a repo-work agent reads the
// rules it needs, not the whole file of human-facing prose. A renamed heading
// would leave the pointer naming a section that no longer exists.
ok('every CONTRIBUTING.md section the agent pointers name is a real heading', () => {
  const headings = new Set(read('CONTRIBUTING.md').split('\n')
    .filter(l => /^#{2,3} /.test(l)).map(l => l.replace(/^#+\s+/, '').trim()));
  const pointers = {
    'AGENTS.md': read('AGENTS.md').split('\n').find(l => l.startsWith('- **Contributing:**')),
    '.github/copilot-instructions.md': read('.github/copilot-instructions.md').split('\n')
      .find(l => l.includes('`CONTRIBUTING.md` sections')),
  };
  for (const [file, line] of Object.entries(pointers)) {
    assert.ok(line, `${file} has a CONTRIBUTING.md sections pointer`);
    const named = [...line.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    assert.ok(named.length >= 3, `${file} names its sections`);
    const missing = named.filter(n => !headings.has(n));
    assert.deepEqual(missing, [], `${file} names sections CONTRIBUTING.md does not have: ${missing.join(', ')}`);
  }
});

// #7119: the PR template and the first-PR welcome comment told contributors
// that bug fixes and docs never need an issue, which contradicted the
// owner-reviewed rule above. Each must name the exception and link the
// CONTRIBUTING.md section, and that anchor must exist.
ok('the PR template and welcome bot name the owner-reviewed exception', () => {
  const anchor = 'CONTRIBUTING.md#owner-reviewed-paths';
  assert.ok(read('CONTRIBUTING.md').split('\n').includes('### Owner-reviewed paths'),
    `${anchor} resolves to a heading`);
  const template = read('.github/PULL_REQUEST_TEMPLATE.md');
  const related = template.slice(template.indexOf('## Related issue'), template.indexOf('## Type of change'));
  assert.ok(related.includes(anchor), 'the Related issue guidance links the owner-reviewed paths');
  const issueFirst = template.split('\n').find(l => l.startsWith('- [ ]') && /issue first/.test(l));
  assert.ok(issueFirst && issueFirst.includes(anchor), 'the issue-first checklist item links the owner-reviewed paths');
  const noIssue = related.split('\n').find(l => l.includes('No issue needed'));
  assert.ok(noIssue && /owner-reviewed path/.test(noIssue), 'the No issue needed line names the exception');
  const welcome = read('.github/workflows/welcome.yml').split('\n').find(l => /related issue/i.test(l));
  assert.ok(welcome && welcome.includes(anchor), 'the first-PR welcome comment links the owner-reviewed paths');
});
