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
//
// Scanned line by line rather than with one regex, because the regex form
// needed a backreference to the opening marker and so only ever closed a fence
// of exactly that length. GFM allows a fence of three OR MORE characters and
// requires the closing run to be at least as long as the opening one, so
// ~~~~ and ```` never closed and their samples were read as declarations.
// A fence that never closes runs to the end of the document, also per GFM.
// GFM allows a fence marker to be indented at most THREE spaces. A marker under
// four or more spaces is indented code and stays INSIDE the block, so accepting
// any indentation here let an indented sample line close its own fence and
// expose the text beneath it.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// GFM also lets a fence open inside a list item, where the marker sits at the
// item's CONTENT column rather than at the document margin. Anchoring only to
// 0-3 spaces from the margin missed that opener, so the sample inside the block
// leaked out and read as a declaration: a required check blocking a PR that
// declared nothing. The marker's width becomes the column the closing run is
// measured from, since the closer is indented to the same content column.
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;
function stripFences(text) {
  const kept = [];
  let open = null;
  let openIndent = 0;
  for (const line of text.split('\n')) {
    if (open === null) {
      const marker = LIST_MARKER.exec(line);
      const indent = marker ? marker[0].length : 0;
      const m = FENCE_OPEN.exec(indent ? line.slice(indent) : line);
      // A BACKTICK fence's info string may not contain a backtick (GFM), so
      // ```js`sample is ordinary text, not an opener. Treating it as one opened
      // a fence that never closed and hid every declaration beneath it — the
      // check then passes while the dependency is still open, which is the
      // failure direction that actually lets a bad merge through.
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = m[1]; openIndent = indent; continue; }
      kept.push(line);
      continue;
    }
    // A fence opened in a list item ends WITH the list item (GFM), so a
    // non-blank line indented less than the item's content column has left the
    // item and is outside the block. Running such a fence to the end of the
    // document instead swallowed every declaration after the list, hiding a
    // dependency rather than inventing one. Blank lines do not end an item, so
    // they are not a boundary. A fence at the margin (openIndent 0) still runs
    // to the end of the document.
    if (openIndent > 0 && line.trim() !== '' && /^ */.exec(line)[0].length < openIndent) {
      open = null;
      openIndent = 0;
      kept.push(line);
      continue;
    }
    // Drop up to the opener's content column before testing the closer, so a
    // fence opened in a list item closes at that column; FENCE_CLOSE's own
    // 0-3 allowance still applies to whatever indentation is left.
    const body = line.replace(/^ */, (s) => ' '.repeat(Math.max(0, s.length - openIndent)));
    const close = FENCE_CLOSE.exec(body);
    if (close && close[1][0] === open[0] && close[1].length >= open.length) { open = null; openIndent = 0; }
  }
  return kept.join('\n');
}

// A code span of any delimiter length, so ``#99`` documents the format the same
// way `#99` does. GFM also permits a newline inside a span, so this crosses
// lines; a run with no matching partner is literal text, which is what keeps a
// lone stray backtick from swallowing the rest of the body. The closing run
// must be exactly as long as the opening one.
//
// Scanned rather than matched with one regex, because the escape rule is
// ASYMMETRIC and a single pattern could not express it. GFM applies backslash
// escapes only OUTSIDE a code span: `\`` cannot OPEN one, but inside a span a
// backslash is literal and cannot stop one CLOSING. Neutralising every escape
// pair before a regex scan got the opening half right and the closing half
// wrong: it ate the closer of a span ending in a backslash, so `C:\` ran on to
// the next backtick and masked a real declaration between them. Hiding a
// declaration is the failure direction that lets a bad merge through, and
// Windows paths make that body an everyday one here.
//
// MASK rather than delete, replacing every non-newline character with a space.
// Deleting a span joins the text around it and shifts the lines beneath it, and
// the line rules below are anchored to the start of a line: ``Depends on #99``
// would collapse to an unquoted line and become a real declaration. Masking
// preserves both the line count and the column positions.
function maskCodeSpans(text) {
  const chars = text.split('');
  // An odd run of backslashes escapes the character after it; an even run is
  // escaped backslashes and leaves it free.
  const isEscaped = (at) => {
    let n = 0;
    for (let j = at - 1; j >= 0 && text[j] === '\\'; j -= 1) n += 1;
    return n % 2 === 1;
  };
  const runAt = (at) => {
    let n = 0;
    while (text[at + n] === '`') n += 1;
    return n;
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`' || isEscaped(i)) { i += 1; continue; }
    const open = runAt(i);
    let j = i + open;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== '`') { j += 1; continue; }
      const run = runAt(j);
      // No isEscaped() here, deliberately: inside the span the backslash is
      // literal, so it cannot stop this run from closing.
      if (run === open) { close = j; break; }
      j += run;
    }
    if (close === -1) { i += open; continue; }
    for (let k = i; k < close + open; k += 1) if (chars[k] !== '\n') chars[k] = ' ';
    i = close + open;
  }
  return chars.join('');
}

export function parseDependsOn(body, self = null) {
  if (typeof body !== 'string' || !body.trim()) return [];
  // GFM counts CRLF and a lone CR as line endings. Splitting on \n alone left a
  // trailing \r on every line, which no closing-fence pattern matched, so on a
  // CRLF body — what GitHub's own web editor submits — the first fence never
  // closed and swallowed every declaration after it.
  // Fences are block structure and resolve before inline spans, as in GFM.
  const normalized = body.replace(/\r\n?/g, '\n');
  const doc = maskCodeSpans(stripFences(normalized));
  const lines = doc.split(/\r?\n/);
  const collected = [];
  let inSection = false;

  for (const line of lines) {
    const isHeading = /^#{1,6}[ \t]/.test(line);
    if (isHeading && !HEADING.test(line)) { inSection = false; continue; }
    if (HEADING.test(line)) { inSection = true; collected.push(line); continue; }
    if (inSection || LINE.test(line)) collected.push(line);
  }
  // Spans are already masked in `doc`, so a bold anchor written inside one is
  // blanks by the time BOLD sees it and cannot be lifted back out.
  for (const m of doc.matchAll(BOLD)) collected.push(m[0]);

  const text = collected.join('\n');
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
