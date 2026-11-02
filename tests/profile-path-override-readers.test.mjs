// tests/profile-path-override-readers.test.mjs — the core .mjs readers of
// config/profile.yml follow CAREER_OPS_PROFILE, and fall back to the data root, not
// the cwd (#5026). The web app has its own helper and test; the mode prompts
// that tell an agent to read config/profile.yml are outside it.
// batch/batch-runner.sh is covered by tests/batch-runner-profile-override.test.mjs.
//
// tests/profile-path-override.test.mjs pins the resolver and the doctor.mjs
// reproduction. This file runs the REAL modules that used to build the data-root
// path themselves, because "the resolver is correct" says nothing about whether
// each module calls it.
//
// How a module is observed: it runs in a child process with a preload that
// records every profile.yml path the child touches (existsSync / statSync /
// readFileSync / fs.promises, which is how every reader here opens the file).
// The data root holds profile A; CAREER_OPS_PROFILE names profile B; the cwd is
// a third, empty directory. The assertion is on the SET of paths touched:
//   - override set   -> exactly {B}. Any module still on the data-root path adds A.
//   - override unset -> exactly {A}. Any module still on a cwd-relative path
//                       touches the decoy cwd instead of the data root.
// Recording the set, rather than stopping at the first hit, is what catches a
// module that reads the right file at one site and the wrong one at another.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { spawn, spawnSync } from 'child_process';
import { createServer } from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nCAREER_OPS_PROFILE — every reader follows the override (#5026)');

const failOnce = (msg) => { fail(msg); process.exitCode = 1; };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-profile-readers-')));
const dataRoot = join(scratch, 'data-root');
const decoyCwd = join(scratch, 'decoy-cwd');
const explicitRoot = join(scratch, 'explicit-root');
const profileA = join(dataRoot, 'config', 'profile.yml');
const profileB = join(scratch, 'named-profile-B.yml');
const profileE = join(explicitRoot, 'config', 'profile.yml');

for (const dir of [join(dataRoot, 'config'), join(dataRoot, 'data'), join(dataRoot, 'output'), join(dataRoot, 'modes'),
  decoyCwd, join(explicitRoot, 'config'), join(explicitRoot, 'output')]) {
  mkdirSync(dir, { recursive: true });
}
const profileBody = (tag) => `candidate:\n  full_name: ${tag}\n  email: ${tag.toLowerCase()}@example.com\n` +
  `scan:\n  extractor: cli\ntarget_roles:\n  primary:\n    - ${tag.toLowerCase()}-role\n` +
  'compensation:\n  target_range: "100000"\n';
writeFileSync(profileA, profileBody('Alpha'), 'utf-8');
writeFileSync(profileB, profileBody('Bravo'), 'utf-8');
writeFileSync(profileE, profileBody('Echo'), 'utf-8');
writeFileSync(join(dataRoot, 'cv.md'), '# Alpha Person\n\n## Skills\nNode.js\n', 'utf-8');
writeFileSync(join(dataRoot, 'data', 'applications.md'),
  '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n', 'utf-8');
for (const mode of ['_shared.md', '_profile.md', 'oferta.md']) writeFileSync(join(dataRoot, 'modes', mode), '# mode\n', 'utf-8');
writeFileSync(join(dataRoot, 'input.html'), '<html><body><h1>Alpha Person</h1></body></html>', 'utf-8');
writeFileSync(join(dataRoot, 'output', 'applied.pdf'), 'pdf', 'utf-8');
writeFileSync(join(scratch, 'jd.txt'), 'A job description.\n', 'utf-8');
writeFileSync(join(dataRoot, 'batch.json'), JSON.stringify([{ input: 'input.html', output: 'output/batch.pdf' }]), 'utf-8');
writeFileSync(join(scratch, 'payload.json'), JSON.stringify({
  lang: 'en',
  candidate: { name: 'Test Candidate', email: 'test@example.com' },
  summary: 's', competencies: ['Testing'],
  experience: [{ company: 'Test Co', role: 'Engineer', dates: '2026', bullets: ['Built.'] }],
  projects: [], education: [{ title: 'BSc', org: 'U', year: '2025' }],
  certifications: [], skills: [{ category: 'Tools', items: ['Node.js'] }],
}), 'utf-8');

// The preload. Appends one line per profile.yml path a child touches; it never
// changes what the child sees.
const tracer = join(scratch, 'trace-profile-reads.mjs');
writeFileSync(tracer, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const log = process.env.TRACE_LOG;
const append = fs.appendFileSync;
const hit = (p) => {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return;
  const s = String(p);
  if (/(^|[\\\\/])(profile\\.yml|named-profile-B\\.yml)$/.test(s)) append(log, s + '\\n');
};
for (const n of ['readFileSync', 'existsSync', 'statSync', 'openSync', 'accessSync']) {
  const o = fs[n];
  fs[n] = function (p, ...a) { hit(p); return o.call(this, p, ...a); };
}
for (const n of ['readFile', 'access', 'stat']) {
  const o = fs.promises[n];
  fs.promises[n] = function (p, ...a) { hit(p); return o.call(this, p, ...a); };
}
syncBuiltinESMExports();
// The children run with fake provider keys; only loopback may be reached, so a
// reader that gets as far as its provider call fails fast instead of going out.
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, ...a) {
  const url = String(input && input.url ? input.url : input);
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL: blocked below */ }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return Promise.reject(new TypeError('offline test: blocked ' + url));
  return realFetch.call(this, input, ...a);
};
`, 'utf-8');

// ollama-eval probes /api/tags before it loads any context.
const ollama = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
const ollamaUrl = `http://127.0.0.1:${ollama.address().port}`;

