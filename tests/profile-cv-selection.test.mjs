/** Fictional fixtures only; every CLI runs against an external Data Root. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { loadValidatedProfile, validateProfile } from '../lib/career-profile.mjs';
import { prepareCvSelection, verifyCvSelection, selectionDigest, SelectionError } from '../lib/profile-cv-selection.mjs';
import { validatePayload } from '../lib/cv-payload-schema.mjs';

const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/profile-cv-selection.json'), 'utf8'));
function input() {
  const basePayload = structuredClone(fixture.base_payload);
  return {
    profile: structuredClone(fixture.profile), basePayload,
    selection: {
      schema: 'profile-selection.v1', base_payload_sha256: selectionDigest(basePayload),
      bindings: [{ profile_entry_id: 'exp-acme-recent',
        target: { experience_index: 0, entry_sha256: selectionDigest(basePayload.experience[0]) },
        fact_ids: ['fact-chinese', 'fact-team'] }],
    },
  };
}
function check(name, run) {
  try { run(); pass(`profile selection: ${name}`); }
  catch (error) { fail(`profile selection: ${name}: ${error.stack}`); }
}
function rejectsCode(run, code) {
  assert.throws(run, error => error instanceof SelectionError && error.code === code);
}

check('verbatim ordered bullets, precise mapping, pure inputs and preserved identity/sections', () => {
  const original = input();
  const result = prepareCvSelection(original);
  const expected = structuredClone(original.basePayload);
  expected.experience[0].bullets = ['维护 A&B <组件> 的告警规则。', 'Managed 20 people.'];
  assert.deepEqual(result.payload, expected);
  assert.deepEqual(original, input());
  assert.deepEqual(validatePayload(result.payload, 'html').errors, []);
  assert.deepEqual(result.mapping.bullets, [
    { experience_index: 0, bullet_index: 0, profile_entry_id: 'exp-acme-recent', fact_id: 'fact-chinese',
      text_sha256: selectionDigest('维护 A&B <组件> 的告警规则。'), evidence: { source: 'cv.md', quote: '维护 A&B <组件> 的告警规则。' } },
    { experience_index: 0, bullet_index: 1, profile_entry_id: 'exp-acme-recent', fact_id: 'fact-team',
      text_sha256: selectionDigest('Managed 20 people.'), evidence: { source: 'cv.md', quote: 'Managed 20 people.' } },
  ]);
  assert.equal(verifyCvSelection(original, result), true);
});

const invalid = [
  ['unknown schema', x => { x.selection.schema = 'v2'; }, 'selection-schema'],
  ['empty bindings', x => { x.selection.bindings = []; }, 'empty-bindings'],
  ['missing entry', x => { x.selection.bindings[0].profile_entry_id = 'missing'; }, 'missing-entry'],
  ['unreviewed entry', x => { x.profile.experiences[0].review_status = 'needs_review'; }, 'entry-not-verified'],
  ['missing fact', x => { x.selection.bindings[0].fact_ids = ['missing']; }, 'missing-or-wrongly-bound-fact'],
  ['wrong same-label entry', x => { x.selection.bindings[0].fact_ids = ['fact-earlier']; }, 'missing-or-wrongly-bound-fact'],
  ['unreviewed fact', x => { x.selection.bindings[0].fact_ids = ['fact-unreviewed']; }, 'fact-not-verified'],
  ['duplicate fact', x => { x.selection.bindings[0].fact_ids = ['fact-team', 'fact-team']; }, 'duplicate-selected-fact'],
  ['empty facts', x => { x.selection.bindings[0].fact_ids = []; }, 'empty-fact-selection'],
  ['invalid slot', x => { x.selection.bindings[0].target.experience_index = -1; }, 'invalid-target'],
  ['wrong slot anchor', x => { x.selection.bindings[0].target.experience_index = 1; }, 'target-anchor-changed'],
  ['duplicate slot', x => { x.selection.bindings.push(structuredClone(x.selection.bindings[0])); }, 'duplicate-target'],
  ['changed base', x => { x.basePayload.summary = 'A changed summary'; }, 'base-payload-changed'],
  ['ambiguous global IDs', x => { x.profile.experiences[1].id = x.profile.experiences[0].id; }, 'invalid-profile'],
  ['ambiguous fact IDs', x => { x.profile.experiences[1].facts[0].id = 'fact-team'; }, 'invalid-profile'],
  ['malformed evidence', x => { x.profile.experiences[0].facts[0].evidence.line = 0; }, 'invalid-profile'],
  ['existing HTML schema errors', x => { delete x.basePayload.experience[0].company; }, 'invalid-payload'],
];
for (const [name, change, code] of invalid) check(`rejects ${name}`, () => {
  const original = input();
  change(original);
  rejectsCode(() => prepareCvSelection(original), code);
});

check('diagnostics identify the selected entry, fact and target slot', () => {
  const original = input();
  original.selection.bindings[0].fact_ids = ['fact-unreviewed'];
  assert.throws(() => prepareCvSelection(original), error => error.code === 'fact-not-verified'
    && error.profile_entry_id === 'exp-acme-recent' && error.fact_id === 'fact-unreviewed' && error.experience_index === 0);
});

for (const [name, change] of [
  ['selected text', x => { x.profile.experiences[0].facts[0].text = 'Changed wording.'; }],
  ['selected evidence quote', x => { x.profile.experiences[0].facts[0].evidence.quote = 'Changed source quote.'; }],
  ['selected evidence source', x => { x.profile.experiences[0].facts[0].evidence.source = 'other.md'; }],
  ['entry identity wording', x => { x.profile.experiences[0].label = 'Changed entry'; }],
  ['entry evidence', x => { x.profile.experiences[0].evidence.source = 'other.md'; }],
  ['selection order', x => { x.selection.bindings[0].fact_ids.reverse(); }],
  ['explicit rebinding', x => {
    x.selection.bindings[0].target = { experience_index: 1, entry_sha256: selectionDigest(x.basePayload.experience[1]) };
  }],
]) check(`verification invalidates ${name}`, () => {
  const original = input();
  const prepared = prepareCvSelection(original);
  change(original);
  assert.throws(() => verifyCvSelection(original, prepared), SelectionError);
});

check('verification rejects a revoked review even when mapping remains unchanged', () => {
  const original = input();
  const prepared = prepareCvSelection(original);
  original.profile.experiences[0].facts[0].review_status = 'needs_review';
  rejectsCode(() => verifyCvSelection(original, prepared), 'fact-not-verified');
});

check('line shifts, unrelated valid edits, and Profile reordering keep selections valid', () => {
  const original = input();
  const prepared = prepareCvSelection(original);
  original.profile.experiences[0].evidence.line += 10;
  original.profile.experiences[0].facts.forEach(fact => { fact.evidence.line += 10; });
  original.profile.experiences[0].facts[2].text = 'Changed unselected fact.';
  original.profile.candidate.name = 'Changed unused identity';
  original.profile.experiences[1].label = 'Unrelated entry edit';
  original.profile.experiences.reverse();
  original.profile.experiences.forEach(entry => entry.facts.reverse());
  assert.equal(verifyCvSelection(original, prepared), true);
});

check('multiple same-label entries bind by ID and preserve independent bullet order', () => {
  const original = input();
  original.selection.bindings.push({ profile_entry_id: 'exp-acme-earlier',
    target: { experience_index: 1, entry_sha256: selectionDigest(original.basePayload.experience[1]) }, fact_ids: ['fact-earlier'] });
  const prepared = prepareCvSelection(original);
  assert.deepEqual(prepared.payload.experience[1].bullets, ['Maintained release notes.']);
  assert.equal(prepared.mapping.bullets[2].profile_entry_id, 'exp-acme-earlier');
});

check('resealed edits outside selected bullets cannot bypass reconstruction', () => {
  const original = input();
  const prepared = prepareCvSelection(original);
  prepared.payload.experience[1].role = 'Invented title';
  prepared.mapping.payload_sha256 = selectionDigest(prepared.payload);
  rejectsCode(() => verifyCvSelection(original, prepared), 'prepared-payload-mismatch');
});
check('mapping-only edits fail verification', () => {
  const original = input();
  const prepared = prepareCvSelection(original);
  prepared.mapping.bullets[0].fact_id = 'fact-earlier';
  rejectsCode(() => verifyCvSelection(original, prepared), 'prepared-mapping-mismatch');
});
check('JSON hashing ignores object key order but rejects lossy and cyclic values', () => {
  assert.equal(selectionDigest({ a: 1, b: [2, 3] }), selectionDigest({ b: [2, 3], a: 1 }));
  assert.notEqual(selectionDigest([2, 3]), selectionDigest([3, 2]));
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, new Date(), { a: undefined }, [, 1], cycle]) {
    rejectsCode(() => selectionDigest(value), 'non-json-input');
  }
});

const root = mkdtempSync(join(tmpdir(), 'profile selection data '));
const save = (file, value) => writeFileSync(join(root, file), JSON.stringify(value, null, 2));
const networkGuard = join(root, 'offline.mjs');
writeFileSync(networkGuard, `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { throw new Error('Unexpected network access'); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = blocked;
syncBuiltinESMExports();
`);
function cli(script, args, status = 0, overrides = {}) {
  const result = spawnSync(NODE, ['--import', pathToFileURL(networkGuard).href, join(ROOT, script), ...args], {
    cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: '', ...overrides }, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, status, describeSpawn(result));
  return result;
}
try {
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'output'));
  const original = input();
  save('data/career-profile.yml', original.profile); // JSON is valid YAML.
  save('base.json', original.basePayload);
  save('selection.json', original.selection);
  writeFileSync(join(root, 'cv.md'), fixture.primary_cv);
  save('config/cv-facts.json', { allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] });
  const sourceFiles = ['data/career-profile.yml', 'base.json', 'selection.json', 'cv.md', 'config/cv-facts.json'];
  const before = sourceFiles.map(file => readFileSync(join(root, file), 'utf8'));
  const args = ['--payload', 'base.json', '--selection=selection.json'];

  check('shared reader respects explicit/default Data Roots and rejects missing/invalid profiles', () => {
    assert.deepEqual(loadValidatedProfile({ dataRoot: root }), original.profile);
    const previous = process.env.CAREER_OPS_ROOT;
    try {
      process.env.CAREER_OPS_ROOT = root;
      assert.deepEqual(loadValidatedProfile(), original.profile);
    } finally {
      if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = previous;
    }
    assert.throws(() => loadValidatedProfile({ file: join(root, 'missing.yml') }), { code: 'ENOENT' });
    save('invalid-reader.yml', { schema_version: 2 });
    assert.throws(() => loadValidatedProfile({ file: join(root, 'invalid-reader.yml') }), /schema_version must be 1/);
  });

  check('real prepare/verify CLIs run offline outside the checkout', () => {
    const prepared = JSON.parse(cli('career-profile.mjs', ['prepare-cv', ...args]).stdout);
    assert.deepEqual(prepared, prepareCvSelection(original));
    save('prepared.json', prepared);
    cli('career-profile.mjs', ['verify-cv', ...args, '--prepared', 'prepared.json']);
    save('alternate-profile.yml', original.profile);
    cli('career-profile.mjs', ['prepare-cv', ...args, '--profile', 'alternate-profile.yml']);
    cli('career-profile.mjs', ['prepare-cv', ...args], 0, { CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: root });
    assert.equal(cli('career-profile.mjs', ['validate']).status, 0);
  });

  check('CLI errors include fact/entry context and slot zero, omitting unavailable fields', () => {
    const selection = structuredClone(original.selection);
    selection.bindings[0].fact_ids = ['fact-unreviewed'];
    save('invalid-selection.json', selection);
    const factError = cli('career-profile.mjs', ['prepare-cv', '--payload', 'base.json', '--selection', 'invalid-selection.json'], 1);
    assert.equal(factError.stdout, '');
    assert.equal(factError.stderr, '[fact-not-verified] Selected fact needs review. (profile_entry_id="exp-acme-recent", fact_id="fact-unreviewed", experience_index=0)\n');

    delete selection.bindings[0].target;
    save('invalid-selection.json', selection);
    const targetError = cli('career-profile.mjs', ['prepare-cv', '--payload', 'base.json', '--selection', 'invalid-selection.json'], 1);
    assert.equal(targetError.stderr, '[invalid-target] Experience index is outside the base payload. (profile_entry_id="exp-acme-recent")\n');
  });

  check('CLI rejects stale preparation, missing/invalid profiles and malformed arguments', () => {
    const prepared = prepareCvSelection(original);
    prepared.payload.experience[0].bullets[0] = 'Edited after preparation';
    save('prepared.json', prepared);
    assert.match(cli('career-profile.mjs', ['verify-cv', ...args, '--prepared', 'prepared.json'], 1).stderr, /prepared-payload-mismatch/);
    cli('career-profile.mjs', ['prepare-cv', ...args, '--profile', 'absent.yml'], 1);
    save('invalid.yml', { schema_version: 2 });
    cli('career-profile.mjs', ['prepare-cv', ...args, '--profile', 'invalid.yml'], 1);
    for (const bad of [['--payload'], ['--payload='], ['--bogus'], [...args, '--payload', 'base.json'], [...args, 'extra.json'], ['--payload', 'base.json']]) {
      cli('career-profile.mjs', ['prepare-cv', ...bad], 1);
    }
  });

  check('prepared text renders literally through the existing HTML builder', () => {
    const prepared = prepareCvSelection(original);
    save('render.json', prepared.payload);
    cli('build-cv-html.mjs', [join(root, 'render.json'), join(root, 'output/cv.html')]);
    const html = readFileSync(join(root, 'output/cv.html'), 'utf8');
    assert.ok(html.includes('维护 A&amp;B &lt;组件&gt; 的告警规则。'));
    assert.ok(html.indexOf('维护 A&amp;B') < html.indexOf('Managed 20 people.'));
  });

  check('verified Profile text still fails the real PDF fact gate when primary sources disagree', () => {
    const inflated = structuredClone(original);
    inflated.profile.experiences[0].facts[0].text = 'Managed 999 people.';
    assert.deepEqual(validateProfile(inflated.profile), []);
    const prepared = prepareCvSelection(inflated);
    assert.equal(verifyCvSelection(inflated, prepared), true);
    save('inflated.json', prepared.payload);
    cli('build-cv-html.mjs', [join(root, 'inflated.json'), join(root, 'output/inflated.html')]);
    const result = cli('generate-pdf.mjs', [join(root, 'output/inflated.html'), join(root, 'output/inflated.pdf')], 1);
    assert.match(result.stderr, /Fact check failed[\s\S]*999 people/);
    assert.equal(existsSync(join(root, 'output/inflated.pdf')), false);
  });

  check('commands preserve Profile, primary sources and original manifests byte-for-byte', () => {
    assert.deepEqual(sourceFiles.map(file => readFileSync(join(root, file), 'utf8')), before);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
