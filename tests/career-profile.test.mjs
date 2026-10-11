import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'career-profile.mjs');
const CV = `# Candidate\n\n## Experience\n### Acme — Analyst\n- Built dashboards with SQL.\n\n## Skills\n- SQL, Excel\n`;

function withProfileRoot(run) {
  const root = mkdtempSync(join(tmpdir(), 'career-profile-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), CV);
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function runCli(root, args, input, timeout = 5000) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: root },
    encoding: 'utf8', input, timeout,
  });
}

test('reviewed import consumes piped answers one line at a time and writes approved facts', () => {
  withProfileRoot((root) => {
    const result = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(profile.experiences[0].facts[0].text, 'Built dashboards with SQL.');
    assert.equal(profile.skills.length, 2);
    assert.equal(profile.skills[0].review_status, 'verified');
    assert.equal(profile.skills[0].evidence.quote, '- SQL, Excel');
    const validation = runCli(root, ['validate']);
    assert.equal(validation.status, 0, validation.stderr);
  });
});

test('re-import after line shifts updates evidence without duplicating approved facts', () => {
  withProfileRoot((root) => {
    const first = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(first.status, 0, first.stderr);
    writeFileSync(join(root, 'cv.md'), `<!-- moved -->\n<!-- moved again -->\n${CV}`);
    const second = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(second.status, 0, second.stderr);
    const profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(profile.experiences.length, 1);
    assert.equal(profile.experiences[0].facts.length, 1);
    assert.equal(profile.skills.length, 2);
    assert.equal(profile.experiences[0].facts[0].evidence.line, 7);
  });
});

test('preview does not create a profile, and validation rejects missing evidence', () => {
  withProfileRoot((root) => {
    const preview = runCli(root, ['import', 'cv.md']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Preview only/);
    assert.throws(() => readFileSync(join(root, 'data', 'career-profile.yml')),
      { code: 'ENOENT' });

    const invalidPath = join(root, 'invalid.yml');
    writeFileSync(invalidPath, `schema_version: 1\ncandidate: {}\nsummary: []\nexperiences: []\nprojects: []\neducation: []\ncertifications: []\nskills:\n  - id: skill-1\n    text: SQL\n    review_status: verified\n    evidence:\n      source: cv.md\n`);
    const invalid = runCli(root, ['validate', invalidPath]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /evidence requires source, positive line, and quote/);
  });
});

