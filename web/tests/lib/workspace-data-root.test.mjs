import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as yaml from 'js-yaml';

const webSrc = fileURLToPath(new URL('../../src/', import.meta.url));
const coreRoot = fileURLToPath(new URL('../../../', import.meta.url));
// The same test-only alias loader used by apply-cv-resolver.test.mjs.
register('data:text/javascript,' + encodeURIComponent(`
  import fs from 'node:fs';
  import path from 'node:path';
  import { pathToFileURL } from 'node:url';
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.mts', '']) {
        if (fs.existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`), pathToFileURL(webSrc));

const data = await import('../../src/lib/career-ops.ts');
const { POST: saveProfile } = await import('../../src/app/api/profile/route.ts');
const { POST: savePortals } = await import('../../src/app/api/portals/route.ts');
const { readCanonicalStates } = await import('../../src/lib/core/states.ts');
const { getNormalizeTextKey } = await import('../../src/lib/core/text-key.ts');
const { resolvePdfIndexPath } = await import('../../src/lib/core/pdf-index.ts');
const { withTrackerLock } = await import('../../src/lib/core/tracker-lock.ts');
const { withFollowupsLock } = await import('../../src/lib/core/followups-lock.ts');
const { POST: runAgent } = await import('../../src/app/api/run/route.ts');
const { renderAndMarkPdf } = await import('../../src/lib/pdf-render.mjs');

