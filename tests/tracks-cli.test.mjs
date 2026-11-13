// tests/tracks-cli.test.mjs — track-signals.mjs, tracks-setup.mjs and gigs.mjs as command-line tools (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-cli.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const run = (script, args, opts = {}) => spawnSync(process.execPath, [join(ROOT, script), ...args], { encoding: 'utf-8', ...opts });

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tracks-cli-'));
  mkdirSync(join(dir, 'config'));
  mkdirSync(join(dir, 'data'));
  copyFileSync(join(ROOT, 'config', 'profile.example.yml'), join(dir, 'config', 'profile.yml'));
  copyFileSync(join(ROOT, 'templates', 'portals.example.yml'), join(dir, 'portals.yml'));
  return dir;
}

const POSTING = [
  'Senior LLM Engineer (Freelance)',
  'Our client is looking for a contractor for 6 months, 40h/week, rate 90-110 EUR per hour.',
  'Must work Pacific hours. Fluent German required. Payment 60 days net.',
].join('\n');

test('an unknown flag is refused', () => {
  for (const script of ['track-signals.mjs', 'gigs.mjs', 'tracks-setup.mjs']) {
    const r = run(script, ['--bogus']);
    assert.ok(exitedNonZero(r), describeSpawn(r, script + ' --bogus'));
  }
});

test('tracks-setup --dry-run writes nothing', () => {
  const dir = sandbox();
  try {
    const before = [readFileSync(join(dir, 'config', 'profile.yml'), 'utf-8'), readFileSync(join(dir, 'portals.yml'), 'utf-8')];
    const r = run('tracks-setup.mjs', ['--enable', 'europe,ai_gigs,freelance', '--remote', 'remote_first', '--target', dir, '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).dry_run, true);
    assert.deepEqual([readFileSync(join(dir, 'config', 'profile.yml'), 'utf-8'), readFileSync(join(dir, 'portals.yml'), 'utf-8')], before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tracks-setup adds the block and the boards, keeps everything else, and is idempotent', () => {
  const dir = sandbox();
  try {
    const profileBefore = readFileSync(join(dir, 'config', 'profile.yml'), 'utf-8');
    const portalsBefore = readFileSync(join(dir, 'portals.yml'), 'utf-8');
    const r = run('tracks-setup.mjs', ['--enable', 'europe,ai_gigs,freelance', '--remote', 'remote_first', '--country', 'Germany', '--target', dir]);
    assert.equal(r.status, 0, r.stderr);
    const profile = readFileSync(join(dir, 'config', 'profile.yml'), 'utf-8');
    const portals = readFileSync(join(dir, 'portals.yml'), 'utf-8');
    assert.ok(profile.startsWith(profileBefore.replace(/\n*$/, '')), 'the profile only grows at the end');
    assert.match(profile, /^tracks:$/m);
    assert.match(profile, /^    preference: remote_first/m);
    assert.match(profile, /^      minimum: null/m, 'no pay floor is written by default');
    assert.ok(portals.length > portalsBefore.length);
    for (const line of portalsBefore.split('\n').filter(l => /^  - name: /.test(l))) assert.ok(portals.includes(line), 'kept: ' + line);
    assert.match(portals, /^tracks_filter:$/m);

    const check = run('validate-portals.mjs', ['--file', join(dir, 'portals.yml')]);
    assert.equal(check.status, 0, check.stdout + check.stderr);

    const again = run('tracks-setup.mjs', ['--enable', 'europe,ai_gigs,freelance', '--remote', 'remote_first', '--target', dir]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(join(dir, 'portals.yml'), 'utf-8'), portals, 'a second run changes nothing in portals.yml');
    assert.equal(readFileSync(join(dir, 'config', 'profile.yml'), 'utf-8'), profile, 'an existing tracks block is kept without --force');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('track-signals reports only the enabled tracks', () => {
  const dir = sandbox();
  try {
    const file = join(dir, 'posting.txt');
    writeFileSync(file, POSTING);
    const args = [file, '--title', 'Senior LLM Engineer (Freelance)', '--location', 'Remote (US only)', '--profile', join(dir, 'config', 'profile.yml')];
    const off = JSON.parse(run('track-signals.mjs', args).stdout);
    assert.deepEqual(off.tracks, { europe: false, ai_gigs: false, freelance: false, remote: false });
    for (const key of ['remote', 'europe', 'ai', 'freelance']) assert.equal(off[key], undefined, key + ' is left out when its track is off');
    assert.deepEqual(off.flags, []);

    run('tracks-setup.mjs', ['--enable', 'europe,ai_gigs,freelance', '--remote', 'remote_first', '--target', dir]);
    const on = JSON.parse(run('track-signals.mjs', args).stdout);
    assert.equal(on.remote.verdict, 'mismatch');
    assert.ok(on.flags.some(f => f.level === 'blocker' && f.track === 'remote'));
    assert.equal(on.engagement.type, 'freelance');
    assert.equal(on.ai.primary, 'llm_engineer');
    assert.deepEqual([on.freelance.rate.min, on.freelance.rate.max, on.freelance.rate.unit], [90, 110, 'hour']);
    assert.ok(!on.flags.some(f => f.track === 'freelance' && f.level === 'blocker'), 'with no rate configured, pay never blocks');
    assert.equal(on.europe.languages.requirements[0].language, 'de');

    const summary = run('track-signals.mjs', [...args, '--summary']);
    assert.equal(summary.status, 0);
    assert.match(summary.stdout, /blocker/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
