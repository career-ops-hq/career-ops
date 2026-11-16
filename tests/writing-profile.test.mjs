// writing-profile.mjs measures the user's own samples (#6940).
//
// Plain counts only. A text is noted when it sits clearly outside the range of
// the person's samples, and never when there are too few samples to have one.
//
// Run:  node --test tests/writing-profile.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProfile, loadProfile, measure, profileNotes, readSamples, MIN_SAMPLE_WORDS } from '../writing-profile.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SHORT = "I don't love long emails. I'd rather say it plain. It's a small thing, but it matters to me. We shipped it last week and it's holding up. I'm happy with how it turned out.";
const sample = (n) => Array.from({ length: n }, () => SHORT).join('\n\n');

test('measure counts sentences, contractions and first person', () => {
  const m = measure("I don't like it. It's fine, though. We left.");
  assert.equal(m.sentences, 3);
  assert.equal(m.words, 9);
  assert.equal(m.longestSentenceWords, 4);
  assert.ok(m.contractionsPer100 > 20);
  assert.ok(m.firstPersonPer100 > 0);
});

test('a sentence that ends inside a closing quote still ends', () => {
  const m = measure('"We shipped it." Then we went home. She said, "Fine." We left.');
  assert.equal(m.sentences, 4);
  assert.equal(m.longestSentenceWords, 4);
});

test('a possessive is not a contraction', () => {
  assert.equal(measure("The team's plan was Maria's idea.").contractionsPer100, 0);
});

test('a greeting and a signature are not sentences', () => {
  const m = measure('Dear Sam,\n\nI built the tool last year and it still runs.\n\nBest,\nJane');
  assert.equal(m.sentences, 1);
});

test('too few words gives no range', () => {
  const profile = buildProfile([{ file: 'a.txt', text: SHORT }]);
  assert.equal(profile.enough_samples, false);
  assert.equal(profile.ranges, undefined);
  assert.deepEqual(profileNotes(profile, sample(10)), []);
});

test('each number keeps the sample it came from', () => {
  const profile = buildProfile([
    { file: 'a.txt', text: sample(12) },
    { file: 'b.md', text: sample(12) },
  ]);
  assert.equal(profile.enough_samples, true);
  assert.ok(profile.total_words >= MIN_SAMPLE_WORDS);
  assert.deepEqual(profile.files.map((f) => f.file), ['a.txt', 'b.md']);
});

test('a text like the samples is not noted', () => {
  const profile = buildProfile([{ file: 'a.txt', text: sample(12) }]);
  assert.deepEqual(profileNotes(profile, sample(6)), []);
});

test('a very long sentence and no contractions are noted', () => {
  const profile = buildProfile([{ file: 'a.txt', text: sample(12) }]);
  const stiff = `${'I am writing to express my considerable interest in the position that you have advertised and to explain at some length why my background in building large systems for many years makes me a strong fit for the work that your team does '.repeat(2)}. ${'It is a role I would welcome. '.repeat(10)}`;
  const [note] = profileNotes(profile, stiff);
  assert.match(note, /^Writing profile note:/);
  assert.match(note, /word sentence/);
  assert.match(note, /contractions/);
  assert.match(note, /The PDF still builds/);
});

test('a short text is never judged', () => {
  const profile = buildProfile([{ file: 'a.txt', text: sample(12) }]);
  assert.deepEqual(profileNotes(profile, 'I am writing to apply for the role.'), []);
});

