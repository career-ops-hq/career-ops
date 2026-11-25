// tests/expand-github-username.test.mjs — expand reads `candidate.github` as a
// profile link and reduces it to a bare username before calling the GitHub API.
//
// config/profile.example.yml ships `github: "github.com/janesmith"`, and
// generate-cover-letter.mjs renders that value as a link. modes/expand.md used
// to splice the field straight into `https://api.github.com/users/<username>/repos`,
// so every profile copied from the example asked for
// `/users/github.com/janesmith/repos` and got a 404.
//
// The normalization is prose the agent follows, so this suite pins the prose,
// and replays the documented steps against the shipped example so a change to
// either side is caught.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nexpand mode: candidate.github is normalized to a username');

const flat = readFileSync(join(ROOT, 'modes/expand.md'), 'utf-8').replace(/\s+/g, ' ');
const has = (probe) => flat.includes(probe.replace(/\s+/g, ' '));
const ok = (name, condition, why) => (condition ? pass(name) : fail(`${name} — ${why}`));

ok('Input normalizes candidate.github to a bare username',
  has('Normalize `candidate.github` to a bare username'),
  'the API URL would be built from a profile link such as github.com/janesmith');

ok('Input lists the prefixes to strip',
  has('a leading `https://` or `http://`') && has('a leading `github.com/`') && has('a leading `@`'),
  'the agent is told to normalize but not what to remove');

ok('Input stops on a value that is not a username',
  has('stop and ask the user to fix `candidate.github`') && has('Never guess a username'),
  'a repo link or junk value would be sent to the API or guessed at');

// The steps exactly as modes/expand.md lists them, applied to the shipped
// example. If the example changes shape, or the steps stop covering it, this
// fails instead of the user's first expand run.
const normalize = (value) => String(value)
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .replace(/^github\.com\//i, '')
  .replace(/\/+$/, '')
  .replace(/^@/, '');
const isUsername = (value) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value);

const example = readFileSync(join(ROOT, 'config/profile.example.yml'), 'utf-8')
  .match(/^\s+github:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m)?.[1];

ok('profile.example.yml still ships a candidate.github value', Boolean(example),
  'the example no longer has a github field to check');

if (example) {
  ok(`the shipped example (${example}) normalizes to a valid username`,
    isUsername(normalize(example)),
    `normalized to "${normalize(example)}"`);
}

for (const [input, expected] of [
  ['https://github.com/janesmith/', 'janesmith'],
  ['github.com/janesmith', 'janesmith'],
  ['@janesmith', 'janesmith'],
  ['janesmith', 'janesmith'],
]) {
  ok(`documented example ${input} → ${expected}`, normalize(input) === expected,
    `got "${normalize(input)}"`);
}

ok('a repo link is rejected, not truncated to its owner',
  !isUsername(normalize('github.com/janesmith/tool')),
  'a repo URL would be read as the user name');
