// tests/required-tools-declared.test.mjs — every suite that launches a real
// Chromium is one `test-all.mjs --needs browser` selects (#5758).
//
// The tool-suites CI job runs the browser suites with the browser required, so a
// missing Chromium fails there instead of skipping. It finds them by the
// declaration in tests/required-tools.mjs, not by a list. A new suite that
// launches Chromium and skips its own way (a bare warn(), a node:test `skip`)
// would never be selected, and its check would again run on no CI job; this
// suite fails instead, naming it.
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pass, fail, ROOT, NODE, stripJsComments } from './helpers.mjs';
import { listTree } from '../lib/walk-tree.mjs';
import { REQUIRED_TOOL_ENV, declaresTool } from './required-tools.mjs';

console.log('\nrequired tools — browser suites are selected by --needs browser (#5758)');

const TESTS_DIR = join(ROOT, 'tests');

// Suites that launch Chromium on purpose where none can start: the launch is
// the thing under test, so there is nothing to require.
const EXEMPT = new Map([
  ['doctor-chromium-launch-error.test.mjs', 'launches against an empty PLAYWRIGHT_BROWSERS_PATH to read the error doctor reports'],
]);

const LAUNCHES_CHROMIUM = /\bchromium\.(?:launch|executablePath)\s*\(/;

const rel = (f) => f.slice(TESTS_DIR.length + 1).replace(/\\/g, '/');
const suites = listTree(TESTS_DIR, { match: /\.test\.mjs$/ })
  // The Playwright visual suite runs in its own job, which always has a browser.
  .filter((f) => !rel(f).startsWith('cv-visual/'));

let selected = 0;
for (const f of suites) {
  const name = rel(f);
  const src = stripJsComments(readFileSync(f, 'utf-8'));
  if (!LAUNCHES_CHROMIUM.test(src) || EXEMPT.has(name)) continue;
  if (declaresTool(src, 'browser')) {
    selected++;
    pass(`${name} launches Chromium and declares the browser`);
  } else fail(`${name} launches Chromium but never calls toolRequired('browser') or toolUnavailable('browser', …), so the tool-suites job's --needs browser run skips it and its check runs on no CI job — see tests/required-tools.mjs`);
}
for (const [name] of EXEMPT) {
  if (suites.some((f) => rel(f) === name)) continue;
  fail(`EXEMPT lists ${name}, which no longer exists — drop the entry`);
}
if (selected >= 8) pass(`--needs browser selects ${selected} Chromium suites`);
else fail(`--needs browser selects only ${selected} Chromium suites; the 8 from #5758 should all declare the browser`);

// The selector reads code, not comments.
if (!declaresTool(stripJsComments("// toolUnavailable('browser', 'x')\n"), 'browser')
  && declaresTool("toolUnavailable('browser', `x`)", 'browser')
  && declaresTool("skip: !toolRequired('latex') && 'no engine'", 'latex')
  && !declaresTool("toolRequired('latex')", 'browser')) {
  pass('declaresTool matches a call for that tool only, and not one in a comment');
} else {
  fail('declaresTool matched a comment, or a call for another tool');
}

// Every tool has a declaration pattern, and only a listed tool is one: the name
// reaches these helpers from `--needs` on the command line.
const missingPattern = Object.keys(REQUIRED_TOOL_ENV).filter((tool) => {
  try { declaresTool('', tool); return false; } catch { return true; }
});
if (missingPattern.length === 0) pass('every tool in REQUIRED_TOOL_ENV has a declaration pattern');
else fail(`no declaration pattern for: ${missingPattern.join(', ')} — add it to DECLARATION_RE in tests/required-tools.mjs`);
const notTools = ['constructor', '__proto__', 'toString', 'browser.*'].filter((name) => {
  try { declaresTool('', name); return true; } catch { return false; }
});
if (notTools.length === 0) pass('declaresTool refuses names that are not listed tools');
else fail(`declaresTool accepted: ${notTools.join(', ')}`);

// toolUnavailable: a warning normally, a failure when the tool is required.
function countsUnder(env) {
  const r = spawnSync(NODE, ['--input-type=module', '-e', `
    const { toolUnavailable, results } = await import(${JSON.stringify(new URL('./helpers.mjs', import.meta.url).href)});
    toolUnavailable('browser', 'probe');
    process.stdout.write('COUNTS' + JSON.stringify(results()));
  `], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, [REQUIRED_TOOL_ENV.browser]: env } });
  const m = (r.stdout || '').match(/COUNTS(\{.*\})/);
  return m ? JSON.parse(m[1]) : { error: r.stderr || r.stdout };
}
const relaxed = countsUnder('');
const strict = countsUnder('1');
if (relaxed.warnings === 1 && relaxed.failed === 0) pass('toolUnavailable warns where the browser is optional');
else fail(`toolUnavailable without ${REQUIRED_TOOL_ENV.browser}: ${JSON.stringify(relaxed)}`);
if (strict.failed === 1 && strict.warnings === 0) pass(`toolUnavailable fails under ${REQUIRED_TOOL_ENV.browser}=1`);
else fail(`toolUnavailable with ${REQUIRED_TOOL_ENV.browser}=1: ${JSON.stringify(strict)}`);

// An unknown tool is a usage error, never a run of nothing that reads as green.
const bad = spawnSync(NODE, [join(ROOT, 'test-all.mjs'), '--needs', 'chromium'], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 });
if (bad.status === 1 && /--needs takes a comma-separated list of: browser, latex/.test(bad.stdout)) pass('test-all --needs refuses an unknown tool');
else fail(`test-all --needs chromium: exit ${bad.status}, ${JSON.stringify((bad.stdout || '').slice(-300))}`);