let logCounter = 0;
/**
 * Run a module in a child and return the sorted set of profile paths it touched.
 * @param {string[]} argv node arguments after the preload
 * @param {{override: boolean, cwd?: string, dotEnvDir?: string}} opts dotEnvDir: name the
 *   override only in <dotEnvDir>/.env, with the variable absent from the environment
 */
function touched(argv, { override, cwd = decoyCwd, dotEnvDir }) {
  const log = join(scratch, `trace-${++logCounter}.log`);
  writeFileSync(log, '');
  const env = {
    ...process.env,
    TRACE_LOG: log,
    CAREER_OPS_ROOT: dataRoot,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_PROFILE: override ? profileB : '',
    OPENAI_API_KEY: 'unused', GEMINI_API_KEY: 'unused', OPENROUTER_API_KEY: 'unused',
    OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OLLAMA_BASE_URL: ollamaUrl,
    CAREER_OPS_MODEL: 'probe-model',
  };
  // dotenv never overrides a key that is already set, even to an empty string.
  if (dotEnvDir) delete env.CAREER_OPS_PROFILE;
  const dotEnvFile = dotEnvDir ? join(dotEnvDir, '.env') : null;
  if (dotEnvFile) writeFileSync(dotEnvFile, `CAREER_OPS_PROFILE=${profileB}\n`, 'utf-8');
  return new Promise((resolveRun) => {
    const child = spawn(NODE, ['--import', pathToFileURL(tracer).href, ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (dotEnvFile) rmSync(dotEnvFile, { force: true });
      const paths = [...new Set(readFileSync(log, 'utf-8').split('\n').filter(Boolean))].sort();
      resolveRun({ paths, code, out });
    });
  });
}

const module = (file) => pathToFileURL(join(ROOT, file)).href;
const inline = (code) => ['--input-type=module', '-e', code];
const cli = (file, ...args) => [join(ROOT, file), ...args];