test('the README in writing-samples is not read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    writeFileSync(join(dir, 'writing-samples', 'README.md'), 'Drop examples here.');
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), SHORT);
    writeFileSync(join(dir, 'writing-samples', 'cv.pdf'), 'binary');
    assert.deepEqual(readSamples(dir).map((s) => s.file), ['post.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script writes data/writing-profile.json and loadProfile reads it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), sample(10));
    const run = spawnSync(process.execPath, [join(ROOT, 'writing-profile.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(run.status, 0, describeSpawn(run));
    assert.ok(existsSync(join(dir, 'data', 'writing-profile.json')));
    const profile = loadProfile(dir);
    assert.equal(profile.sample_count, 1);
    assert.equal(profile.files[0].file, 'post.txt');
    assert.ok(readFileSync(join(dir, 'data', 'writing-profile.json'), 'utf8').endsWith('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebuilding the profile replaces it whole and leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), sample(10));
    writeFileSync(join(dir, 'data', 'writing-profile.json'), '{old');
    const run = spawnSync(process.execPath, [join(ROOT, 'writing-profile.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(run.status, 0, describeSpawn(run));
    assert.equal(loadProfile(dir).sample_count, 1);
    assert.deepEqual(readdirSync(join(dir, 'data')), ['writing-profile.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a profile that cannot be read counts as none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'writing-profile.json'), '{not json');
    assert.equal(loadProfile(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The cover letter hook: a note on stderr, and the PDF still builds.
const CAPTURE = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-capture-register.mjs')).href;

function runLetter({ opening, withProfile }) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-letter-'));
  try {
    mkdirSync(join(dir, 'output'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'cv.md'), 'Jane Doe builds systems.\n');
    if (withProfile) writeFileSync(join(dir, 'data', 'writing-profile.json'), JSON.stringify(buildProfile([{ file: 'a.txt', text: sample(12) }])));
    writeFileSync(join(dir, 'payload.json'), JSON.stringify({
      candidate: { name: 'Jane Doe' },
      letter: { role_title: 'Engineer', opening, profile_intro: 'Profile.' },
      output_path: 'output/letter.pdf',
    }));
    const capture = join(dir, 'printed.html');
    const run = spawnSync(process.execPath, ['--import', CAPTURE, join(ROOT, 'generate-cover-letter.mjs'), '--payload', join(dir, 'payload.json')], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '', CAREER_OPS_TRACKER: '',
        CAREER_OPS_PDF_INDEX: '', CAREER_OPS_PDF_SHARED: '', COVER_HTML_CAPTURE: capture,
      },
    });
    return { run, built: existsSync(capture) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STIFF = `${'I am writing to express my considerable interest in the position that you have advertised and to explain at some length why my background in building large systems for many years makes me a strong fit for the work that your team does '.repeat(2)}.`;
const FILLER = Array.from({ length: 6 }, () => 'It is a role I would welcome.').join(' ');

test('the letter gets a note when it is far from the profile, and still builds', () => {
  const { run, built } = runLetter({ opening: `${STIFF} ${FILLER}`, withProfile: true });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.ok(built, 'a note must not stop the letter');
  assert.match(run.stderr, /Writing profile note:/);
});

test('no profile file means no note', () => {
  const { run } = runLetter({ opening: `${STIFF} ${FILLER}`, withProfile: false });
  assert.equal(run.status, 0, describeSpawn(run));
  assert.doesNotMatch(run.stderr, /Writing profile/);
});

test('--check=FILE measures the supplied file and does not rebuild the profile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), sample(10));

    const profile = {
      ...buildProfile([{ file: 'post.txt', text: sample(12) }]),
      testMarker: 'existing-profile-was-preserved',
    };

    const profilePath = join(dir, 'data', 'writing-profile.json');
    writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

    const target = join(dir, 'notes.txt');
    writeFileSync(target, sample(6));

    const run = spawnSync(
      process.execPath,
      [join(ROOT, 'writing-profile.mjs'), `--check=${target}`],
      {
        encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: dir },
      }
    );

    assert.equal(run.status, 0, describeSpawn(run));
    assert.match(run.stdout, /Inside the range of your samples/);

    assert.equal(
      JSON.parse(readFileSync(profilePath, 'utf8')).testMarker,
      'existing-profile-was-preserved',
      'the equals form must check the target instead of rebuilding the profile'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--help prints usage and builds nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), sample(10));
    const run = spawnSync(process.execPath, [join(ROOT, 'writing-profile.mjs'), '--help'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(run.status, 0, describeSpawn(run));
    assert.match(run.stdout, /Usage:/);
    assert.equal(existsSync(join(dir, 'data', 'writing-profile.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mistyped flag is refused and builds nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-wprofile-'));
  try {
    mkdirSync(join(dir, 'writing-samples'));
    writeFileSync(join(dir, 'writing-samples', 'post.txt'), sample(10));
    const run = spawnSync(process.execPath, [join(ROOT, 'writing-profile.mjs'), '--chek', 'x.txt'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.ok(exitedNonZero(run), describeSpawn(run));
    assert.equal(existsSync(join(dir, 'data', 'writing-profile.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
