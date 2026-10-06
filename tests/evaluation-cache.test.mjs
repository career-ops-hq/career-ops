import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { rmSync } from './helpers.mjs';
import { extractJobFacts, invalidateJobFacts, lookupJobFacts } from '../evaluation-cache.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const identityUrl = new URL('../listing-fingerprint.mjs', import.meta.url);
// The dependency PR owns the identity contract. Never substitute a copied
// implementation here: extraction tests run now; integration runs once that
// module is available, including when testing both changes together locally.
const identity = existsSync(identityUrl) ? await import(identityUrl.href) : null;
const integration = { skip: identity ? false : 'Requires the #1030 listing-fingerprint.mjs dependency' };
const NOW = Date.parse('2026-09-30T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const POSTING_URL = 'https://boards.greenhouse.io/example/jobs/12345';
const FACTS = { company: 'Example', role: 'Engineer', advertised_comp: 'EUR 80–90k', reports_to: 'VP of Engineering' };
const PRIVATE = 'PRIVATE_CV_AND_COMP_FLOOR_CANARY';
const iso = (ms) => new Date(ms).toISOString();
const summary = (fields) => `# Evaluation\n\n## Machine Summary\n\n\`\`\`yaml\n${yamlDump(fields, { lineWidth: -1 })}\`\`\`\n\n## Private fit\nKeep this report text exactly.\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-evaluation-cache-'));
  const reportsDir = join(root, 'reports');
  mkdirSync(reportsDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fingerprint = identity.computeListingFingerprint({
    url: POSTING_URL,
    strong: { ats_provider: 'greenhouse', board_slug: 'example', posting_id: '12345' },
  });
  const liveness = { url: POSTING_URL, result: 'active', checked_at: iso(NOW), listing_fingerprint: fingerprint };
  const args = { reportsDir, fingerprint, liveness, now: NOW };
  function write(name, overrides = {}, facts = FACTS) {
    const metadata = {
      schema_version: 1,
      listing_fingerprint: fingerprint,
      captured_at: iso(NOW - HOUR),
      invalidated_at: null,
      ...overrides,
    };
    const path = join(reportsDir, name);
    writeFileSync(path, summary({ ...facts, job_facts_cache: metadata }));
    return path;
  }
  return { root, reportsDir, fingerprint, liveness, args, write };
}

function assertMiss(result) {
  assert.equal(result.status, 'miss');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  assert.equal(result.payload, undefined);
}

test('job facts project only the four public fields, never nested private or advisory data', () => {
  const markdown = summary({
    ...FACTS,
    score: 4.9,
    archetype: PRIVATE,
    work_auth: 'not_needed',
    final_decision: 'Apply',
    next_action: PRIVATE,
    compensation_floor: PRIVATE,
    cv: { source: PRIVATE },
    requirement_importance: [{ requirement: PRIVATE, jd_signal: PRIVATE, evidence: 'stated', match: 'missing' }],
    legitimacy_tier: 'Suspicious',
    risk_summary: { culture: PRIVATE },
    future_field: { arbitrary: PRIVATE },
  });
  const result = extractJobFacts(markdown);
  assert.deepEqual(result, FACTS);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
  assert.deepEqual(extractJobFacts(summary({ company: 'Example', role: 'Engineer' })), {
    company: 'Example', role: 'Engineer', advertised_comp: null, reports_to: null,
  });
});

test('invalid public field types fail closed instead of coercing nested private data', () => {
  for (const key of Object.keys(FACTS)) {
    for (const value of [{ text: PRIVATE }, [PRIVATE], 123, true]) {
      assert.equal(extractJobFacts(summary({ ...FACTS, [key]: value })), null, `${key}: ${JSON.stringify(value)}`);
    }
  }
  for (const key of ['company', 'role']) {
    for (const value of [null, '', '   ']) assert.equal(extractJobFacts(summary({ ...FACTS, [key]: value })), null);
    const fields = { ...FACTS };
    delete fields[key];
    assert.equal(extractJobFacts(summary(fields)), null);
  }
});

test('missing, malformed, duplicate, or fenced-in Machine Summary cannot seed facts', () => {
  for (const raw of ['- list item', 'null', 'company: [broken', 'company: A\ncompany: B\nrole: Engineer']) {
    assert.equal(extractJobFacts(`## Machine Summary\n\n\`\`\`yaml\n${raw}\n\`\`\`\n`), null);
  }
  assert.equal(extractJobFacts('## Job Description\nOnly public posting text.'), null);
  assert.equal(extractJobFacts(`## Job Description (archived verbatim)\n\n\`\`\`\`text\n${summary(FACTS)}\n\`\`\`\`\n`), null);
  assert.equal(extractJobFacts(`${summary(FACTS)}\n${summary({ ...FACTS, company: 'Other' })}`), null);
});

