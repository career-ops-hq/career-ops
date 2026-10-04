#!/usr/bin/env node
// depends-on: required check that FAILS while a PR listed under `Depends on` is still open (#3880).
//
// Same shape as direction-gate.mjs: pure exported helpers, async main, read-only token.
//
// The anchor is deliberately strict. "depends on" is ordinary English and turns up
// mid-sentence in most PR bodies here ("the magic it depends on", "CI never depends
// on that host"). Matching the phrase anywhere fires on bodies declaring no
// dependency, and a false positive blocks a merge. So a reference counts in three
// places only: under a `Depends on` heading, on a line that STARTS with the phrase,
// or inside a bold span carrying both the phrase and the ref.
//
// WHICH TEXT those anchors run over is the hard half, because a documented example
// must not count. Deriving that by hand means reimplementing GFM block structure:
// fences, indented code, code spans, list-item content columns, blockquote prefixes,
// raw HTML. An earlier revision did exactly that and 46 divergences from real
// renderers were measured against it, 27 of them hiding a declaration so the check
// went green with the dependency still open. GitHub already renders this body with
// its own renderer, so the check reads that instead. Nothing to strip by hand, so
// nothing to get wrong by hand, and the gate agrees with the page the author sees.
//
// Permissions: pull-requests: read only. A `pull_request` workflow from a fork gets a
// read-only token whatever the permissions block says, and most of this repo's open
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

const REF = /#(\d+)\b/g;
const PHRASE = /depends\s+on\b/i;
// No `\**` here. This runs on RENDERED text, where emphasis is already <strong>.
// A literal `**` survives rendering only where GitHub declined to treat it as
// emphasis, such as inside raw HTML, and honouring it would turn those literal
// asterisks back into a declaration.
const LINE = /^[^\S\n]*(?:#{1,6}|[-*+][^\S\n]+|\d{1,9}[.)][^\S\n]+)?\**[^\S\n]*depends[^\S\n]+on\b/i;

const CODE = /<(code|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
// A code element holding a NON-INLINE element is the sanitizer's doing, not the
// author's: an unclosed `<code>` makes GitHub wrap every later block inside it, and
// removing that wrapper took real declarations with it. Tested by complement rather
// than against a list of block tags, because the sanitizer emits more than any list
// written here will keep up with.
const ANY_TAG = /<\/?([a-zA-Z][\w-]*)\b/g;
const holdsBlock = (inner) => [...inner.matchAll(ANY_TAG)].some((m) => !INLINE.has(m[1].toLowerCase()));

// Repeatedly, because code nests. An unclosed `<code>` makes the sanitizer wrap
// later blocks in it, and that wrapper is kept so its declarations survive, but a
// genuine fence inside it must still be removed or a documented example becomes a
// declaration.
function stripCode(html) {
  let out = html;
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(CODE, (m, _tag, inner) => (holdsBlock(inner) ? inner : ' '));
    if (next === out) return out;
    out = next;
  }
  return out;
}
const COMMENT = /<!--[\s\S]*?-->/g;
const STRONG = /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const TAG = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;

// Inline elements, listed so that everything else defaults to a block break.
// The allowlist is inverted deliberately. Listing the VISIBLE containers instead
// meant one nobody thought of (a <div>, a bare <details>) was silently never
// scanned, which hides a declaration and merges the PR. Defaulting an unknown tag
// to "block" makes the worst case a spurious line break on text we can still see.
// `a` matters most: GitHub wraps every `#42` in one, so breaking there would
// separate a declaration from its own reference.
const INLINE_NAMES = ['a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'code',
  'data', 'del', 'dfn', 'em', 'g-emoji', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark',
  'nobr', 'output', 'picture', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source',
  'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr'];
const INLINE = new Set(INLINE_NAMES);

// A run of inline tags with the characters either side of it, so the decision to
// join or separate can be made from what it actually sits between.
const INLINE_RUN = new RegExp(
  `(.?)(?:</?(?:${[...INLINE_NAMES].join('|')})\\b[^>]*>)+(.?)`, 'gi',
);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Out of range is not a code point. String.fromCodePoint throws on it, and a body
// someone can write by accident must not crash a required check, so an unusable
// reference is left exactly as written.
function codePoint(n, original) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return original;
  try { return String.fromCodePoint(n); } catch { return original; }
}

