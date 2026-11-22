import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareDescriptions, identityWarnings, MAX_TEXT, hashText } from '../lib/role-change-compare.mjs';
import { radar, discoverBaseline, validateCapture, fetchPosting, readRadarRequest } from '../role-change-radar.mjs';

const original = 'Title: Platform Engineer\nCompany: Fictional Labs\nWork arrangement: Remote\nSalary: USD 100,000–120,000 per year, depending on experience\nResponsibilities\nBuild reliable systems.\nMaintain service documentation.\nQualifications\nKnowledge of SQL.\nLocation: London\nFull-time employment.';
const app = { id: '7', reportNum: 7, company: 'Fictional Labs', title: 'Platform Engineer', url: 'https://example.com/jobs/123' };
function fixture(t, archive = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'reports'));
  if (archive) fs.writeFileSync(path.join(root, 'reports', '007-fictional-labs-2026-01-01.md'), `# Fictional Labs\n\n## Job Description (archived verbatim)\n\n${original}\n`);
  return { root, application: { ...app, reportFile: archive ? 'reports/007-fictional-labs-2026-01-01.md' : null } };
}
const paste = text => ({ action: 'check', source: 'paste', text });
test('singular and plural skill headings classify otherwise unrecognized passages', () => {
  for (const heading of ['Skill', 'Skills', 'Qualification', 'Qualifications']) {
    const result = compareDescriptions(`${heading}\nGo.`, `${heading}\nRust.`);
    assert.equal(result.changes.length, 1);
    assert.deepEqual(result.changes[0].categories, ['Skills and qualifications']);
    assert.equal(result.changes[0].before.text, 'Go.');
    assert.equal(result.changes[0].after.text, 'Rust.');
  }
});
test('unrecognized markdown heading clears inherited section', () => {
  const result = compareDescriptions('## Skills\n- Python\n## Benefits\n- Free lunch.', '## Skills\n- Python\n## Benefits\n- Free breakfast.');
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0].categories, ['Other text changes']);
  assert.equal(result.changes[0].before.text, '- Free lunch.');
  assert.equal(result.changes[0].after.text, '- Free breakfast.');
});
test('split UTF-8 pipe chunks preserve multilingual text and its saved hash', async t => {
  const { root, application } = fixture(t, false);
  const text = `${original}\n${'€ ₹ 日本語 हिन्दी 🧑🏽‍💻 '.repeat(1000)}`;
  const expected = { app: application, input: { action: 'baseline', source: 'paste', text } };
  const encoded = Buffer.from(JSON.stringify(expected));
  // Every multibyte character crosses a chunk boundary, independent of OS buffering.
  async function* chunks() { for (let i = 0; i < encoded.length; i++) yield encoded.subarray(i, i + 1); }
  const request = await readRadarRequest(chunks());
  assert.deepEqual(request, expected);
  const state = await radar(root, request.app, request.input);
  assert.equal(state.baseline.text, text);
  assert.equal(state.baseline.hash, hashText(text));
});
test('stdin request limit counts original bytes and rejects overflow before parsing', async () => {
  const encoded = Buffer.from(JSON.stringify({ text: '€'.repeat(50_000) }));
  const padding = Buffer.alloc(300_000 - encoded.length, 32);
  assert.equal((await readRadarRequest([encoded, padding])).text, '€'.repeat(50_000));
  await assert.rejects(readRadarRequest([encoded, padding, Buffer.from(' ')]), /Request too large/);
  await assert.rejects(readRadarRequest([Buffer.from('{broken')]), SyntaxError);
});
test('CLI help exits before reading input or writing data; unknown flags fail', t => {
  const { root } = fixture(t, false);
  const script = fileURLToPath(new URL('../role-change-radar.mjs', import.meta.url));
  for (const flag of ['--help', '-h', '--bogus']) {
    const result = spawnSync(process.execPath, [script, flag], { input: '{invalid JSON', encoding: 'utf8', timeout: 5000, env: { ...process.env, CAREER_OPS_ROOT: root } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, flag === '--bogus' ? 1 : 0);
    assert.match(result.stdout + result.stderr, flag === '--bogus' ? /unrecognized flag/ : /Usage: node role-change-radar/);
    assert.equal(fs.existsSync(path.join(root, 'data')), false);
  }
});
test('identical and harmless whitespace/presentation changes have no changes', () => {
  for (const text of [original, original.replaceAll('\n', '\r\n\n').replaceAll(' ', '  '), original.replace('Responsibilities', '## Responsibilities')]) assert.equal(compareDescriptions(original, text).changes.length, 0);
});
test('explicit remote to hybrid, salary ranges and original excerpt offsets', () => {
  const next = original.replace('Remote', 'Hybrid: 2 days in office').replace('100,000–120,000', '110,000–135,000');
  const result = compareDescriptions(original, next);
  assert.ok(result.changes.some(c => c.categories.includes('Work arrangement')));
  assert.ok(result.changes.some(c => c.categories.includes('Salary and compensation')));
  for (const c of result.changes) for (const [side, text] of [['before', original], ['after', next]]) if (c[side]) assert.equal(text.slice(c[side].start, c[side].end), c[side].text);
  assert.match(result.changes.map(c => c.after?.text).join(''), /USD 110,000–135,000 per year, depending on experience/);
});
test('removal does not imply salary reduction or on-site requirement', () => {
  const next = original.split('\n').filter(line => !/Salary|Work arrangement/.test(line)).join('\n');
  const summary = compareDescriptions(original, next).changes.map(c => c.summary).join(' ');
  assert.match(summary, /no longer stated/);
  assert.match(summary, /Salary no longer stated/);
  assert.match(summary, /Work arrangement no longer stated/);
  assert.doesNotMatch(summary, /reduced|pay cut|on-site requirement/i);
});
test('experience, responsibilities, qualifications, employment, location and other remain visible', () => {
  for (const [line, category] of [['5 years experience required.', 'Required experience'], ['Develop testing tools.', 'Responsibilities'], ['Python proficiency required.', 'Skills and qualifications'], ['Part-time contract.', 'Employment type'], ['Location: Paris', 'Location'], ['We enjoy puzzles.', 'Other text changes']]) {
    assert.ok(compareDescriptions('Existing unchanged paragraph.', `Existing unchanged paragraph.\n${line}`).changes.some(c => c.categories.includes(category)), category);
  }
  assert.ok(compareDescriptions(original, original.replace('Maintain service documentation.\n', '')).changes.some(c => c.categories.includes('Responsibilities') && c.before && !c.after));
});
test('conflicting arrangements are shown for review', () => {
  const result = compareDescriptions(original, `${original}\nOn-site attendance is mandatory.`);
  assert.match(result.warnings.join(' '), /multiple work arrangements/);
});
test('no baseline, unknown date, earliest dated archive and immutable baseline', async t => {
  const { root, application } = fixture(t, false);
  assert.equal((await radar(root, application, { action: 'load' })).baseline, null);
  let state = await radar(root, application, paste(original));
  assert.equal(state.lastCheck.status, 'failed');
  state = await radar(root, application, { ...paste(original), action: 'baseline' });
  assert.equal(state.baseline.basis, 'Saved for future checks');
  const baseline = state.baseline;
  state = await radar(root, application, paste(original.replace('Remote', 'Hybrid')));
  assert.deepEqual(state.baseline, baseline);
});
test('report evaluation date is not a capture date; dated JD candidates use earliest', t => {
  const { root, application } = fixture(t);
  assert.equal(discoverBaseline(root, application).capturedAt, null);
  fs.mkdirSync(path.join(root, 'jds'));
  for (const date of ['2026-03-01', '2026-02-01']) fs.writeFileSync(path.join(root, 'jds', `007-${date}_fictional-labs_engineer.txt`), original);
  const baseline = discoverBaseline(root, application);
  assert.equal(baseline.capturedAt, '2026-02-01');
  assert.equal(baseline.chronologyUncertain, true);
  assert.equal(baseline.basis, 'Earliest saved description');
});
test('empty, blocked, partial, invalid and oversized captures fail clearly', () => {
  for (const capture of [{ text: '' }, { text: 'Short stub' }, { text: `${original}\nAccess denied` }, { text: original, blocked: true }, { text: original, partial: true }, { text: original, truncated: true }, { text: 'x'.repeat(MAX_TEXT) }, { text: `${original}…` }]) assert.throws(() => validateCapture(capture), /Unable|Incomplete/);
});
test('failed refresh and identity mismatch retain successful result and baseline', async t => {
  const { root, application } = fixture(t);
  let state = await radar(root, application, paste(original.replace('Remote', 'Hybrid')));
  const baseline = state.baseline, comparisons = structuredClone(state.comparisons);
  for (const extract of [async () => { throw new Error('Unable to check: offline'); }, async () => ({ text: '' }), async () => ({ text: original, partial: true }), async () => ({ text: original, title: 'Pastry Chef', url: app.url })]) {
    state = await radar(root, application, { action: 'check', source: 'public' }, { extract });
    assert.equal(state.lastCheck.status, 'failed');
    assert.deepEqual(state.comparisons, comparisons);
    assert.deepEqual(state.baseline, baseline);
  }
  assert.match(state.lastCheck.error, /identity mismatch/);
});
test('requisition identity mismatch is detected even at the same URL', () => {
  assert.ok(identityWarnings({ ...app, text: 'Job ID: REQ123' }, { title: app.title, text: 'Job ID: REQ999' }).length);
});
test('deduplication, review scoped to one comparison, and returning revision', async t => {
  const { root, application } = fixture(t);
  const changed = original.replace('Remote', 'Hybrid');
  let state = await radar(root, application, paste(changed));
  const id = state.comparisons[0].id;
  await radar(root, application, { action: 'review', comparisonId: id });
  state = await radar(root, application, paste(changed));
  assert.equal(state.captures.length, 1); assert.equal(state.comparisons.length, 1);
  assert.ok(state.comparisons[0].reviewedAt);
  state = await radar(root, application, paste(original));
  assert.equal(state.comparisons[1].reviewedAt, null);
  state = await radar(root, application, paste(changed));
  assert.equal(state.captures.length, 2); assert.equal(state.comparisons.length, 3);
  assert.equal(state.comparisons[2].reviewedAt, null);
});
test('concurrent checks do not lose history or corrupt the baseline', async t => {
  const { root, application } = fixture(t);
  await Promise.all([radar(root, application, paste(original.replace('Remote', 'Hybrid'))), radar(root, application, paste(original.replace('London', 'Paris')))]);
  const state = await radar(root, application, { action: 'load' });
  assert.equal(state.comparisons.length, 2); assert.equal(state.baseline.text, original);
});
test('adding a report number preserves tracker-only Radar history', async t => {
  const { root, application } = fixture(t);
  const changed = original.replace('Remote', 'Hybrid');
  let state = await radar(root, { ...application, reportNum: null }, paste(changed));
  const baseline = state.baseline;
  const comparison = state.comparisons[0];

  state = await radar(root, { ...application, reportNum: 7 }, { action: 'load' });
  assert.deepEqual(state.baseline, baseline);
  assert.equal(state.comparisons.length, 1);
  assert.equal(state.comparisons[0].id, comparison.id);
  assert.equal(state.identity, `tracker:${app.id}:${app.company}:${app.title}`);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'role-change-radar')).filter(name => name.endsWith('.json')).length, 1);
});
test('unsafe public URLs and archive traversal are rejected without network', async t => {
  for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://192.168.1.1/', 'http://localhost/']) await assert.rejects(fetchPosting(url), /Unable/);
  const { root, application } = fixture(t);
  assert.throws(() => discoverBaseline(root, { ...application, reportFile: '../outside.md' }), /Unsafe/);
});
test('untrusted original text is retained, never interpreted', async t => {
  const { root, application } = fixture(t);
  const text = `${original}\n<script>globalThis.radarPwned = true</script>`;
  const state = await radar(root, application, paste(text));
  assert.equal(state.captures[0].text, text);
  assert.equal(globalThis.radarPwned, undefined);
});
test('malformed saved data is not treated as missing or overwritten', async t => {
  const { root, application } = fixture(t);
  await radar(root, application, { action: 'load' });
  const dir = path.join(root, 'data', 'role-change-radar');
  const file = path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.json')));
  fs.writeFileSync(file, '{broken');
  await assert.rejects(radar(root, application, paste(original)));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('usable public capture supports unchanged result and safe provenance', async t => {
  const { root, application } = fixture(t);
  const state = await radar(root, application, { action: 'check', source: 'public' }, { extract: async () => ({ text: original, title: app.title, url: app.url }) });
  assert.equal(state.lastCheck.status, 'success');
  assert.equal(state.comparisons[0].changes.length, 0);
  assert.equal(state.captures[0].source, app.url);
});
test('unsafe destination and different job redirects fail', async t => {
  const { root, application } = fixture(t);
  for (const raw of [{ text: original, url: 'http://127.0.0.1/' }, { text: original.replace('Platform Engineer', 'Sales Engineer'), url: app.url }, { text: original, url: app.url.replace('123', '999') }]) {
    const state = await radar(root, application, { action: 'check', source: 'public' }, { extract: async () => raw });
    assert.equal(state.lastCheck.status, 'failed');
    assert.equal(state.comparisons.length, 0);
  }
});
test('manual different posting is refused and explicit baseline save cannot overwrite', async t => {
  const { root, application } = fixture(t);
  let state = await radar(root, application, paste(original.replace('Platform Engineer', 'Sales Engineer')));
  assert.match(state.lastCheck.error, /identity mismatch/);
  const baseline = state.baseline;
  state = await radar(root, application, { ...paste(original.replace('Remote', 'Hybrid')), action: 'baseline' });
  assert.match(state.lastCheck.error, /already exists/);
  assert.deepEqual(state.baseline, baseline);
});