test('a fresh strong identity returns only public payload and preserves the original capture time', integration, async (t) => {
  const f = fixture(t);
  f.write('001-example.md', {}, { ...FACTS, score: 4.9, cv: PRIVATE });
  const result = await lookupJobFacts(f.args);
  assert.deepEqual(result, {
    status: 'hit',
    payload: {
      schema_version: 1,
      listing_key: identity.listingKey(f.fingerprint),
      captured_at: iso(NOW - HOUR),
      job_facts: FACTS,
    },
  });
  const later = await lookupJobFacts({ ...f.args, now: NOW + 60_000 });
  assert.equal(later.payload.captured_at, result.payload.captured_at);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('authoritatively resolved aliases reuse the same key with liveness bound to the current URL', integration, async (t) => {
  const f = fixture(t);
  f.write('001-example.md');
  const aliasUrl = 'https://careers.example.com/openings/engineer';
  const alias = identity.computeListingFingerprint({ url: aliasUrl, strong: f.fingerprint.strong });
  assert.equal(identity.listingKey(alias), identity.listingKey(f.fingerprint));
  assertMiss(await lookupJobFacts({ ...f.args, fingerprint: alias }));
  const result = await lookupJobFacts({ ...f.args, fingerprint: alias, liveness: { ...f.liveness, url: aliasUrl, listing_fingerprint: alias } });
  assert.equal(result.status, 'hit');
  assert.deepEqual(result.payload.job_facts, FACTS);
});

test('partial identity, mismatched listing keys, and unsupported cache metadata cannot hit', integration, async (t) => {
  const f = fixture(t);
  const path = f.write('001-example.md');
  const partial = identity.computeListingFingerprint({ url: POSTING_URL });
  assertMiss(await lookupJobFacts({ ...f.args, fingerprint: partial }));
  const other = identity.computeListingFingerprint({ url: POSTING_URL, strong: { ats_provider: 'greenhouse', board_slug: 'other', posting_id: '12345' } });
  assertMiss(await lookupJobFacts({ ...f.args, fingerprint: other }));
  for (const overrides of [{ schema_version: 2 }, { listing_fingerprint: partial }, { listing_fingerprint: { ...f.fingerprint, listing_key: 'forged' } }]) {
    f.write('001-example.md', overrides);
    assertMiss(await lookupJobFacts(f.args));
  }
  writeFileSync(path, summary(FACTS));
  assertMiss(await lookupJobFacts(f.args));
  assertMiss(await lookupJobFacts({ ...f.args, reportsDir: join(f.root, 'missing') }));
});

test('capture freshness rejects the TTL boundary, future and invalid timestamps', integration, async (t) => {
  const f = fixture(t);
  f.write('001-example.md', { captured_at: iso(NOW - 24 * HOUR + 1) });
  assert.equal((await lookupJobFacts(f.args)).status, 'hit');
  for (const captured_at of [iso(NOW - 24 * HOUR), iso(NOW + 1), 'not-a-date', '2026-09-30T09:00:00', '2026-02-30T09:00:00.000Z', null]) {
    f.write('001-example.md', { captured_at });
    assertMiss(await lookupJobFacts(f.args));
  }
});

test('reuse requires recent active liveness for the requested URL context', integration, async (t) => {
  const f = fixture(t);
  f.write('001-example.md');
  for (const liveness of [
    undefined,
    { ...f.liveness, listing_fingerprint: undefined },
    { ...f.liveness, result: 'uncertain' },
    { ...f.liveness, result: 'expired' },
    { ...f.liveness, checked_at: iso(NOW - 5 * 60_000) },
    { ...f.liveness, checked_at: iso(NOW - 5 * 60_000 - 1) },
    { ...f.liveness, checked_at: iso(NOW + 1) },
    { ...f.liveness, checked_at: '2026-09-30T10:00:00' },
    { ...f.liveness, url: 'https://boards.greenhouse.io/example/jobs/99999' },
    { ...f.liveness, url: 'https://other.example/example/jobs/12345' },
  ]) assertMiss(await lookupJobFacts({ ...f.args, liveness }));
  assert.equal((await lookupJobFacts({ ...f.args, liveness: { ...f.liveness, url: `${POSTING_URL}?source=public#apply` } })).status, 'hit');
});

test('query-identified postings require liveness for the same authoritative strong identity', integration, async (t) => {
  const f = fixture(t);
  const url = 'https://boards.greenhouse.io/embed/job_app?for=example&token=12345';
  const fingerprint = identity.computeListingFingerprint({ url, strong: f.fingerprint.strong });
  const wrongUrl = 'https://boards.greenhouse.io/embed/job_app?for=example&token=99999';
  const wrongIdentity = identity.computeListingFingerprint({ url: wrongUrl, strong: { ...fingerprint.strong, posting_id: '99999' } });
  const path = f.write('001-example.md', { listing_fingerprint: fingerprint });
  const before = readFileSync(path, 'utf8');
  const liveness = { ...f.liveness, url: wrongUrl, listing_fingerprint: wrongIdentity };
  assert.equal(wrongIdentity.canonical_path, fingerprint.canonical_path);
  assertMiss(await lookupJobFacts({ ...f.args, fingerprint, liveness }));
  assertMiss(await invalidateJobFacts({ ...f.args, fingerprint, liveness: { ...liveness, result: 'expired', code: 'expired_body' } }));
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal((await lookupJobFacts({ ...f.args, fingerprint, liveness: { ...f.liveness, url, listing_fingerprint: fingerprint } })).status, 'hit');
});

test('newest capture wins independently of filenames; invalidation blocks older fallback', integration, async (t) => {
  const f = fixture(t);
  f.write('999-old.md', { captured_at: iso(NOW - 2 * HOUR) }, { ...FACTS, role: 'Old title' });
  f.write('001-new.md', { captured_at: iso(NOW - HOUR) });
  assert.deepEqual((await lookupJobFacts(f.args)).payload.job_facts, FACTS);
  f.write('001-new.md', { captured_at: iso(NOW - HOUR), invalidated_at: iso(NOW - 1000) });
  assertMiss(await lookupJobFacts(f.args));
  f.write('002-equal.md', { captured_at: iso(NOW - 1000) });
  assertMiss(await lookupJobFacts(f.args));
  f.write('003-recaptured.md', { captured_at: iso(NOW - 500) });
  assert.equal((await lookupJobFacts(f.args)).status, 'hit');
});

test('malformed or future invalidation markers do not expose older matching facts', integration, async (t) => {
  const f = fixture(t);
  f.write('001-old.md', { captured_at: iso(NOW - 2 * HOUR) });
  for (const invalidated_at of ['not-a-date', '2026-09-30T09:00:00', iso(NOW + 1)]) {
    f.write('002-new.md', { invalidated_at });
    assertMiss(await lookupJobFacts(f.args));
  }
});

test('recapture after a tombstone also requires an active check after that tombstone', integration, async (t) => {
  const f = fixture(t);
  const invalidated = NOW - 2 * 60_000;
  f.write('001-invalidated.md', { invalidated_at: iso(invalidated) });
  f.write('002-recaptured.md', { captured_at: iso(NOW - 60_000) });
  for (const checked_at of [iso(NOW - 3 * 60_000), iso(invalidated)]) {
    assertMiss(await lookupJobFacts({ ...f.args, liveness: { ...f.liveness, checked_at } }));
  }
  assert.equal((await lookupJobFacts(f.args)).status, 'hit');
});

test('explicit expired invalidation stamps all matching reports and preserves unrelated bytes and permissions', integration, async (t) => {
  const f = fixture(t);
  const oldPath = f.write('999-old.md', { captured_at: iso(NOW - 2 * HOUR) });
  const newPath = f.write('001-new.md');
  const otherFingerprint = identity.computeListingFingerprint({
    url: 'https://boards.greenhouse.io/example/jobs/99999',
    strong: { ...f.fingerprint.strong, posting_id: '99999' },
  });
  const otherPath = f.write('002-other.md', { listing_fingerprint: otherFingerprint });
  const otherBytes = readFileSync(otherPath, 'utf8');
  const privateTail = `# private comments stay byte-identical\nprivate_notes: |\n  ${PRIVATE}\n  Preserve punctuation: [x], # and spaces.\n`;
  const originals = new Map();
  for (const path of [oldPath, newPath]) {
    writeFileSync(path, readFileSync(path, 'utf8').replace('\n```\n', `\n${privateTail}\n\`\`\`\n`));
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    originals.set(path, readFileSync(path, 'utf8'));
  }
  await invalidateJobFacts({ ...f.args, liveness: { ...f.liveness, result: 'expired', code: 'expired_body' } });
  assert.equal(readFileSync(otherPath, 'utf8'), otherBytes, 'a different listing must remain untouched');
  for (const [path, before] of originals) {
    const after = readFileSync(path, 'utf8');
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600, 'invalidation must preserve private report permissions');
    const beforeCache = before.indexOf('job_facts_cache:');
    const afterCache = after.indexOf('job_facts_cache:');
    assert.ok(beforeCache > 0 && afterCache > 0);
    assert.equal(after.slice(0, afterCache), before.slice(0, beforeCache));
    assert.equal(after.slice(after.indexOf('# private comments')), before.slice(before.indexOf('# private comments')));
    assert.equal(after.slice(after.indexOf('\n```', afterCache)), before.slice(before.indexOf('\n```', beforeCache)));
    const parsed = yamlLoad(after.match(/```yaml\n([\s\S]*?)\n```/)[1]);
    assert.equal(parsed.job_facts_cache.invalidated_at, iso(NOW));
    assert.equal(parsed.job_facts_cache.captured_at, iso(NOW - (path === oldPath ? 2 : 1) * HOUR));
    assert.deepEqual(extractJobFacts(after), FACTS);
  }
  assertMiss(await lookupJobFacts(f.args));
});

test('deleting the newest invalidated report cannot revive an older duplicate', integration, async (t) => {
  const f = fixture(t);
  f.write('999-old.md', { captured_at: iso(NOW - 2 * HOUR) });
  const newest = f.write('001-new.md');
  await invalidateJobFacts({ ...f.args, liveness: { ...f.liveness, result: 'expired', code: 'expired_body' } });
  rmSync(newest);
  const after = { ...f.args, now: NOW + 2000, liveness: { ...f.liveness, checked_at: iso(NOW + 2000) } };
  assertMiss(await lookupJobFacts(after));
  f.write('003-recaptured.md', { captured_at: iso(NOW + 1000) });
  const result = await lookupJobFacts(after);
  assert.equal(result.status, 'hit');
  assert.equal(result.payload.captured_at, iso(NOW + 1000));
});

test('repeated invalidation preserves the newest tombstone across matching reports', integration, async (t) => {
  const f = fixture(t);
  const newestTombstone = NOW + 1000;
  const oldPath = f.write('999-old.md', { invalidated_at: iso(newestTombstone) });
  const newPath = f.write('001-new.md');
  await invalidateJobFacts({ ...f.args, liveness: { ...f.liveness, result: 'expired', code: 'expired_body' } });
  for (const path of [oldPath, newPath]) {
    const parsed = yamlLoad(readFileSync(path, 'utf8').match(/```yaml\n([\s\S]*?)\n```/)[1]);
    assert.equal(parsed.job_facts_cache.invalidated_at, iso(newestTombstone));
  }
  assertMiss(await lookupJobFacts(f.args));
});

test('uncertain or stale liveness never writes durable invalidation', integration, async (t) => {
  const f = fixture(t);
  const path = f.write('001-example.md');
  const before = readFileSync(path, 'utf8');
  for (const liveness of [
    { ...f.liveness, result: 'uncertain' },
    { ...f.liveness, result: 'expired', code: 'insufficient_content' },
    { ...f.liveness, result: 'expired', code: 'expired_body_soft' },
    { ...f.liveness, result: 'expired', code: 'unrecognized_closure' },
    { ...f.liveness, result: 'expired', checked_at: iso(NOW - HOUR) },
    { ...f.liveness, result: 'expired', url: 'https://other.example/jobs/12345' },
  ]) {
    let refused = false;
    try {
      const result = await invalidateJobFacts({ ...f.args, liveness });
      refused = result?.status === 'miss';
    } catch { refused = true; }
    assert.ok(refused, 'invalidating without bound, recent expired evidence must fail');
    assert.equal(readFileSync(path, 'utf8'), before);
  }
});

test('invalidation preserves valid opaque identifiers containing replacement metacharacters', integration, async (t) => {
  const f = fixture(t);
  const url = 'https://careers.example.com/jobs/$&';
  const fingerprint = identity.computeListingFingerprint({
    url, strong: { ...f.fingerprint.strong, posting_id: "id-$&-$$-$`-$'" },
  });
  const path = f.write('001-example.md', { listing_fingerprint: fingerprint });
  const result = await invalidateJobFacts({ ...f.args, fingerprint, liveness: { ...f.liveness, url, listing_fingerprint: fingerprint, result: 'expired', code: 'expired_body' } });
  assert.equal(result.status, 'invalidated');
  const parsed = yamlLoad(readFileSync(path, 'utf8').match(/```yaml\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(parsed.job_facts_cache.listing_fingerprint, fingerprint);
  assert.equal(parsed.job_facts_cache.invalidated_at, iso(NOW));
});

test('report symlinks cannot read or mutate files outside the reports directory', integration, async (t) => {
  const f = fixture(t);
  const actual = f.write('actual.md');
  const outside = join(f.root, 'outside.md');
  writeFileSync(outside, readFileSync(actual));
  rmSync(actual);
  try {
    symlinkSync(outside, join(f.reportsDir, '001-link.md'), 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('File symlinks unavailable on this platform'); return; }
    throw error;
  }
  const before = readFileSync(outside, 'utf8');
  assertMiss(await lookupJobFacts(f.args));
  try { await invalidateJobFacts({ ...f.args, liveness: { ...f.liveness, result: 'expired', code: 'expired_body' } }); } catch { /* refusal is expected */ }
  assert.equal(readFileSync(outside, 'utf8'), before);
});

function runCli(...args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'evaluation-cache.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { ...result, all: `${result.stdout}${result.stderr}` };
}

test('cache CLI help works without identity dependency and rejects unknown flags', () => {
  for (const flag of ['--help', '-h']) {
    const result = runCli(flag);
    assert.equal(result.status, 0, result.all);
    assert.match(result.all, /usage:/i);
  }
  const bad = runCli('--help', '--bogus');
  assert.equal(bad.status, 1);
  assert.match(bad.all, /unrecognized|unknown/i);
});

test('cache CLI rejects incomplete flags and malformed JSON without leaking input', (t) => {
  for (const args of [[], ['--identity'], ['--identity', '--help'], ['--liveness'], ['--reports']]) {
    const result = runCli(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.doesNotMatch(result.all, /\n\s+at /);
  }
  const root = mkdtempSync(join(tmpdir(), 'career-ops-cache-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'broken.json');
  writeFileSync(path, `{ ${PRIVATE}`);
  const result = runCli('--identity', path, '--liveness', path, '--reports', root);
  assert.equal(result.status, 1);
  assert.ok(!result.all.includes(PRIVATE));
  assert.doesNotMatch(result.all, /\n\s+at /);
});

test('missing identity dependency returns an explicit miss without deriving a substitute key', {
  skip: identity ? 'Identity dependency is installed; integration tests exercise the real module' : false,
}, async (t) => {
  assert.deepEqual(await lookupJobFacts({ now: NOW }), { status: 'miss', reason: 'listing-identity-unavailable' });
  const root = mkdtempSync(join(tmpdir(), 'career-ops-cache-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'input.json');
  writeFileSync(path, '{}');
  const result = runCli('--identity', path, '--liveness', path, '--reports', root);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'miss', reason: 'listing-identity-unavailable' });
});
