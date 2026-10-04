#!/usr/bin/env node
// Records GitHub's rendering of every Markdown body the depends-on suite uses,
// so the suite stays offline and synchronous while still asserting against the
// renderer the check actually relies on.
//
//   GITHUB_TOKEN=... node tests/record-fixtures.mjs
//
// The suite fails loudly on a body with no recorded fixture, so adding a case
// without re-running this is caught rather than silently skipped. Write each case
// as a single string literal: this reads literals out of the file, so a body
// assembled by join() or concatenation has nothing to record.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(here, 'depends-on.test.mjs');
const OUT = path.join(here, 'fixtures', 'rendered-bodies.json');
const REPO = process.env.GITHUB_REPOSITORY || 'career-ops-hq/career-ops';

// Every string literal in the suite that could possibly declare, not just the
// ones written inline at a `refs(` call. Cases live in arrays and locals too, and
// a recorder that misses one records nothing for it, which the suite then reports
// as a missing fixture rather than silently passing. Over-recording a handful of
// unused entries is the cheap direction.
const src = fs.readFileSync(SUITE, 'utf8');
const bodies = new Set();
for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
  const raw = m[1] ?? m[2];
  if (raw === undefined) continue;
  let text;
  try { text = JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`); } catch { continue; }
  if (text.trim()) bodies.add(text);
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Recording a hundred bodies in a burst trips GitHub's secondary rate limit, and a
// half-written fixture file is worse than a slow run.
async function render(text) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch('https://api.github.com/markdown', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text, mode: 'gfm', context: REPO }),
    });
    if (res.ok) return res.text();
    if ((res.status !== 403 && res.status !== 429) || attempt >= 5) {
      throw new Error(`GitHub /markdown ${res.status} on ${JSON.stringify(text)}`);
    }
    const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * 2 ** attempt;
    process.stderr.write(`  ${res.status}, waiting ${Math.round(wait / 1000)}s\n`);
    await sleep(wait);
  }
}

const out = {};
for (const text of [...bodies].sort()) {
  out[text] = await render(text);
  await sleep(250);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`recorded ${Object.keys(out).length} fixtures to ${path.relative(process.cwd(), OUT)}`);
