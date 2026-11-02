// tests/expand-github-repo-list.test.mjs — expand reads the user's whole repo
// list, and only repos the user actually authored.
//
// `GET /users/<username>/repos` with no query returns one page of 30 repos and
// includes forks. modes/expand.md called it bare, so a user with more than 30
// repos lost the rest without a word, and forks of other people's projects
// were proposed as the user's own work, which the mode's "Never fabricate"
// rule forbids.
//
// Prose is asserted with whitespace normalized, because the mode is free to
// re-wrap a sentence without changing what it says.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nexpand mode: GitHub repo list is paged, fork-free and rate-aware');

const flat = readFileSync(join(ROOT, 'modes/expand.md'), 'utf-8').replace(/\s+/g, ' ');
const has = (probe) => flat.includes(probe.replace(/\s+/g, ' '));
const ok = (name, condition, why) => (condition ? pass(name) : fail(`${name} — ${why}`));

ok('repo list asks for 100 per page, sorted by last push',
  has('/users/<username>/repos?type=owner&sort=pushed&per_page=100'),
  'the bare endpoint returns 30 repos in name order');

ok('repo list follows the Link rel="next" header',
  has('`Link` header with `rel="next"`'),
  'a user with more than one page of repos loses the rest silently');

ok('forks are skipped',
  has('**Skip forks** (`"fork": true`)'),
  'a fork of someone else\'s project would be proposed as the user\'s own work');

ok('README reads are capped and the rest are offered by name',
  has('at most the 30 most recently pushed non-fork repos') && has('let the user pick'),
  'a long repo list spends the anonymous 60-per-hour limit and the context window');

ok('a rate-limited run stops and says what it covered',
  has('`X-RateLimit-Remaining: 0`') && has('stop fetching and tell the user'),
  'a partial list would be presented as complete');
