import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LISTING_FINGERPRINT_VERSION,
  computeListingFingerprint,
  validateListingFingerprint,
  listingKey,
} from '../listing-fingerprint.mjs';

const STRONG = { ats_provider: 'greenhouse', board_slug: 'example', posting_id: '12345' };
// Pinned contract fixture: consumers must derive this key without URL context.
const KEY = 'listing_v1_a8b20889013d5069bc5173d8f948309aef3a2bf1946e7190f628ea053271ecc6';
const POSTING_URL = 'https://boards.greenhouse.io/example/jobs/12345';
const cliPath = fileURLToPath(new URL('../listing-fingerprint.mjs', import.meta.url));
const runCli = (...args) => spawnSync(process.execPath, [cliPath, ...args], {
  encoding: 'utf8',
  timeout: 10000,
});

function assertValid(record) {
  assert.deepEqual(validateListingFingerprint(record), { valid: true, errors: [] });
}

function assertInvalid(record) {
  const result = validateListingFingerprint(record);
  assert.equal(result.valid, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  assert.ok(result.errors.every(error => typeof error === 'string'));
  assert.throws(() => listingKey(record), TypeError);
}

test('v1 has a stable, independently reproducible strong identity key', () => {
  assert.equal(LISTING_FINGERPRINT_VERSION, 1);
  const record = computeListingFingerprint({ url: POSTING_URL, strong: STRONG });
  assert.deepEqual(record, {
    schema_version: 1,
    identity: 'strong',
    strong: STRONG,
    canonical_host: 'boards.greenhouse.io',
    canonical_path: '/example/jobs/12345',
    listing_key: KEY,
  });
  assertValid(record);
  assert.equal(listingKey(record), KEY);
});

test('resolved ATS and branded URLs retain identity across URL rotation', () => {
  const urls = [
    POSTING_URL,
    `${POSTING_URL}/?gh_src=tracking#apply`,
    'https://careers.example.com/software-engineer',
    'https://jobs.example.net/new-path?ref=campaign',
  ];
  const records = urls.map(url => computeListingFingerprint({ url, strong: STRONG }));
  assert.ok(records.every(record => listingKey(record) === KEY));
  assert.notEqual(records[0].canonical_host, records[2].canonical_host);
  assert.notEqual(records[0].canonical_path, records[3].canonical_path);
});

test('every tuple member is authoritative; opaque IDs preserve case and delimiters', () => {
  const triples = [
    STRONG,
    { ...STRONG, ats_provider: 'lever' },
    { ...STRONG, board_slug: 'other' },
    { ...STRONG, posting_id: '12346' },
    { ...STRONG, board_slug: 'Example' },
    { ...STRONG, posting_id: 'REQ-1' },
    { ...STRONG, posting_id: 'req-1' },
    { ...STRONG, posting_id: '012345' },
    { ...STRONG, board_slug: 'a:b', posting_id: 'c' },
    { ...STRONG, board_slug: 'a', posting_id: 'b:c' },
    { ...STRONG, board_slug: 'a|b', posting_id: 'c' },
    { ...STRONG, board_slug: 'a', posting_id: 'b|c' },
    { ...STRONG, posting_id: 'req/1' },
    { ...STRONG, posting_id: 'req%2F1' },
    { ...STRONG, posting_id: 'caf\u00e9' },
    { ...STRONG, posting_id: 'cafe\u0301' },
  ];
  const records = triples.map(strong => computeListingFingerprint({ url: POSTING_URL, strong }));
  assert.equal(new Set(records.map(listingKey)).size, triples.length);
  records.forEach((record, i) => {
    assert.deepEqual(record.strong, triples[i]);
    assertValid(record);
  });
});

test('a native-looking URL alone remains partial and never supplies a cache key', () => {
  const first = computeListingFingerprint({ url: POSTING_URL });
  const second = computeListingFingerprint({ url: POSTING_URL });
  assert.deepEqual(first, {
    schema_version: 1,
    identity: 'partial',
    canonical_host: 'boards.greenhouse.io',
    canonical_path: '/example/jobs/12345',
    listing_key: null,
  });
  assert.deepEqual(second, first);
  assertValid(first);
  assert.equal(listingKey(first), null);
  assert.equal(listingKey(second), null);
});

test('incomplete or blank triples discard their nonauthoritative fragments', () => {
  const incomplete = [
    {},
    { ats_provider: 'greenhouse' },
    { ats_provider: 'greenhouse', board_slug: 'example' },
    { board_slug: 'example', posting_id: '12345' },
    { ...STRONG, posting_id: '' },
    { ...STRONG, board_slug: '   ' },
  ];
  for (const strong of incomplete) {
    const record = computeListingFingerprint({ url: POSTING_URL, strong });
    assert.equal(record.identity, 'partial');
    assert.equal(listingKey(record), null);
    assert.equal(Object.hasOwn(record, 'strong'), false);
    assertValid(record);
  }
});

test('URL context is optional for both strong and partial records', () => {
  const strong = computeListingFingerprint({ strong: STRONG });
  const partial = computeListingFingerprint({});
  assert.equal(listingKey(strong), KEY);
  assert.equal(listingKey(partial), null);
  for (const record of [strong, partial]) {
    assert.equal(record.canonical_host, null);
    assert.equal(record.canonical_path, null);
    assertValid(record);
  }
  assert.deepEqual(computeListingFingerprint({ url: null }), partial);
});

test('canonical URL context discards query and fragment, retains host port and path case', () => {
  const record = computeListingFingerprint({
    url: 'https://CAREERS.EXAMPLE.COM:8443/Jobs/Req-42/?ref=campaign#apply',
  });
  assert.equal(record.canonical_host, 'careers.example.com:8443');
  assert.equal(record.canonical_path, '/Jobs/Req-42');
  assertValid(record);
  const root = computeListingFingerprint({ url: 'https://careers.example.com:443/?x=1' });
  assert.equal(root.canonical_host, 'careers.example.com');
  assert.equal(root.canonical_path, '/');
  assertValid(root);
});

test('malformed URLs and credentials are rejected instead of promoted to identity', () => {
  for (const url of [
    '/example/jobs/12345', 'not-a-url', 'ftp://example.com/job/1', 'https:example.com',
    'https://user:password@example.com/job/1', 'https://user@example.com/job/1',
    ' https://example.com/job/1', 'https://example.com/job/1 ', 'https://example.com/job/\n1',
    12345, {}, [],
  ]) {
    assert.throws(() => computeListingFingerprint({ url, strong: STRONG }), TypeError);
  }
});

test('non-default ports and IPv6 URL context round-trip through validation', () => {
  for (const [url, host] of [
    ['http://example.com:443/jobs/1', 'example.com:443'],
    ['https://example.com:80/jobs/1', 'example.com:80'],
    ['https://[2001:db8::1]:8443/jobs/1', '[2001:db8::1]:8443'],
  ]) {
    const record = computeListingFingerprint({ url, strong: STRONG });
    assert.equal(record.canonical_host, host);
    assert.equal(listingKey(record), KEY);
    assertValid(record);
  }
});

test('identifiers cannot be coerced, trimmed, case folded or repaired', () => {
  for (const field of Object.keys(STRONG)) {
    for (const value of [12345, false, null, {}, [], ' invalid', 'invalid ', 'in\nvalid', 'in\u0000valid']) {
      assert.throws(() => computeListingFingerprint({ strong: { ...STRONG, [field]: value } }), TypeError);
    }
  }
  assert.throws(() => computeListingFingerprint({ strong: { ...STRONG, ats_provider: 'Greenhouse' } }), TypeError);
});

test('weak similarity and private fields are not accepted as identity inputs or schema fields', () => {
  const strong = computeListingFingerprint({ strong: STRONG });
  for (const [field, value] of Object.entries({
    company: 'Example', title: 'Engineer', location: 'Remote',
    jd_fingerprint: '0123456789abcdef', content_hash: 'hash',
    email: 'candidate@example.test', cv: 'private CV', score: 5, weak: {},
  })) {
    assert.throws(() => computeListingFingerprint({ strong: STRONG, [field]: value }), TypeError);
    assert.throws(() => computeListingFingerprint({ strong: { ...STRONG, [field]: value } }), TypeError);
    assertInvalid({ ...strong, [field]: value });
    assertInvalid({ ...strong, strong: { ...STRONG, [field]: value } });
  }
});

test('validation rejects unsupported versions, altered keys and malformed top-level shapes', () => {
  const record = computeListingFingerprint({ strong: STRONG });
  for (const value of [null, [], 'record', 1, true]) {
    assertInvalid(value);
    assert.throws(() => computeListingFingerprint(value), TypeError);
  }
  for (const schema_version of [0, 2, '1', null]) {
    assertInvalid({ ...record, schema_version });
  }
  for (const field of Object.keys(record)) {
    const missing = { ...record };
    delete missing[field];
    assertInvalid(missing);
  }
  for (const listing_key of [null, '', KEY.toUpperCase(), `listing_v2_${'a'.repeat(64)}`, `listing_v1_${'0'.repeat(64)}`]) {
    assertInvalid({ ...record, listing_key });
  }
  assertInvalid({ ...record, strong: { ...STRONG, posting_id: '67890' } });
  assertInvalid({ ...record, strong: { ...STRONG, posting_id: 12345 } });
  assertInvalid({ ...record, strong: [] });
  assertInvalid({ ...record, identity: 'weak' });
});

test('partial records cannot carry strong fragments or a key, and URL context is a pair', () => {
  const partial = computeListingFingerprint({ url: POSTING_URL });
  assertInvalid({ ...partial, listing_key: KEY });
  assertInvalid({ ...partial, strong: STRONG });
  assertInvalid({ ...partial, strong: {} });
  assertInvalid({ ...partial, identity: 'strong' });
  for (const context of [
    { canonical_host: null },
    { canonical_path: null },
    { canonical_host: 'https://example.com' },
    { canonical_host: 'EXAMPLE.COM' },
    { canonical_host: 'user@example.com' },
    { canonical_path: 'jobs/12345' },
    { canonical_path: '/jobs/12345?token=private' },
    { canonical_path: '/jobs/12345#apply' },
    { canonical_path: '/jobs/12345/' },
  ]) {
    assertInvalid({ ...partial, ...context });
  }
});

test('inherited identities are rejected; own fields in plain objects remain valid', () => {
  const record = computeListingFingerprint({ strong: STRONG });
  assertInvalid(Object.create(record));
  assertInvalid({ ...record, strong: Object.create(STRONG) });
  assert.throws(() => computeListingFingerprint(Object.create({ strong: STRONG })), TypeError);
  assert.throws(() => computeListingFingerprint({ strong: Object.create(STRONG) }), TypeError);
  assert.throws(() => computeListingFingerprint(new Date()), TypeError);
  assertValid(Object.assign(Object.create(null), record));
});

test('direct API rejects accessors without reading them and rejects hidden unknown fields', () => {
  const record = computeListingFingerprint({ strong: STRONG });
  let reads = 0;
  const accessor = { enumerable: true, get() { reads++; return KEY; } };
  assert.throws(() => computeListingFingerprint(Object.defineProperty({}, 'strong', accessor)), TypeError);
  assertInvalid(Object.defineProperty({ ...record }, 'listing_key', accessor));
  const strong = Object.defineProperty({ ...STRONG }, 'posting_id', accessor);
  assert.throws(() => computeListingFingerprint({ strong }), TypeError);
  assertInvalid({ ...record, strong });
  assert.equal(reads, 0, 'compute, validate and listingKey must not invoke getters');

  for (const field of ['private_note', Symbol('private_note')]) {
    const hide = value => Object.defineProperty(value, field, { value: 'private', enumerable: false });
    assert.throws(() => computeListingFingerprint(hide({ strong: STRONG })), TypeError);
    assert.throws(() => computeListingFingerprint({ strong: hide({ ...STRONG }) }), TypeError);
    assertInvalid(hide({ ...record }));
    assertInvalid({ ...record, strong: hide({ ...STRONG }) });
  }
});

test('CLI help, computation and validation accept inline JSON', () => {
  const help = runCli('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /usage:/i);
  assert.match(help.stdout, /--validate/);

  const input = { url: POSTING_URL, strong: STRONG };
  const compute = runCli(JSON.stringify(input));
  assert.equal(compute.status, 0, compute.stderr);
  const record = JSON.parse(compute.stdout);
  assert.deepEqual(record, computeListingFingerprint(input));

  const validate = runCli('--validate', JSON.stringify(record));
  assert.equal(validate.status, 0, validate.stderr);
  assert.deepEqual(JSON.parse(validate.stdout), { valid: true, errors: [] });
});

test('CLI rejects malformed JSON and records without leaking raw input or stack traces', () => {
  const privateValue = 'PRIVATE_PAYLOAD_MUST_NOT_APPEAR';
  const inputs = [
    [JSON.stringify({ strong: { ...STRONG, posting_id: { privateValue } } })],
    [`{"url":"${privateValue}"`],
    [JSON.stringify({ url: `https://user:${privateValue}@example.com/jobs/1` })],
    ['--validate', JSON.stringify({ private: privateValue })],
    ['--validate', JSON.stringify({ ...computeListingFingerprint({ strong: STRONG }), listing_key: privateValue })],
    ['--unknown'],
    [],
    ['{}', '{}'],
  ];
  for (const args of inputs) {
    const result = runCli(...args);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.ok(output.trim().length > 0);
    assert.ok(!output.includes(privateValue));
    assert.doesNotMatch(output, /\n\s+at\s|file:\/\/|SyntaxError:|TypeError:/);
  }
});
