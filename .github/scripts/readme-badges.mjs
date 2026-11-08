#!/usr/bin/env node
// readme-badges.mjs — the README's live badges, served from the repo.
//
// GitHub fetches every external README image through its image proxy, which
// gives up after about four seconds. shields.io badges that read live data (a
// JSON file in this repo, Discord's API, the npm registry) sometimes take
// longer, and the README then shows a broken image: the Hired Wall, Discord
// and npm badges all did (2026-11-08; Discord's failed on every request).
//
// This keeps each of those badges as an SVG under docs/, which GitHub serves
// itself. Each SVG is a static shields.io badge fetched here, at a moment when
// a slow answer only means trying again: the README never waits on it.
//
//   node .github/scripts/readme-badges.mjs [hired] [discord] [npm]   (default: all three)
//
//   hired    the count in docs/hired-count.json (the hired-wall workflow runs this after each hire)
//   discord  the member count from Discord's public invite API (readme-badges workflow, weekly)
//   npm      the version in package.json, which release-please bumps (readme-badges workflow, on each release)
//
// A source or shields.io that does not answer leaves that badge as it was and
// prints a warning; the exit code stays 0, so a bookkeeping run never fails on it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/is-main-module.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = `Usage: node .github/scripts/readme-badges.mjs [hired] [discord] [npm]

Redraws the README's badges as SVGs under docs/ (default: all three):
  hired    from docs/hired-count.json          -> docs/hired-badge.svg
  discord  from Discord's public invite API    -> docs/discord-badge.svg
  npm      from the version in package.json    -> docs/npm-badge.svg
A source or shields.io that does not answer keeps the last badge and warns; the exit code stays 0.`;
const DISCORD_INVITE = '8pRpHETxa4';
const DARK = '2b3137';

/** What each badge shows and where it lives; `read` returns the live value. */
export const BADGES = Object.freeze({
  hired: {
    file: 'docs/hired-badge.svg',
    label: '🎉 HIRED WITH CAREER-OPS',
    message: (count) => `${count} on the record`,
    color: '2ea44f',
    read: async ({ root }) => {
      const { count } = JSON.parse(readFileSync(join(root, 'docs', 'hired-count.json'), 'utf8'));
      if (!Number.isInteger(count) || count < 0) throw new Error(`docs/hired-count.json has no usable count (${count})`);
      return count;
    },
  },
  discord: {
    file: 'docs/discord-badge.svg',
    label: 'Discord',
    message: (members) => `${members} members`,
    color: '5865F2',
    logo: 'discord',
    read: async ({ fetchImpl }) => {
      const res = await fetchImpl(`https://discord.com/api/v10/invites/${DISCORD_INVITE}?with_counts=true`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Discord answered ${res.status}`);
      const members = (await res.json()).approximate_member_count;
      if (!Number.isInteger(members) || members <= 0) throw new Error(`Discord sent no member count (${members})`);
      return members;
    },
  },
  npm: {
    file: 'docs/npm-badge.svg',
    label: 'release',
    message: (version) => `v${version}`,
    color: '2ea44f',
    read: async ({ root }) => {
      const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`package.json has no release version (${version})`);
      return version;
    },
  },
});

// shields.io static badge path: a dash or underscore is written twice, the
// rest is URL-encoded (a space becomes %20).
const part = (text) => encodeURIComponent(String(text).replace(/-/g, '--').replace(/_/g, '__'));

/**
 * The static shields.io badge for a value, in the README's style.
 *
 * @param {object} spec - One entry of BADGES.
 * @param {string|number} value - The live value.
 * @returns {string}
 */
export function badgeUrl(spec, value) {
  const query = new URLSearchParams({ style: 'for-the-badge', labelColor: DARK });
  if (spec.logo) { query.set('logo', spec.logo); query.set('logoColor', 'white'); }
  return `https://img.shields.io/badge/${part(spec.label)}-${part(spec.message(value))}-${spec.color}?${query}`;
}

/**
 * Why an answer is not a usable badge, or null when it is. GitHub serves repo
 * SVGs under a policy that blocks external references, so a badge must carry
 * everything inline (shields.io inlines its logos as data: URIs).
 *
 * @param {string} svg
 * @param {string|number} value
 * @returns {string|null}
 */
export function badgeProblem(svg, value) {
  const text = String(svg || '').trim();
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) return 'not an SVG';
  if (!text.includes(String(value))) return `does not show ${value}`;
  if (/\b(?:xlink:)?href\s*=\s*["']?\s*(?!data:)[a-z][\w+.-]*:/i.test(text)) return 'references something outside itself';
  return null;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchBadge(url, fetchImpl, value, tries = 3) {
  let last = 'no answer';
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
      const svg = res.ok ? await res.text() : '';
      const problem = res.ok ? badgeProblem(svg, value) : `shields.io answered ${res.status}`;
      if (!problem) return { svg: `${svg.trim()}\n` };
      last = problem;
    } catch (err) {
      last = err.message;
    }
    if (attempt < tries) await wait(attempt * 2000);
  }
  return { problem: last };
}

/**
 * Refresh the named badges. Never throws for a source or shields.io failing:
 * that badge keeps its last good SVG and the result says why.
 *
 * @param {{names?: string[], root?: string, fetchImpl?: typeof fetch, tries?: number}} [options]
 * @returns {Promise<Array<{name: string, status: 'updated'|'unchanged'|'kept', detail: string}>>}
 */
export async function refresh({ names = Object.keys(BADGES), root = REPO_ROOT, fetchImpl = fetch, tries = 3 } = {}) {
  const results = [];
  for (const name of names) {
    const spec = BADGES[name];
    let value;
    try {
      value = await spec.read({ root, fetchImpl });
    } catch (err) {
      results.push({ name, status: 'kept', detail: err.message });
      continue;
    }
    const { svg, problem } = await fetchBadge(badgeUrl(spec, value), fetchImpl, value, tries);
    if (problem) { results.push({ name, status: 'kept', detail: problem }); continue; }
    const file = join(root, spec.file);
    if (existsSync(file) && readFileSync(file, 'utf8') === svg) {
      results.push({ name, status: 'unchanged', detail: String(value) });
      continue;
    }
    writeFileSync(file, svg);
    results.push({ name, status: 'updated', detail: String(value) });
  }
  return results;
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${USAGE}\n`); return 0; }
  const names = argv.length ? argv : Object.keys(BADGES);
  const unknown = names.filter((name) => !BADGES[name]);
  if (unknown.length) {
    process.stderr.write(`readme-badges: unknown badge ${unknown.join(', ')} (use: ${Object.keys(BADGES).join(', ')})\n`);
    return 1;
  }
  for (const { name, status, detail } of await refresh({ names })) {
    if (status === 'kept') {
      const line = `${name}: kept the last badge (${detail})`;
      process.stdout.write(process.env.GITHUB_ACTIONS ? `::warning title=README badge::${line}\n` : `${line}\n`);
    } else {
      process.stdout.write(`${name}: ${status} (${detail})\n`);
    }
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