function put(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function request(body) {
  return new Request('http://localhost/api/test', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

// These tests mutate cwd/env only inside this node:test worker. Subtests are
// awaited serially, and every value is restored even when an assertion fails.
test('a separate Data Root retains the pipeline and access to its core', async (t) => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'co-web-data-')));
  const code = path.join(sandbox, 'checkout');
  const user = path.join(sandbox, 'user data');
  const oldCwd = process.cwd();
  const envKeys = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PDF_INDEX', 'PATH'];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    fs.mkdirSync(path.join(code, 'web'), { recursive: true });
    put(code, 'cv.md', '# Wrong workspace\n');
    put(code, 'tracker-aliases.json', fs.readFileSync(path.join(coreRoot, 'tracker-aliases.json')));
    put(code, 'templates/states.yml', fs.readFileSync(path.join(coreRoot, 'templates/states.yml')));
    put(code, 'modes/de/angebot.md', '# Evaluation A-F\n');
    put(code, 'config/profile.example.yml', 'language:\n  output: en\ncandidate:\n  full_name: Template Person\n');
    put(code, 'templates/portals.example.yml', 'tracked_companies:\n  - name: Fixture Employer\n    ats: greenhouse\n    board: fixture\n');
    put(code, 'doctor.mjs', 'process.stdout.write("core-script-ran");\n');
    // Exercise the real core in an isolated checkout. Web CI installs only
    // web/node_modules, so copy the dependency closure and its own YAML package
    // rather than importing back into a root checkout with missing dependencies.
    for (const relative of ['set-status.mjs', 'tracker-utils.mjs', 'tracker-parse.mjs',
      'path-resolver.mjs', 'pipeline-lock.mjs', 'role-matcher.mjs', 'followup-seed.mjs',
      'followup-cadence.mjs', 'lib/local-today.mjs', 'lib/cli-flags.mjs', 'lib/is-main-module.mjs']) {
      put(code, relative, fs.readFileSync(path.join(coreRoot, relative)));
    }
    fs.cpSync(new URL('../../node_modules/js-yaml', import.meta.url), path.join(code, 'node_modules/js-yaml'), { recursive: true });
    put(user, 'cv.md', '# Synthetic Candidate\n');
    put(user, 'config/profile.yml', 'language:\n  output: en\n  modes_dir: modes/de\n');
    put(user, 'modes/_profile.md', '# Targeting\n');
    put(user, 'portals.yml', 'tracked_companies: []\n');
    // Reordered columns require tracker-aliases.json from the code checkout.
    put(user, 'data/applications.md', '| Company | # | Date | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| Fixture Employer | 7 | 2026-01-02 | Engineer | 4.2/5 | Applied | - | [7](../reports/007-fixture.md) | Synthetic |\n');
    put(user, 'data/pipeline.md', '- [ ] https://example.test/jobs/8 | Second Employer | Engineer\n');
    put(user, 'data/scan-history.tsv', 'url\tfirst_seen\nhttps://example.test/jobs/8\t2026-01-03\n');
    put(user, 'reports/007-fixture.md', '# Fixture report\n');
    for (const key of envKeys.filter((key) => key !== 'PATH')) delete process.env[key];
    process.env.CAREER_OPS_DATA_DIR = user;
    process.chdir(path.join(code, 'web'));

    await t.test('setup, analytics rows, report links and market mode use their intended roots', () => {
      assert.equal(data.careerOpsRoot(), user);
      assert.equal(data.careerOpsCodeRoot(), code);
      assert.deepEqual(data.doctorState(), { phase: 'established', onboardingNeeded: false, missing: [], hasCv: true, hasData: true });
      const summary = data.pipelineSummary();
      assert.equal(summary.root, user);
      assert.equal(summary.applications.length, 1);
      assert.equal(summary.applications[0].company, 'Fixture Employer');
      assert.equal(summary.applications[0].n, '7');
      assert.equal(summary.applications[0].status, 'Applied');
      assert.equal(summary.inbox[0].postedAt, '2026-01-03');
      assert.equal(data.findReportFile('7'), path.join(user, 'reports/007-fixture.md'));
      assert.equal(data.readLanguageConfig().evalModeFile, 'modes/de/angebot.md');
    });

    await t.test('scripts, canonical states, matching, manifest and real locks remain available', async () => {
      assert.equal(data.rootScript('doctor'), path.join(code, 'doctor.mjs'));
      assert.equal(execFileSync(process.execPath, [data.rootScript('doctor')], { encoding: 'utf8' }), 'core-script-ran');
      assert.ok(readCanonicalStates().some((state) => state.aliases.length > 0));
      const { normalizeTextKey } = await import(pathToFileURL(path.join(code, 'tracker-parse.mjs')).href);
      assert.equal(await getNormalizeTextKey(), normalizeTextKey);
      assert.equal(await resolvePdfIndexPath(), path.join(user, 'data/pdf-index.tsv'));
      const tracker = path.join(user, 'data/applications.md');
      await withTrackerLock(tracker, () => assert.ok(fs.existsSync(tracker)));
      await withFollowupsLock(path.join(user, 'data/follow-ups.md'), () => 'read under lock');
    });

    await t.test('the real status writer changes the displayed tracker, including its transition ledger', () => {
      const tracker = path.join(user, 'data/applications.md');
      const before = fs.readFileSync(tracker, 'utf8');
      const codeTracker = path.join(code, 'data/applications.md');
      const codeBefore = before.replace('Fixture Employer', 'Code Decoy');
      put(code, 'data/applications.md', codeBefore);
      // The real writer still defaults to its code root on older core versions.
      // Its explicit tracker override must match the file the web just read.
      const output = execFileSync(process.execPath, [data.rootScript('set-status'), '7', 'Rejected', '--json'], {
        cwd: user, env: data.careerOpsEnv(), encoding: 'utf8', timeout: 10_000,
      });
      const result = JSON.parse(output);
      assert.equal(result.company, 'Fixture Employer');
      assert.equal(result.tracker, tracker);
      assert.equal(result.newStatus, 'Rejected');
      assert.equal(data.readApplications()[0].status, 'Rejected');
      const ledger = fs.readFileSync(path.join(user, 'data/status-log.tsv'), 'utf8');
      assert.match(ledger, /7\t[^\t]+\tApplied\tRejected\t/);
      assert.equal(fs.readFileSync(codeTracker, 'utf8'), codeBefore);
      assert.equal(fs.existsSync(path.join(code, 'data/status-log.tsv')), false);
      fs.writeFileSync(tracker, before);
    });

    await t.test('AI runs reject a data-only workspace before starting a CLI', async () => {
      const bin = path.join(sandbox, 'bin');
      // A fake executable is first on PATH, so a broken guard cannot start a
      // developer's installed AI CLI. It is never expected to execute.
      put(bin, 'claude', '#!/bin/sh\nexit 99\n');
      fs.chmodSync(path.join(bin, 'claude'), 0o755);
      process.env.PATH = bin;
      for (const kind of ['evaluate', 'pdf', 'fix-portal']) {
        const response = await runAgent(request({ kind, input: '7', cliId: 'claude' }));
        assert.equal(response.status, 400, kind);
        assert.match((await response.json()).error, /complete career-ops checkout/, kind);
      }
      if (oldEnv.PATH === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnv.PATH;
    });

    await t.test('profile and portal creation seed from core and write only to the Data Root', async () => {
      fs.unlinkSync(path.join(user, 'config/profile.yml'));
      fs.unlinkSync(path.join(user, 'portals.yml'));
      const template = fs.readFileSync(path.join(code, 'config/profile.example.yml'), 'utf8');
      const profile = await saveProfile(request({ name: 'Synthetic Candidate' }));
      assert.equal(profile.status, 200);
      assert.deepEqual(await profile.json(), { ok: true, seeded: true });
      const saved = yaml.load(fs.readFileSync(path.join(user, 'config/profile.yml'), 'utf8'));
      assert.equal(saved.candidate.full_name, 'Synthetic Candidate');
      assert.equal(saved.language.output, 'en');
      const portals = await savePortals(request({ roles: ['Engineer'] }));
      assert.equal(portals.status, 200);
      const portalDoc = yaml.load(fs.readFileSync(path.join(user, 'portals.yml'), 'utf8'));
      assert.equal(portalDoc.tracked_companies[0].name, 'Fixture Employer');
      assert.deepEqual(portalDoc.title_filter.positive, ['Engineer']);
      assert.equal(fs.existsSync(path.join(code, 'config/profile.yml')), false);
      assert.equal(fs.existsSync(path.join(code, 'portals.yml')), false);
      assert.equal(fs.readFileSync(path.join(code, 'config/profile.example.yml'), 'utf8'), template);
    });

    await t.test('malformed user configuration is preserved and a code-root CV cannot fill a missing user CV', async () => {
      const broken = 'candidate: [\n';
      put(user, 'config/profile.yml', broken);
      const response = await saveProfile(request({ name: 'Should Not Be Written' }));
      assert.equal(response.status, 409);
      assert.equal(fs.readFileSync(path.join(user, 'config/profile.yml'), 'utf8'), broken);
      fs.unlinkSync(path.join(user, 'cv.md'));
      assert.equal(data.doctorState().hasCv, false);
      assert.ok(data.doctorState().missing.includes('cv.md'));
      assert.equal(fs.readFileSync(path.join(code, 'cv.md'), 'utf8'), '# Wrong workspace\n');
    });

    await t.test('marker and relative DATA_DIR select the same existing pipeline', () => {
      process.env.CAREER_OPS_DATA_DIR = '../user data';
      assert.equal(data.readApplications()[0].n, '7');
      assert.equal(data.careerOpsEnv().CAREER_OPS_ROOT, user);
      delete process.env.CAREER_OPS_DATA_DIR;
      put(code, '.career-ops-data', '../user data\n');
      assert.equal(data.readApplications()[0].n, '7');
      assert.equal(data.careerOpsCodeRoot(), code);
    });

    await t.test('legacy relative ROOT retains its own core and hands children an absolute root', () => {
      process.env.CAREER_OPS_ROOT = '../user data';
      process.env.CAREER_OPS_DATA_DIR = code;
      process.env.CAREER_OPS_TRACKER = 'explicit-tracker.md';
      assert.equal(data.careerOpsCodeRoot(), user);
      assert.equal(data.careerOpsRoot(), user);
      const childEnv = data.careerOpsEnv();
      assert.equal(childEnv.CAREER_OPS_ROOT, user);
      assert.equal(childEnv.CAREER_OPS_TRACKER, 'explicit-tracker.md');
      assert.equal(process.env.CAREER_OPS_ROOT, '../user data');
    });

    await t.test('an invalid marker reaches readers as an error, without a first-run fallback', () => {
      delete process.env.CAREER_OPS_ROOT;
      delete process.env.CAREER_OPS_DATA_DIR;
      fs.unlinkSync(path.join(code, '.career-ops-data'));
      fs.mkdirSync(path.join(code, '.career-ops-data'));
      for (const reader of [data.doctorState, data.readApplications, data.readInbox, data.readMemory]) {
        assert.throws(reader, { code: 'EISDIR' });
      }
    });
  } finally {
    process.chdir(oldCwd);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('both PDF subprocesses receive the normalized workspace environment', async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'co-web-pdf-env-')));
  try {
    const script = 'if (process.env.CAREER_OPS_ROOT !== process.cwd()) process.exit(23); process.stdout.write(JSON.stringify({ok: true}));';
    put(scratch, 'generate-pdf.mjs', script);
    put(scratch, 'mark-pdf-ready.mjs', script);
    const { spawn } = await import('node:child_process');
    const result = await renderAndMarkPdf({
      spawnFn: spawn, execPath: process.execPath, root: scratch,
      env: { ...process.env, CAREER_OPS_ROOT: scratch },
      pdfPaths: { html: path.join(scratch, 'cv-web-007.html'), finalPdf: path.join(scratch, 'out.pdf') },
      format: 'letter', reportNum: '007',
    });
    assert.deepEqual(result, { kind: 'rendered', warnings: [] });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