const decodeEntities = (s) => s
  .replace(/&#(\d+);/g, (m, d) => codePoint(Number(d), m))
  .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => codePoint(parseInt(h, 16), m))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => NAMED[e]);

/** The visible text of rendered HTML: code removed, every block tag a line break. */
function textOf(html) {
  return decodeEntities(
    html
      .replace(/[\s\S]*/, stripCode)
      .replace(COMMENT, '')
      .replace(/<br\s*\/?>\n?/gi, '\n')
      .replace(INLINE_RUN, (run, before, after) => (/[A-Za-z]/.test(before) && /[A-Za-z]/.test(after) ? before + after : `${before} ${after}`))
      .replace(TAG, (m, name) => (INLINE.has(name.toLowerCase()) ? ' ' : '\n'))
      .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
      .replace(/[^\S\n]/g, ' '),
  );
}

const refsIn = (s) => [...s.matchAll(REF)].map((m) => Number(m[1]));

// A declaration continues onto the lines below it while they carry nothing but
// references: a hard break after the first ref, or the list form an author writes
// under `Depends on:`. Without this a second ref is dropped, which hides half a
// dependency set.
const CONNECTOR = /\b(?:and|or|plus)\b/gi;
function refsOnly(line) {
  if (!/#\d/.test(line)) return false;
  const rest = line.replace(REF, ' ').replace(CONNECTOR, ' ').replace(/[^\w]/g, '');
  return rest === '';
}
function fromDeclaration(lines, i) {
  const out = refsIn(lines[i]);
  for (let k = i + 1; k < lines.length && refsOnly(lines[k]); k += 1) out.push(...refsIn(lines[k]));
  return out;
}

/** Pure: the refs a rendered body declares. Testable from a recorded fixture. */
export function extractRefs(html, self = null) {
  if (typeof html !== 'string' || !html) return [];
  const found = [];
  // A `Depends on` heading owns the text up to the next heading of any level.
  const heads = [...html.matchAll(HEADING)];
  for (let i = 0; i < heads.length; i += 1) {
    if (!LINE.test(textOf(heads[i][2]).trimStart())) continue;
    const start = heads[i].index + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : html.length;
    found.push(...refsIn(textOf(heads[i][2])), ...refsIn(textOf(html.slice(start, end))));
  }
  const lines = textOf(html).replace(/depends[^\S\n]*\n[^\S\n]*on\b/gi, 'depends on').split('\n');
  for (let i = 0; i < lines.length; i += 1) if (LINE.test(lines[i])) found.push(...fromDeclaration(lines, i));
  // Document-wide, matching the shipped bold anchor. Scanning per block dropped a
  // bold declaration written in a table cell, which hides a dependency.
  for (const s of html.matchAll(STRONG)) {
    const t = textOf(s[1]);
    if (PHRASE.test(t)) found.push(...refsIn(t));
  }
  const out = [];
  for (const n of found) if (n !== self && !out.includes(n)) out.push(n);
  return out;
}

/** GitHub's own rendering of a body. Throws rather than returning anything partial. */
export async function renderBody(text, repo, token, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.github.com/markdown', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'career-ops-depends-on',
    },
    body: JSON.stringify({ text, mode: 'gfm', context: repo }),
  });
  if (!res.ok) throw new Error(`GitHub /markdown ${res.status}`);
  return res.text();
}

/**
 * The refs a PR body declares.
 *
 * Every non-empty body is rendered. An earlier revision pre-filtered on the phrase to
 * keep the call off PRs declaring nothing, but proving such a filter can never skip a
 * declaring body means reimplementing Markdown, which is what this change removes:
 * `Dep*end*s on #5` renders the plain word and carries no `depends` to match. Measured
 * on 100 open PRs, 87 bodies carry a `#N` anyway, so the filter saved little.
 *
 * A render failure is raised, never downgraded to reading the raw body. A fallback
 * would mean two parsers with different semantics, which is the whole class of
 * defect this reads GitHub's HTML to avoid.
 */
export async function resolveDependsOn(body, self, repo, token, fetchImpl = fetch) {
  if (typeof body !== 'string' || !body.trim()) return [];
  return extractRefs(await renderBody(body, repo, token, fetchImpl), self);
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
  const token = process.env.GITHUB_TOKEN;
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

  const refs = await resolveDependsOn(body, self, repo, token);

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