// [class, label, argv]
const SUBJECTS = [
  // 1. evaluators that read the profile into a prompt
  ['evaluators', 'gemini-eval.mjs', cli('gemini-eval.mjs', '--file', join(scratch, 'jd.txt'))],
  ['evaluators', 'ollama-eval.mjs', cli('ollama-eval.mjs', '--file', join(scratch, 'jd.txt'), '--no-save')],
  ['evaluators', 'openai-eval.mjs', cli('openai-eval.mjs', '--file', join(scratch, 'jd.txt'))],
  ['evaluators', 'openai-tailor.mjs', cli('openai-tailor.mjs', '--jd', join(scratch, 'jd.txt'), '--report', join(scratch, 'jd.txt'))],
  ['evaluators', 'batch-evaluate-gemini.mjs', cli('batch-evaluate-gemini.mjs')],
  ['evaluators', 'openrouter-runner.mjs', cli('openrouter-runner.mjs', 'evaluate', 'http://127.0.0.1:9/posting')],
  // 2. pdf / cv builders
  ['builders', 'generate-pdf.mjs (single document)', cli('generate-pdf.mjs', join(dataRoot, 'input.html'), join(dataRoot, 'output', 'single.pdf'))],
  ['builders', 'generate-pdf.mjs (--batch)', cli('generate-pdf.mjs', `--batch=${join(dataRoot, 'batch.json')}`)],
  ['builders', 'generate-pdf.mjs (injectPrintPageCss, no format)', inline(`const m = await import(${JSON.stringify(module('generate-pdf.mjs'))}); m.injectPrintPageCss('<html><head></head><body></body></html>');`)],
  ['builders', 'build-cv-html.mjs', cli('build-cv-html.mjs', join(scratch, 'payload.json'), join(scratch, 'out.html'))],
  ['builders', 'theme-style.mjs (default arguments)', inline(`const m = await import(${JSON.stringify(module('theme-style.mjs'))}); m.readStyleTokens(); m.readCvSectionOrder();`)],
  ['builders', 'prepare-application.mjs', cli('prepare-application.mjs', '--url', 'https://jobs.lever.co/acme/abc123', '--pdf', join(dataRoot, 'output', 'applied.pdf'))],
  ['builders', 'cv-sync-check.mjs', cli('cv-sync-check.mjs')],
  // 3. analyzers
  ['analyzers', 'salary-gap.mjs', cli('salary-gap.mjs')],
  ['analyzers', 'upskill.mjs', cli('upskill.mjs', '--url-text', join(scratch, 'jd.txt'))],
  ['analyzers', 'check-table-freshness.mjs', cli('check-table-freshness.mjs')],
  // 0. the modules that already honored the override, now routed through the resolver
  ['resolver users', 'cv-templates.mjs', inline(`const m = await import(${JSON.stringify(module('cv-templates.mjs'))}); m.loadProfileDefault('cv');`)],
  ['resolver users', 'validate-profile.mjs', cli('validate-profile.mjs')],
  ['resolver users', 'github-evidence.mjs', cli('github-evidence.mjs')],
  ['resolver users', 'scan.mjs (country, re-apply windows)', inline(`const m = await import(${JSON.stringify(module('scan.mjs'))}); m.loadCandidateCountry(); m.loadReApplyWindows();`)],
  ['resolver users', 'followup-cadence.mjs', cli('followup-cadence.mjs')],
  ['resolver users', 'rejection-latency.mjs', cli('rejection-latency.mjs', '--summary')],
  ['resolver users', 'company-history.mjs (resolveRegion)', inline(`const m = await import(${JSON.stringify(module('company-history.mjs'))}); m.resolveRegion();`)],
  // 5. provider / script fallbacks
  ['fallbacks', 'providers/_profile-keywords.mjs', inline(`const m = await import(${JSON.stringify(module('providers/_profile-keywords.mjs'))}); m.resolveProfileKeywords();`)],
  ['fallbacks', 'scripts/export-ats-text.mjs', cli('scripts/export-ats-text.mjs')],
  ['fallbacks', 'browser-extract.mjs (default argument)', inline(`const m = await import(${JSON.stringify(module('browser-extract.mjs'))}); m.resolveExtractorMode();`)],
];

