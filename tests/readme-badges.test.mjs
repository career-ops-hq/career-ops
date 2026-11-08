// readme-badges.mjs: the README's live badges are SVGs in the repo, which
// GitHub serves itself, so its image proxy can never time out on them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { BADGES, badgeProblem, badgeUrl, refresh } from '../.github/scripts/readme-badges.mjs';

const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function repo({ count = 23, version = '1.40.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-badges-'));
  roots.push(root);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'hired-count.json'), `${JSON.stringify({ count, updatedAt: '2026-11-08' })}\n`);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'career-ops', version })}\n`);
  return root;
}

const svgFor = (text) => `<svg xmlns="http://www.w3.org/2000/svg" aria-label="${text}"><title>${text}</title><image href="data:image/svg+xml;base64,AAAA"/></svg>`;

/** A fetch that answers Discord and shields.io from memory: no network in tests. */
function fakeFetch({ members = 5200, shields = (url) => ({ ok: true, status: 200, body: svgFor(decodeURIComponent(url)) }) } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://discord.com/')) return { ok: true, status: 200, json: async () => ({ approximate_member_count: members }) };
    const { ok, status, body } = shields(url);
    return { ok, status, text: async () => body };
  };
  return { impl, calls };
}

test('a badge URL is a static shields.io badge in the README style', () => {
  const hired = badgeUrl(BADGES.hired, 22);
  assert.ok(hired.startsWith('https://img.shields.io/badge/'));
  assert.ok(hired.includes('CAREER--OPS'), 'a dash in the label is written twice');
  assert.ok(hired.includes('22%20on%20the%20record'));
  assert.ok(hired.includes('style=for-the-badge') && hired.includes('labelColor=2b3137'));
  assert.ok(!hired.includes('/dynamic/'), 'never a live badge: that is what timed out');
  const discord = badgeUrl(BADGES.discord, 5191);
  assert.ok(discord.includes('5191%20members') && discord.includes('logo=discord') && discord.includes('logoColor=white'));
  assert.ok(badgeUrl(BADGES.npm, '1.40.0').includes('release-v1.40.0-2ea44f'));
});

test('only a whole, self-contained SVG that shows the value is accepted', () => {
  assert.equal(badgeProblem(svgFor('22 ON THE RECORD'), 22), null);
  assert.equal(badgeProblem('<html>502 Bad Gateway</html>', 22), 'not an SVG');
  assert.equal(badgeProblem(svgFor('21 ON THE RECORD'), 22), 'does not show 22');
  assert.equal(badgeProblem('<svg><image href="https://evil.example/x.png"/> 22</svg>', 22), 'references something outside itself');
  assert.equal(badgeProblem('<svg><use xlink:href="#a"/> 22</svg>', 22), null, 'an internal reference is fine');
});

test('refresh writes each badge from its live value', async () => {
  const root = repo({ count: 23, version: '1.40.0' });
  const { impl } = fakeFetch({ members: 5200 });
  const results = await refresh({ root, fetchImpl: impl, tries: 1 });
  assert.deepEqual(results.map(({ name, status, detail }) => `${name}:${status}:${detail}`),
    ['hired:updated:23', 'discord:updated:5200', 'npm:updated:1.40.0']);
  assert.ok(readFileSync(join(root, 'docs', 'hired-badge.svg'), 'utf8').includes('23 on the record'));
  assert.ok(readFileSync(join(root, 'docs', 'discord-badge.svg'), 'utf8').includes('5200 members'));
  const again = await refresh({ root, fetchImpl: impl, tries: 1 });
  assert.ok(again.every(({ status }) => status === 'unchanged'));
});

test('a slow or broken shields.io keeps the last badge, and never throws', async () => {
  const root = repo({ count: 24 });
  writeFileSync(join(root, 'docs', 'hired-badge.svg'), 'the last good badge\n');
  const { impl } = fakeFetch({ shields: () => ({ ok: false, status: 504, body: '' }) });
  const [hired] = await refresh({ names: ['hired'], root, fetchImpl: impl, tries: 2 });
  assert.equal(hired.status, 'kept');
  assert.match(hired.detail, /504/);
  assert.equal(readFileSync(join(root, 'docs', 'hired-badge.svg'), 'utf8'), 'the last good badge\n');
});

test('a source with no usable value keeps the last badge', async () => {
  const root = repo({ count: -1 });
  const { impl, calls } = fakeFetch({ members: 0 });
  const results = await refresh({ names: ['hired', 'discord'], root, fetchImpl: impl, tries: 1 });
  assert.deepEqual(results.map(({ status }) => status), ['kept', 'kept']);
  assert.ok(!calls.some((url) => url.startsWith('https://img.shields.io/')), 'nothing is drawn from a bad value');
  assert.equal(existsSync(join(root, 'docs', 'hired-badge.svg')), false);
});

test('every README shows the badges from the repo, not live shields.io ones', () => {
  const readmes = readdirSync(ROOT).filter((name) => /^README(\..+)?\.md$/.test(name));
  assert.ok(readmes.length >= 19, `found ${readmes.length} READMEs`);
  for (const name of readmes) {
    const text = readFileSync(join(ROOT, name), 'utf8');
    for (const file of ['docs/hired-badge.svg', 'docs/discord-badge.svg', 'docs/npm-badge.svg']) {
      assert.ok(text.includes(`src="${file}"`), `${name} lacks ${file}`);
    }
    assert.ok(!text.includes('img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcareer-ops-hq%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json'), name);
    assert.ok(!text.includes('discord.com%2Fapi'), name);
    assert.ok(!text.includes('img.shields.io/npm/v/'), name);
  }
});

test('the badges in the repo are whole, self-contained SVGs', () => {
  for (const [name, spec] of Object.entries(BADGES)) {
    const svg = readFileSync(join(ROOT, spec.file), 'utf8');
    assert.ok(svg.trim().startsWith('<svg') && svg.trim().endsWith('</svg>'), name);
    assert.doesNotMatch(svg, /\b(?:xlink:)?href\s*=\s*["']?\s*(?!data:)[a-z][\w+.-]*:/i, `${name} must not reference anything outside itself`);
  }
});

test('--help and -h print the usage and draw nothing', () => {
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, [join(ROOT, '.github', 'scripts', 'readme-badges.mjs'), flag], { encoding: 'utf8', cwd: tmpdir() });
    assert.equal(r.status, 0, flag);
    assert.match(r.stdout, /^Usage: node \.github\/scripts\/readme-badges\.mjs/, flag);
    assert.doesNotMatch(r.stdout, /updated|unchanged|kept/, `${flag} must not run the refresh`);
  }
});

test('the workflows redraw the badges they own', () => {
  const wall = readFileSync(join(ROOT, '.github', 'workflows', 'hired-wall.yml'), 'utf8');
  assert.ok(wall.includes('node .github/scripts/readme-badges.mjs hired'));
  assert.match(wall, /git add [^\n]*docs\/hired-badge\.svg/);
  const weekly = readFileSync(join(ROOT, '.github', 'workflows', 'readme-badges.yml'), 'utf8');
  assert.ok(weekly.includes('node .github/scripts/readme-badges.mjs discord npm'));
  assert.match(weekly, /cron:/);
  assert.ok(weekly.includes('.release-please-manifest.json'), 'a release redraws the version');
  assert.match(weekly, /git add docs\/discord-badge\.svg docs\/npm-badge\.svg/);
});