test('source paths outside the data root retain their complete absolute path', () => {
  withProfileRoot((root) => {
    const sibling = `${root}-archive`;
    mkdirSync(sibling, { recursive: true });
    const sourcePath = join(sibling, 'cv.md');
    writeFileSync(sourcePath, CV);
    try {
      const result = runCli(root, ['import', sourcePath]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(sourcePath), result.stdout);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test('identical statements under different experience entries retain distinct IDs', () => {
  withProfileRoot((root) => {
    const cv = `# Candidate\n## Experience\n### North Co — Analyst\n- Shipped reports.\n### South Co — Analyst\n- Shipped reports.\n`;
    writeFileSync(join(root, 'cv.md'), cv);
    const result = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(result.status, 0, result.stderr);
    const profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    const ids = profile.experiences.map((entry) => entry.facts[0].id);
    assert.equal(profile.experiences.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });
});

test('repeated facts are deduplicated and same-title entries with different facts stay distinct', () => {
  withProfileRoot((root) => {
    const cv = `# Candidate\n## Experience\n### Acme — Analyst\n- Built reports.\n- Built reports.\n### Acme — Analyst\n- Built dashboards.\n## Skills\n- SQL, SQL\n`;
    writeFileSync(join(root, 'cv.md'), cv);
    const first = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\ny\n');
    assert.equal(first.status, 0, first.stderr);
    const before = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(before.experiences.length, 2);
    assert.notEqual(before.experiences[0].id, before.experiences[1].id);
    assert.equal(before.experiences[0].facts.length, 1);
    assert.equal(before.skills.length, 1);

    writeFileSync(join(root, 'cv.md'), `<!-- moved -->\n${cv}`);
    const second = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\ny\n');
    assert.equal(second.status, 0, second.stderr);
    const after = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(after.experiences.length, 2);
    assert.deepEqual(after.experiences.map((entry) => entry.facts[0].text).sort(), ['Built dashboards.', 'Built reports.']);
    assert.equal(after.skills.length, 1);
  });
});

test('reordering same-title entries keeps each identity attached to its facts on re-import', () => {
  withProfileRoot((root) => {
    const firstOrder = `# Candidate\n## Experience\n### Acme — Analyst\n- Built reports.\n### Acme — Analyst\n- Built dashboards.\n`;
    writeFileSync(join(root, 'cv.md'), firstOrder);
    const first = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(first.status, 0, first.stderr);
    const profilePath = join(root, 'data', 'career-profile.yml');
    const initial = yaml.load(readFileSync(profilePath, 'utf8'));
    const idsByFact = new Map(initial.experiences.map((entry) => [entry.facts[0].text, entry.id]));
    initial.experiences.forEach((entry, index) => {
      entry.id = `legacy-experience-${index}`;
      entry.facts.forEach((fact, factIndex) => { fact.id = `legacy-fact-${index}-${factIndex}`; });
    });
    writeFileSync(profilePath, yaml.dump(initial, { noRefs: true }));

    writeFileSync(join(root, 'cv.md'), `# Candidate\n## Experience\n### Acme — Analyst\n- Built dashboards.\n### Acme — Analyst\n- Built reports.\n`);
    const second = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\ny\ny\n');
    assert.equal(second.status, 0, second.stderr);
    const reordered = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(reordered.experiences.length, 2);
    assert.deepEqual(reordered.experiences.map((entry) => entry.facts.map((fact) => fact.text)).sort(), [
      ['Built dashboards.'],
      ['Built reports.'],
    ]);
    for (const entry of reordered.experiences) assert.equal(entry.id, idsByFact.get(entry.facts[0].text));
  });
});

test('skipping an experience heading also skips its facts', () => {
  withProfileRoot((root) => {
    const result = runCli(root, ['import', 'cv.md', '--review'], 'n\ny\ny\n');
    assert.equal(result.status, 0, result.stderr);
    const profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(profile.experiences.length, 0);
    assert.equal(profile.skills.length, 2);
  });
});

test('re-import applies explicit wording edits but plain approval preserves prior edits', () => {
  withProfileRoot((root) => {
    const initial = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\nn\nn\n');
    assert.equal(initial.status, 0, initial.stderr);

    const edited = runCli(root, ['import', 'cv.md', '--review'], 'e\nAcme — Lead Analyst\ne\nDesigned verified dashboards.\nn\nn\n');
    assert.equal(edited.status, 0, edited.stderr);
    let profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(profile.experiences[0].label, 'Acme — Lead Analyst');
    assert.equal(profile.experiences[0].facts[0].text, 'Designed verified dashboards.');

    const approvedAgain = runCli(root, ['import', 'cv.md', '--review'], 'y\ny\nn\nn\n');
    assert.equal(approvedAgain.status, 0, approvedAgain.stderr);
    profile = yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
    assert.equal(profile.experiences[0].label, 'Acme — Lead Analyst');
    assert.equal(profile.experiences[0].facts[0].text, 'Designed verified dashboards.');
  });
});

test('an import with nothing approved does not read the existing profile', () => {
  withProfileRoot((root) => {
    const profilePath = join(root, 'data', 'career-profile.yml');
    const invalid = 'schema_version: 2\ncandidate: {}\n';
    writeFileSync(profilePath, invalid);
    const result = runCli(root, ['import', 'cv.md', '--review'], 'n\nn\nn\n');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No approved items; profile was not changed\./);
    assert.equal(readFileSync(profilePath, 'utf8'), invalid);
  });
});

test('a failed save removes its temporary file and reports the original error', () => {
  withProfileRoot((root) => {
    // Launcher: make the final rename fail after the temporary file is written, then run the CLI.
    const launcher = join(root, 'fail-rename.mjs');
    writeFileSync(launcher, [
      "import fs from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'const realRename = fs.renameSync;',
      'fs.renameSync = (from, to) => {',
      "  if (String(from).endsWith('career-profile.yml.tmp')) throw new Error('simulated rename failure');",
      '  return realRename(from, to);',
      '};',
      'syncBuiltinESMExports();',
      `await import(${JSON.stringify(pathToFileURL(CLI).href)});`,
    ].join('\n'));
    const result = spawnSync(process.execPath, [launcher, 'import', 'cv.md', '--review'], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      encoding: 'utf8', input: 'y\ny\ny\ny\n', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /simulated rename failure/);
    const profilePath = join(root, 'data', 'career-profile.yml');
    assert.equal(existsSync(`${profilePath}.tmp`), false, 'temporary file is removed after a failed save');
    assert.equal(existsSync(profilePath), false);
  });
});

test('profile save waits for a held profile lock before merging and writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-profile-lock-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), `# Candidate\n## Skills\n- SQL\n`);
  const profilePath = join(root, 'data', 'career-profile.yml');
  const lock = await acquirePipelineLock(profilePath, { timeoutMs: 3000, retryMs: 20 });
  let child;
  try {
    child = spawn(process.execPath, [CLI, 'import', 'cv.md', '--review'], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise((resolveExit) => child.once('exit', (code) => {
      exitCode = code;
      resolveExit(code);
    }));
    child.stdin.end('y\ny\n');
    const deadline = Date.now() + 5000;
    while ((stdout.match(/\[y\] approve/g) ?? []).length < 1 && Date.now() < deadline && exitCode === null) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
    assert.equal((stdout.match(/\[y\] approve/g) ?? []).length, 1, `import did not finish review prompt: ${stdout}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    assert.equal(exitCode, null, 'import must wait for the profile lock');

    lock.release();
    const status = await exited;
    assert.equal(status, 0, stderr);
    assert.equal(existsSync(`${profilePath}.lock`), false, 'profile lock is released after the save');
    const profile = yaml.load(readFileSync(profilePath, 'utf8'));
    assert.equal(profile.skills[0].text, 'SQL');
  } finally {
    lock.release();
    if (child && child.exitCode === null) child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