try {
  for (const [group, label, argv] of SUBJECTS) {
    const named = await touched(argv, { override: true });
    named.paths.length === 1 && named.paths[0] === profileB
      ? pass(`${group}: ${label} reads the profile CAREER_OPS_PROFILE names, and only that one`)
      : failOnce(`${group}: ${label} touched ${JSON.stringify(named.paths.map((p) => p.replace(scratch, '<scratch>')))} with the override set; expected only <scratch>/named-profile-B.yml (exit ${named.code})`);

    const fallback = await touched(argv, { override: false });
    fallback.paths.length === 1 && fallback.paths[0] === profileA
      ? pass(`${group}: ${label} falls back to the data root profile when the override is unset`)
      : failOnce(`${group}: ${label} touched ${JSON.stringify(fallback.paths.map((p) => p.replace(scratch, '<scratch>')))} with the override unset; expected only <scratch>/data-root/config/profile.yml (exit ${fallback.code})`);
  }

  // An override named only in a .env reaches the readers that load one: scan.mjs from
  // the data root, the evaluators and openai-tailor.mjs from the working directory.
  // The cases above export the variable, so they cannot see a regression in that
  // loading order. (openrouter-runner.mjs loads the code root's .env, which a test
  // must not write to, so it is covered by the exported-variable case above.)
  const bySubject = new Map(SUBJECTS.map(([, label, argv]) => [label, argv]));
  for (const [label, dotEnvDir] of [
    ['scan.mjs (country, re-apply windows)', dataRoot],
    ['gemini-eval.mjs', decoyCwd],
    ['ollama-eval.mjs', decoyCwd],
    ['openai-eval.mjs', decoyCwd],
    ['openai-tailor.mjs', decoyCwd],
    ['batch-evaluate-gemini.mjs', decoyCwd],
  ]) {
    const fromEnv = await touched(bySubject.get(label), { override: false, dotEnvDir });
    fromEnv.paths.length === 1 && fromEnv.paths[0] === profileB
      ? pass(`.env: ${label} reads the profile a .env names, with the variable not exported`)
      : failOnce(`.env: ${label} touched ${JSON.stringify(fromEnv.paths.map((p) => p.replace(scratch, '<scratch>')))} when only ${dotEnvDir.replace(scratch, '<scratch>')}/.env names the profile; expected only <scratch>/named-profile-B.yml (exit ${fromEnv.code})`);
  }

  // The preload's fetch guard is what keeps the evaluator children offline.
  const blocked = await touched(inline("try { await fetch('https://example.com/'); console.log('REACHED'); } catch (e) { console.log(String(e.message)); }"), { override: false });
  /offline test: blocked https:\/\/example\.com/.test(blocked.out) && !/REACHED/.test(blocked.out)
    ? pass('the test preload blocks a request to a non-loopback host')
    : failOnce(`the test preload let a non-loopback request through: ${blocked.out.slice(0, 120)}`);

  // generate-pdf's renderHtmlToPdf: a caller that names its own workspace has said
  // which profile it means, so the override does not redirect it; a caller that
  // names none renders in the default workspace, where the override applies.
  // The profile is read before the page opens, so the browser here only has to get
  // that far: it stops at newPage(), which keeps the check independent of whether a
  // Chromium is installed (CI's test job has none).
  const render = (workspaceRootArg) => inline(`
    const { renderHtmlToPdf } = await import(${JSON.stringify(module('generate-pdf.mjs'))});
    const launchBrowser = async () => ({
      newPage: async () => { throw new Error('probe: stopped at newPage()'); },
      close: async () => {},
    });
    await renderHtmlToPdf('<html><body><h1>Probe</h1></body></html>', ${JSON.stringify(join(workspaceRootArg ?? dataRoot, 'output', 'render-probe.pdf'))},
      { launchBrowser${workspaceRootArg ? `, workspaceRoot: ${JSON.stringify(workspaceRootArg)}` : ''} });
  `);
  const explicit = await touched(render(explicitRoot), { override: true });
  explicit.paths.length === 1 && explicit.paths[0] === profileE
    ? pass('builders: renderHtmlToPdf with an explicit workspaceRoot reads that workspace profile, not the override')
    : failOnce(`builders: renderHtmlToPdf({workspaceRoot}) touched ${JSON.stringify(explicit.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/explicit-root/config/profile.yml (exit ${explicit.code})`);
  const defaulted = await touched(render(null), { override: true });
  defaulted.paths.length === 1 && defaulted.paths[0] === profileB
    ? pass('builders: renderHtmlToPdf with no workspaceRoot reads the profile CAREER_OPS_PROFILE names')
    : failOnce(`builders: renderHtmlToPdf() touched ${JSON.stringify(defaulted.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/named-profile-B.yml (exit ${defaulted.code})`);

  // 4. update-system: the template variants the updater preserves are the ones the
  // profile in force selects. snapshotConfiguredTemplateVariants() takes a data
  // root (tests and apply() both pass one) and an optional profilePath that names
  // the file outright.
  const snapshot = (profilePathArg) => inline(`
    const { snapshotConfiguredTemplateVariants } = await import(${JSON.stringify(module('update-system.mjs'))});
    await snapshotConfiguredTemplateVariants({ dataRoot: ${JSON.stringify(dataRoot)}${profilePathArg ? `, profilePath: ${JSON.stringify(profilePathArg)}` : ''} });
  `);
  const fromRoot = await touched(snapshot(null), { override: true });
  fromRoot.paths.length === 1 && fromRoot.paths[0] === profileA
    ? pass('updater: snapshotConfiguredTemplateVariants({dataRoot}) reads that root, not the override')
    : failOnce(`updater: snapshot with an explicit dataRoot touched ${JSON.stringify(fromRoot.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/data-root/config/profile.yml (exit ${fromRoot.code})`);
  const named = await touched(snapshot(profileB), { override: false });
  named.paths.length === 1 && named.paths[0] === profileB
    ? pass('updater: snapshotConfiguredTemplateVariants({profilePath}) reads the profile it is given')
    : failOnce(`updater: snapshot with a profilePath touched ${JSON.stringify(named.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/named-profile-B.yml (exit ${named.code})`);

  // 5b. export-ats-text takes its profile and its CV from the same place. Run from
  // a directory that is not the data root, the profile used to fail closed (cwd
  // relative) while moving only the profile to the data root left the CV on the
  // cwd, which exits 0 with the experience section silently empty.
  const cvRoot = join(scratch, 'cv-root');
  mkdirSync(join(cvRoot, 'config'), { recursive: true });
  writeFileSync(join(cvRoot, 'config', 'profile.yml'), profileBody('Delta'), 'utf-8');
  writeFileSync(join(cvRoot, 'cv.md'),
    '# CV -- Delta Person\n\n## Work Experience\n\n### Acme Widgets -- Austin, TX\n\n**Staff Engineer**\n2020-2024\n\n- Built the widget pipeline\n', 'utf-8');
  const ats = spawnSync(NODE, [join(ROOT, 'scripts', 'export-ats-text.mjs'), '--section', 'experience'], {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: cvRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '', CAREER_OPS_CV: '' },
  });
  ats.status === 0 && /Acme Widgets/.test(ats.stdout)
    ? pass('fallbacks: scripts/export-ats-text.mjs reads cv.md from the data root along with the profile, from any cwd')
    : failOnce(`fallbacks: scripts/export-ats-text.mjs run outside the data root exited ${ats.status} and printed ${JSON.stringify(ats.stdout.slice(0, 120))} without the CV's experience (stderr: ${JSON.stringify(ats.stderr.slice(0, 120))})`);

  // 5c. export-ats-text names the file it looked for, and its help text says where
  // the defaults live. "config/profile.yml not found" is a lie about a typo'd
  // CAREER_OPS_PROFILE, and "config/profile.yml" in --help hides the data root.
  const typo = join(scratch, 'ats-typo-profile.yml');
  const atsMissing = spawnSync(NODE, [join(ROOT, 'scripts', 'export-ats-text.mjs')], {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: cvRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: typo },
  });
  const atsMissingOut = `${atsMissing.stdout}${atsMissing.stderr}`;
  atsMissing.status !== 0 && atsMissingOut.includes(typo) && /CAREER_OPS_PROFILE/.test(atsMissingOut)
    ? pass('fallbacks: scripts/export-ats-text.mjs names CAREER_OPS_PROFILE and the file it looked for when that file is missing')
    : failOnce(`fallbacks: scripts/export-ats-text.mjs gave ${JSON.stringify(atsMissingOut.slice(0, 200))} for a missing override target (exit ${atsMissing.status})`);
  const atsHelp = spawnSync(NODE, [join(ROOT, 'scripts', 'export-ats-text.mjs'), '--help'], { cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000 });
  /--profile[^\n]*data root/i.test(atsHelp.stdout) && /--cv[^\n]*data root/i.test(atsHelp.stdout)
    ? pass('fallbacks: scripts/export-ats-text.mjs --help says the profile and CV defaults live in the data root')
    : failOnce(`fallbacks: scripts/export-ats-text.mjs --help does not mention the data root for --profile and --cv: ${JSON.stringify(atsHelp.stdout.slice(0, 400))}`);

  // 3b. generate-pdf renders in the tracker workspace, which CAREER_OPS_TRACKER can
  // move off the data root. With no override it reads that workspace's profile; an
  // override that is set wins even when it names the data-root profile itself, so
  // "is an override set" cannot be inferred by comparing paths.
  const pdfRoot = join(scratch, 'pdf-data-root');
  const pdfWorkspace = join(scratch, 'pdf-workspace');
  for (const dir of [join(pdfRoot, 'config'), join(pdfWorkspace, 'config'), join(pdfWorkspace, 'data')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(pdfRoot, 'config', 'profile.yml'), 'page_format: a4\n', 'utf-8');
  writeFileSync(join(pdfWorkspace, 'config', 'profile.yml'), 'page_format: letter\n', 'utf-8');
  writeFileSync(join(pdfWorkspace, 'data', 'applications.md'), '# Applications Tracker\n', 'utf-8');
  const sheetFor = (profileEnv) => spawnSync(NODE, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(module('generate-pdf.mjs'))}); console.log(m.injectPrintPageCss('<html><head></head><body></body></html>'));`], {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: pdfRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: join(pdfWorkspace, 'data', 'applications.md'), CAREER_OPS_PROFILE: profileEnv },
  }).stdout;
  const pageSize = (css) => (css.match(/size:\s*(A4|Letter)/i) || [])[1];
  const unsetSheet = pageSize(sheetFor(''));
  const namingDataRoot = pageSize(sheetFor(join(pdfRoot, 'config', 'profile.yml')));
  unsetSheet === 'Letter'
    ? pass('builders: generate-pdf with no override reads the tracker workspace profile')
    : failOnce(`builders: generate-pdf with no override used sheet ${unsetSheet}, expected Letter from the tracker workspace profile`);
  namingDataRoot === 'A4'
    ? pass('builders: generate-pdf honors an override that names the data-root profile itself')
    : failOnce(`builders: generate-pdf ignored CAREER_OPS_PROFILE naming the data-root profile: sheet ${namingDataRoot}, expected A4`);

  // 4b. apply() is not exported, so, as updater-apply-target-verification.test.mjs
  // does for the properties that only exist in its body, the wiring is asserted on
  // its source: apply() must hand the snapshot BOTH the profile in force
  // (getProfilePath()) and the data root's own. The templates directory is the data
  // root's, so reading only one profile leaves the other's variants unprotected.
  const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const takesProfile = /profilePaths = \[getProfilePath\(\), getProfilePath\(dataRoot\)\];/.test(updaterSource);
  const callAt = updaterSource.indexOf('await snapshotConfiguredTemplateVariantsAcrossProfiles({');
  const snapshotCall = callAt === -1 ? null : [updaterSource.slice(callAt, updaterSource.indexOf('readRemoteContent', callAt))];
  takesProfile && snapshotCall && /\bprofilePaths,/.test(snapshotCall[0])
    ? pass('updater: apply() hands both the override profile and the data-root profile to the template-variant snapshot (source check)')
    : failOnce(`updater: apply() does not pass [getProfilePath(), getProfilePath(dataRoot)] into the snapshot (takesProfile=${takesProfile}, call=${snapshotCall ? 'found' : 'missing'})`);

  // 4c. The self-reexec child runs with the checkout as its cwd, so a relative
  // CAREER_OPS_PROFILE would name a different file there than in the user's shell.
  // The parent resolves it and hands the child the absolute path.
  const reexecEnvFor = (profile) => JSON.parse(spawnSync(NODE, inline(
    `const { reexecProfileEnv } = await import(${JSON.stringify(module('update-system.mjs'))}); console.log(JSON.stringify(await reexecProfileEnv()));`), {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: profile },
  }).stdout);
  const relEnv = reexecEnvFor('profiles/me.yml');
  relEnv.CAREER_OPS_PROFILE === join(decoyCwd, 'profiles', 'me.yml') && Object.keys(reexecEnvFor('')).length === 0
    ? pass('updater: the self-reexec child gets a relative CAREER_OPS_PROFILE resolved against the parent\'s cwd, and nothing when it is unset')
    : failOnce(`updater: reexecProfileEnv() gave ${JSON.stringify(relEnv)} for a relative override from ${decoyCwd}`);
  /\.\.\.process\.env,\s*\.\.\.await reexecProfileEnv\(\),/.test(updaterSource)
    ? pass('updater: apply() spreads reexecProfileEnv() into the self-reexec child env after process.env (source check)')
    : failOnce('updater: the self-reexec child env does not spread reexecProfileEnv() after process.env');

  // 4d. The skip warning for a profile the update cannot parse is printed by apply().
  // Deleting the print leaves the skip silent, and nothing else would notice.
  /for \(const warning of configuredSnapshot\.warnings\) console\.log\(/.test(updaterSource)
    ? pass('updater: apply() prints the snapshot warnings (source check)')
    : failOnce('updater: apply() no longer prints configuredSnapshot.warnings');

  // 4e. Doctor's .env warning has to be true at this change: the evaluators follow
  // CAREER_OPS_PROFILE now, after their working-directory config(), so it names them
  // beside scan.mjs as the commands that load a .env for the profile.
  const envWarnRoot = join(scratch, 'env-warn-root');
  mkdirSync(join(envWarnRoot, 'config'), { recursive: true });
  writeFileSync(join(envWarnRoot, 'config', 'profile.yml'), profileBody('Root'), 'utf-8');
  writeFileSync(join(envWarnRoot, '.env'), `CAREER_OPS_PROFILE=${profileB}\n`, 'utf-8');
  const envWarnRun = spawnSync(NODE, [join(ROOT, 'doctor.mjs'), '--json'], {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: envWarnRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' },
  });
  const envWarning = (JSON.parse(envWarnRun.stdout).warnings.find((w) => /\.env sets CAREER_OPS_PROFILE/.test(w))) ?? '';
  /only scan\.mjs, the evaluators, openai-tailor\.mjs and openrouter-runner\.mjs load \.env/.test(envWarning)
    ? pass('doctor: the .env warning names scan.mjs, the evaluators, openai-tailor.mjs and openrouter-runner.mjs as the .env loaders')
    : failOnce(`doctor: the .env warning is not true at this change: ${JSON.stringify(envWarning.slice(0, 160))}`);

  // 3c. cv-sync-check's advice for a missing profile. With an override that names a
  // file that is not there, "copy the example into config/profile.yml" changes
  // nothing; the message has to name the variable and the path it points at.
  const missingNamed = join(scratch, 'typo-profile.yml');
  const sync = spawnSync(NODE, [join(ROOT, 'cv-sync-check.mjs')], {
    cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: missingNamed },
  });
  const syncOut = `${sync.stdout}${sync.stderr}`;
  /CAREER_OPS_PROFILE/.test(syncOut) && syncOut.includes(missingNamed)
    ? pass('builders: cv-sync-check names CAREER_OPS_PROFILE and its target when that file is missing')
    : failOnce(`builders: cv-sync-check did not name CAREER_OPS_PROFILE and ${missingNamed} for a missing override target: ${JSON.stringify(syncOut.slice(0, 200))}`);
} catch (e) {
  failOnce(`profile-path readers suite crashed: ${e.stack || e.message}`);
} finally {
  ollama.close();
  rmSync(scratch, { recursive: true, force: true });
}
