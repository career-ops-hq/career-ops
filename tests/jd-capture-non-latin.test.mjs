// tests/jd-capture-non-latin.test.mjs — a company or role written in another
// script still gets a capture name of its own.
//
// captureSlug() kept only ASCII word characters, so 株式会社アクメ, Яндекс and
// شركة all slugged to ''. archive-posting.mjs then named every such capture
// `{date}__.pdf` (two postings archived on one day overwrote each other, and
// `--pipeline` reported both as saved), and findCaptureForReport() treats an
// empty company slug as "attribute nothing", so set-status.mjs could never
// recognise the capture it had just written and re-archived the posting at
// the Interview transition.
import { pass, fail, ROOT, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const { captureSlug, findCaptureForReport } = await import(pathToFileURL(join(ROOT, 'jd-capture.mjs')).href);
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

ok('a long non-Latin name is cut to the byte budget of an ASCII slug, and the whole filename stays under 255 bytes', () => {
  const cjk = '株式会社'.repeat(20);
  const slug = captureSlug(cjk);
  assert.ok(slug !== '' && Buffer.byteLength(slug) <= 60, `${Buffer.byteLength(slug)} bytes`);
  assert.ok(cjk.startsWith(slug), 'the slug is a prefix of the name');
  const filename = `012-2026-10-22_${slug}_${captureSlug('データエンジニア'.repeat(10))}_${'0123456789abcdef'}.pdf`;
  assert.ok(Buffer.byteLength(filename) <= 255, `${Buffer.byteLength(filename)} bytes`);
});

ok('cutting a non-Latin slug never splits a character', () => {
  const slug = captureSlug(String.fromCodePoint(0x20000).repeat(40));
  assert.equal(Buffer.byteLength(slug), 60);
  assert.equal(Buffer.from(slug).toString('utf8'), slug);
  assert.equal(captureSlug('Яндекс '.repeat(20)).endsWith('-'), false);
});

ok('a name with no ASCII letters is not reduced to an empty slug', () => {
  for (const name of ['株式会社アクメ', 'Яндекс', 'شركة النفط', 'データエンジニア']) {
    assert.notEqual(captureSlug(name), '', name);
  }
});

ok('two different non-Latin names get two different slugs', () => {
  assert.notEqual(captureSlug('株式会社アクメ'), captureSlug('株式会社ベータ'));
  assert.notEqual(captureSlug('Яндекс'), captureSlug('Сбербанк'));
});

ok('a slug that was already non-empty is unchanged (existing captures keep resolving)', () => {
  assert.equal(captureSlug('Foo&Bar Inc.'), 'foobar-inc');
  assert.equal(captureSlug('Acme Corp'), 'acme-corp');
  assert.equal(captureSlug('株式会社 Acme'), 'acme');
  assert.equal(captureSlug('Zürich AG'), 'zrich-ag');
});

ok('punctuation-only and empty input still slug to empty', () => {
  assert.equal(captureSlug('!!!'), '');
  assert.equal(captureSlug(''), '');
  assert.equal(captureSlug(null), '');
});

ok('the capture written for a non-Latin company is found again by report number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jd-capture-nonlatin-'));
  try {
    const name = `012-2026-10-11_${captureSlug('Яндекс')}_${captureSlug('Разработчик')}.pdf`;
    writeFileSync(join(dir, name), '%PDF');
    const hit = findCaptureForReport(dir, 12, { companySlug: captureSlug('Яндекс') });
    assert.ok(hit, 'capture not attributed to its own company');
    assert.equal(hit.filename, name);
    assert.equal(findCaptureForReport(dir, 12, { companySlug: captureSlug('Сбербанк') }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
