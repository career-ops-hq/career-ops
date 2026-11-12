import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { fixtures } from './cv-visual/fixtures.mjs';

test('visual fixtures independently cover each language, density, and photo combination', () => {
  const expected = new Set();
  for (const lang of ['en', 'zh-CN']) {
    for (const dense of [false, true]) {
      for (const withPhoto of [false, true]) expected.add(`${lang}/${dense}/${withPhoto}`);
    }
  }
  assert.equal(fixtures.length, expected.size);
  assert.equal(new Set(fixtures.map(({ id }) => id)).size, fixtures.length, 'artifact IDs must be unique');
  assert.deepEqual(new Set(fixtures.map(({ payload, dense, withPhoto }) =>
    `${payload.lang}/${dense}/${withPhoto}`)), expected);
  for (const { id, payload, dense, withPhoto } of fixtures) {
    assert.equal(id, `${payload.lang === 'en' ? 'en' : 'zh'}-${dense ? 'long' : 'short'}-${withPhoto ? 'photo' : 'no-photo'}`);
    assert.equal(Boolean(payload.candidate.photo), withPhoto, `${id}: photo flag matches rendered input`);
  }
});

test('changing the photo does not also change content or density', () => {
  for (const withoutPhoto of fixtures.filter(({ withPhoto }) => !withPhoto)) {
    const withPhoto = fixtures.find(({ payload, dense, withPhoto }) =>
      withPhoto && payload.lang === withoutPhoto.payload.lang && dense === withoutPhoto.dense);
    const expected = structuredClone(withoutPhoto.payload);
    expected.candidate.photo = withPhoto.payload.candidate.photo;
    assert.deepEqual(withPhoto.payload, expected);
  }
});

test('photo fixtures embed a visible PNG rather than an external image or transparent pixel', () => {
  const photos = new Set(fixtures.filter(({ withPhoto }) => withPhoto).map(({ payload }) => payload.candidate.photo));
  assert.equal(photos.size, 1);
  const photo = [...photos][0];
  assert.match(photo, /^data:image\/png;base64,/);
  const png = Buffer.from(photo.split(',')[1], 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.ok(width >= 64 && height >= 64, 'photo has enough pixels to reveal cropping');
  assert.equal(png[25], 2, 'RGB image has no transparency');
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  assert.equal(pixels.length, height * (1 + width * 3));
  // These fixtures deliberately use unfiltered rows, which makes the visible
  // contrast check independent of a browser or image-decoder installation.
  const colors = new Set();
  for (let row = 0; row < height; row++) {
    const offset = row * (1 + width * 3);
    assert.equal(pixels[offset], 0);
    for (let x = 0; x < width; x++) colors.add(pixels.subarray(offset + 1 + x * 3, offset + 4 + x * 3).toString('hex'));
  }
  assert.ok(colors.size > 1, 'a solid placeholder cannot reveal photo cropping');
});

test('dense fixtures exercise long fields as well as more entries', () => {
  for (const long of fixtures.filter(({ dense, withPhoto }) => dense && !withPhoto)) {
    const short = fixtures.find(({ payload, dense, withPhoto }) =>
      payload.lang === long.payload.lang && !dense && !withPhoto).payload;
    const payload = long.payload;
    assert.ok(payload.experience.length > short.experience.length);
    assert.ok(payload.experience.every(({ bullets }) => bullets.length >= 4));
    assert.ok(payload.projects.length > short.projects.length);
    for (const field of ['company', 'role', 'dates']) {
      assert.ok(payload.experience[0][field].length > short.experience[0][field].length, `${payload.lang}: longer ${field}`);
    }
    assert.ok(payload.projects[0].name.length > short.projects[0].name.length);
    assert.ok(payload.candidate.portfolio.display.length > short.candidate.portfolio.display.length);
    assert.ok(payload.competencies[0].length > short.competencies[0].length);
    assert.ok(payload.skills[0].items[0].length > short.skills[0].items[0].length);
  }
});

test('fixtures provide explicit ATS section labels and reserved example contacts', () => {
  for (const { id, payload } of fixtures) {
    for (const key of ['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'skills']) {
      assert.ok(payload.sections[key], `${id}: ${key} has an extraction assertion target`);
    }
    assert.match(payload.candidate.email, /@example\.com$/);
    for (const field of ['linkedin', 'portfolio']) {
      const host = new URL(payload.candidate[field].url).hostname;
      assert.ok(host === 'example.com' || host.endsWith('.example.com'), `${id}: contact URLs use reserved domains`);
    }
    assert.match(payload.summary, /does not describe a real candidate|不代表任何真实候选人/);
  }
});
