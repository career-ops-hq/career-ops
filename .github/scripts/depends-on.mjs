#!/usr/bin/env node
// depends-on: required check that FAILS while a PR listed under `Depends on` is still open (#3880).
//
// Same shape as direction-gate.mjs: pure exported parser, async main, read-only token.
//
// The anchor is deliberately strict. "depends on" is ordinary English and turns up
// mid-sentence in most PR bodies here ("the magic it depends on", "CI never depends
// on that host"). Matching the phrase anywhere fires on bodies declaring no
// dependency, and a false positive blocks a merge. So a reference counts in three
// places only: under a `Depends on` heading, on a line that STARTS with the phrase,
// or inside a single-line bold span carrying both the phrase and the ref. Measured
// against all ten open PRs whose body contains "depends on", those three anchors
// yield two true positives and zero false positives.
//
// Permissions: pull-requests: read only. A `pull_request` workflow from a fork gets a
// read-only token whatever the permissions block says, and 281 of this repo's 294 open
// PRs come from forks, so writing a status onto a dependent PR's head is unavailable
// where it would be needed. The check clears on the dependent PR's next push or edit.
//
// merge_group: a PR only enters the queue with this check green, so in principle it
// no longer waits on anything. The number is still re-read from the queue head_ref
// (gh-readonly-queue/main/pr-N-...) and the body re-checked, the same way
// direction-gate.mjs does it, so an edit made AFTER queueing still blocks. An
// unreadable number passes: the check already ran on the PR.
//
// Env: GITHUB_TOKEN (read) · GITHUB_REPOSITORY · GITHUB_EVENT_NAME · GITHUB_EVENT_PATH

import fs from 'node:fs';

const HEADING = /^#{1,6}[ \t]*\**[ \t]*depends on\b/i;
const LINE = /^[ \t]*(?:[-*+][ \t]+|\d+\.[ \t]+)?\**[ \t]*depends on\b/i;
// Scanned over the whole body, so the character class is the only thing keeping the
// span on one line. Drop the \n from it and the match runs from one paragraph's
// closing `**` to the next paragraph's opening `**`, swallowing an unrelated `#N`
// in between. PR #2999's body has exactly that shape.
const BOLD = /\*\*[^*\n]*depends on[^*\n]*\*\*/gi;
const REF = /#(\d+)\b/g;

// Fences first: a body that documents this feature shouldn't trip it.
function stripFences(text) {
  return text.replace(/^[ \t]*(```|~~~).*$[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');
}

export function parseDependsOn(body, self = null) {
  if (typeof body !== 'string' || !body.trim()) return [];
  const doc = stripFences(body);
  const lines = doc.split(/\r?\n/);
  const collected = [];
  let inSection = false;

  for (const line of lines) {
    const isHeading = /^#{1,6}[ \t]/.test(line);
    if (isHeading && !HEADING.test(line)) { inSection = false; continue; }
    if (HEADING.test(line)) { inSection = true; collected.push(line); continue; }
    if (inSection || LINE.test(line)) collected.push(line);
  }
  for (const m of doc.matchAll(BOLD)) collected.push(m[0]);

  // Code spans carry the format, not a reference: `#99` is documentation.
  const text = collected.join('\n').replace(/`[^`\n]*`/g, '');
  const out = [];
  for (const m of text.matchAll(REF)) {
    const n = Number(m[1]);
    // A body listing its own number would block the PR on itself, forever.
    if (n !== self && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Pure: the PR number behind a merge-queue head_ref, or null. */
export function prFromQueueRef(ref) {
  const m = /gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(ref || '');
  return m ? Number(m[1]) : null;
}

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'career-ops-depends-on',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return res.json();
};

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

  let self = null;
  let body = null;
  if (eventName === 'merge_group') {
    self = prFromQueueRef(event.merge_group?.head_ref);
    if (!self) {
      console.log('merge_group carries no readable PR number. Passing: the check already ran on the PR.');
      return;
    }
    body = (await api(`/repos/${repo}/pulls/${self}`)).body;
  } else {
    self = event.pull_request?.number ?? null;
    body = event.pull_request?.body ?? null;
  }

  const refs = parseDependsOn(body, self);

  if (!refs.length) {
    console.log('No `Depends on` references. Nothing to wait for.');
    return;
  }

  const open = [];
  for (const n of refs) {
    // An issue number under `Depends on` is a typo, not a dependency. Report it
    // as unresolvable instead of passing silently on a 404.
    const pr = await api(`/repos/${repo}/pulls/${n}`).catch(() => null);
    if (!pr) { open.push(`#${n} (not a pull request in ${repo})`); continue; }
    if (pr.state === 'open') open.push(`#${n} ${pr.title}`);
  }

  if (!open.length) {
    console.log(`All ${refs.length} listed dependencies have landed.`);
    return;
  }

  console.error('Still open, so this PR is not ready to merge:');
  for (const line of open) console.error(`  ${line}`);
  console.error('');
  console.error('This check clears on the next push or edit to this PR.');
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((err) => { console.error(err.message); process.exit(1); });
