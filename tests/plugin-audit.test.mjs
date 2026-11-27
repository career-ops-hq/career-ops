import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPlugin } from '../plugin-audit.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'plugin-audit.mjs');

function runAudit(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  assert.equal(r.error, undefined, `plugin-audit.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `plugin-audit.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const r = runAudit('--help');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, describeSpawn(r, '--help must exit 0'));
});

test('-h prints usage and exits 0', () => {
  const r = runAudit('-h');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, describeSpawn(r, '-h must exit 0'));
});

test('--bogus unrecognized flag is rejected and exits 1', () => {
  const r = runAudit('--bogus');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus\. Valid flags: --help, -h/);
  assert.equal(r.status, 1, describeSpawn(r, 'unrecognized flag must exit 1'));
});

test('valid directory runs the audit', () => {
  // Use a known existing plugin directory from the repository. The bundled
  // apify plugin is not held to the community rules (it uses its own pinned
  // client), so a real audit of it reports findings and exits 1; an audit that
  // read nothing would print "audit clean" and exit 0.
  const r = runAudit('plugins/apify');
  // It shouldn't print usage or flag errors.
  assert.doesNotMatch(r.all, /unrecognized flag/);
  assert.doesNotMatch(r.all, /Usage:/);
  assert.equal(r.status, 1, describeSpawn(r, 'the apify plugin has findings'));
  assert.match(r.stdout, /^✗ [^\n]+: /m);
  assert.doesNotMatch(r.stdout, /audit clean/);
});

test('help exits before checking a missing directory', () => {
  for (const flag of ['--help', '-h']) {
    const r = runAudit(flag, join(ROOT, '__missing_plugin_audit_fixture__'));
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.stderr, '');
  }
});

test('--bogus --help is rejected as unknown flag before checking help', () => {
  const r = runAudit('--bogus', '--help');
  assert.equal(r.status, 1, describeSpawn(r));
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus/);
});

// A symlink must not be a place to hide code from the audit (#3818). The
// hand-rolled walk this replaced read a symlinked FILE (a link's Dirent is not
// a directory, so it fell through to the file branch) but never descended a
// symlinked DIRECTORY. Both resolve on import(), so both are scanned now — the
// old walk's file half kept, its directory hole closed.
test('code reached through a symlinked file or directory is audited', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-audit-links-'));
  try {
    const outside = join(dir, 'outside');
    const plugin = join(dir, 'plugin');
    mkdirSync(join(outside, 'lib'), { recursive: true });
    mkdirSync(plugin);
    writeFileSync(join(plugin, 'index.mjs'), 'export default {};\n');
    // The call is spelled in pieces so the HOL plugin scanner does not read this
    // fixture text as a call to eval in the test itself.
    const EVAL_CALL = 'ev' + 'al(';
    writeFileSync(join(outside, 'evil.mjs'), `export default () => ${EVAL_CALL}'1');\n`);
    writeFileSync(join(outside, 'lib', 'deep.mjs'), `export default () => ${EVAL_CALL}'2');\n`);
    try {
      symlinkSync(join(outside, 'evil.mjs'), join(plugin, 'linked.mjs'), 'file');
      symlinkSync(join(outside, 'lib'), join(plugin, 'vendor'), 'dir');
    } catch {
      t.skip('this machine cannot create symlinks (Windows without Developer Mode)');
      return;
    }

    const { ok, findings } = auditPlugin(plugin);
    const flagged = new Set(findings.filter((f) => /eval/.test(f.issue)).map((f) => f.file));
    assert.equal(ok, false, 'a plugin whose linked code calls eval must fail the audit');
    assert.ok(flagged.has('linked.mjs'), `a symlinked file was not audited: ${JSON.stringify(findings)}`);
    assert.ok(flagged.has('vendor/deep.mjs'), `a file under a symlinked directory was not audited: ${JSON.stringify(findings)}`);
    // Named by the path inside the plugin, not the link's target, so a finding
    // points the reviewer at the file the plugin actually ships.
    assert.ok(![...flagged].some((f) => f.includes('outside')), `findings named the link target: ${[...flagged]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Code the loader runs must not be invisible to the audit. Each fixture below
// imports node:child_process through a path the audit used to walk past, and
// each one ran under Node while the audit returned { ok: true }.
function pluginWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-audit-hidden-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}

const SPAWN = `import cp from 'node:${'child'}_process';\nexport default cp;\n`;

test('a node_modules directory at any depth fails the audit', () => {
  for (const nested of ['node_modules/x/evil.mjs', 'lib/node_modules/x/evil.mjs']) {
    const dir = pluginWith({ 'index.mjs': `import './${nested}';\nexport default {};\n`, [nested]: SPAWN });
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, `${nested}: a committed node_modules must fail the audit`);
      const dirRel = nested.slice(0, nested.indexOf('node_modules') + 'node_modules'.length);
      assert.ok(findings.some((f) => f.file === dirRel && /node_modules/.test(f.issue)), `${nested}: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('TypeScript and extensionless files are audited', () => {
  for (const name of ['evil.ts', 'evil.mts', 'evil.cts', 'evil', '.evil']) {
    const dir = pluginWith({ 'index.mjs': 'export default {};\n', [name]: SPAWN });
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, `${name} imports child_process and must fail the audit`);
      assert.ok(findings.some((f) => f.file === name && /forbidden import/.test(f.issue)), `${name}: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a relative import of a file type the audit does not read is flagged', () => {
  // require() loads ANY extension as CommonJS, so evil.txt runs as code.
  const dir = pluginWith({
    'index.mjs': "import './loader.cjs';\nimport data from './data.json' with { type: 'json' };\nexport default { data };\n",
    'loader.cjs': "module.exports = require('./evil.txt');\n",
    'evil.txt': `module.exports = require('${'child'}_process');\n`,
    'data.json': '{}\n',
  });
  try {
    const { ok, findings } = auditPlugin(dir);
    assert.equal(ok, false);
    assert.ok(findings.some((f) => f.file === 'loader.cjs' && /evil\.txt/.test(f.issue)), JSON.stringify(findings));
    assert.ok(!findings.some((f) => /data\.json/.test(f.issue)), `a JSON import is data, not code: ${JSON.stringify(findings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Computed loads are a deprecation warning, not a finding: approved registry
// plugins use them (a smoke test importing manifest.entry, a reader imported
// from the user's trusted checkout), so the audit still passes, but the
// reviewer and the installing user are told the audit cannot see the target.
test('a computed import() or require() specifier is a deprecation warning', () => {
  const cases = {
    'dyn.mjs': `const m = 'node:child' + '_process';\nexport default () => import(m);\n`,
    'tpl.mjs': 'const m = "x";\nexport default () => import(`node:${m}`);\n',
    'req.cjs': `const m = 'child' + '_process';\nmodule.exports = require(m);\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const dir = pluginWith({ 'index.mjs': 'export default {};\n', [name]: text });
    try {
      const { ok, findings, warnings } = auditPlugin(dir);
      assert.equal(ok, true, `${name}: a warning must not fail the audit: ${JSON.stringify(findings)}`);
      assert.deepEqual(findings, []);
      assert.ok(warnings.some((w) => w.file === name && w.line === 2 && /computed/.test(w.issue) && /deprecated/.test(w.issue)), `${name}: ${JSON.stringify(warnings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the CLI prints a deprecation warning and still exits 0', () => {
  const dir = pluginWith({ 'index.mjs': "const m = './x.mjs';\nexport default () => import(m);\n" });
  try {
    const r = runAudit(dir);
    assert.equal(r.status, 0, describeSpawn(r, 'a warning-only audit must exit 0'));
    assert.match(r.stdout, /✓ audit clean/);
    assert.match(r.stdout, /⚠ index\.mjs:2: computed import\(\)\/require\(\) specifier — deprecated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A reviewer reads the warned line by hand, so the warning names it. The line
// is where the load starts, counted the way JavaScript counts: CRLF is one
// break, and a break inside a block comment before the load still counts.
test('a computed-load warning names its line, through CRLF and block comments', () => {
  const cases = {
    'lf.mjs': ['export const a = 1;\n', 'export const b = 2;\n', 'export default (m) => import(m);\n'].join(''),
    'crlf.mjs': ['export const a = 1;\r\n', 'export const b = 2;\r\n', 'export default (m) => import(m);\r\n'].join(''),
    'comment.mjs': ['/* one\n', '   two\n', '   three */\n', 'export default (m) => import(m);\n'].join(''),
    'cr.mjs': 'export const a = 1;\rexport const b = 2;\rexport default (m) => import(m);\r',
  };
  const want = { 'lf.mjs': 3, 'crlf.mjs': 3, 'comment.mjs': 4, 'cr.mjs': 3 };
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...cases });
  try {
    const { warnings } = auditPlugin(dir);
    for (const [name, line] of Object.entries(want)) {
      const mine = warnings.filter((w) => w.file === name);
      assert.deepEqual(mine.map((w) => w.line), [line], `${name}: ${JSON.stringify(mine)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each computed load in a file gets its own warning line', () => {
  const dir = pluginWith({ 'index.mjs': 'export default (a, b) => [\n  import(a),\n  import(a), import(b),\n  1,\n  import(b),\n];\n' });
  try {
    const { ok, warnings } = auditPlugin(dir);
    assert.equal(ok, true);
    assert.deepEqual(warnings.map((w) => w.line), [2, 3, 5]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('literal import() and require() specifiers are not reported as computed', () => {
  const dir = pluginWith({
    'index.mjs': "export default () => import('./lib.mjs');\n",
    'lib.mjs': 'export const a = 1;\n',
    'c.cjs': "module.exports = require('./d.cjs');\n",
    'd.cjs': 'module.exports = 1;\n',
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process.getBuiltinModule is flagged', () => {
  const dir = pluginWith({ 'index.mjs': `export default process.getBuiltinModule('node:${'child'}_process');\n` });
  try {
    const { ok, findings } = auditPlugin(dir);
    assert.equal(ok, false);
    assert.ok(findings.some((f) => f.file === 'index.mjs' && /getBuiltinModule/.test(f.issue)), JSON.stringify(findings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The specifier scan reads source text, so it has to read it the way the
// loader does. Each fixture below loads node:child_process in a spelling an
// earlier scan walked past: a re-export, no whitespace between tokens, or a
// comment between tokens. A word "import" in a comment must not swallow the
// next real import either.
const CP = 'child' + '_process';

function forbiddenIn(files) {
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...files });
  try {
    const { ok, findings } = auditPlugin(dir);
    return { ok, findings, flagged: new Set(findings.filter((f) => /forbidden import/.test(f.issue)).map((f) => f.file)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a re-export of a forbidden module is flagged', () => {
  const cases = {
    'named.mjs': `export { execFileSync } from 'node:${CP}';\n`,
    'star.mjs': `export * from 'node:${CP}';\n`,
    'ns.mjs': `export * as cp from 'node:${CP}';\n`,
    'type.mjs': `export type { X } from 'node:${CP}';\n`,
    'commented.mjs': `export /* x */ { a /* } */ } /* y */ from /* z */ 'node:${CP}';\n`,
    'multiline.mjs': `export {\n  a,\n  b,\n}\n  from\n  'node:${CP}';\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} re-exports ${CP} and must be flagged: ${[...flagged]}`);
});

test('a re-export of a relative file does not flag a clean plugin', () => {
  const { ok, findings } = forbiddenIn({ 'lib.mjs': 'export const a = 1;\n', 'barrel.mjs': "export { a } from './lib.mjs';\nexport * from './lib.mjs';\n" });
  assert.equal(ok, true, JSON.stringify(findings));
});

test('an import with no whitespace between tokens is flagged', () => {
  const cases = {
    'braces.mjs': `import{execFileSync}from'node:${CP}';\n`,
    'star.mjs': `import*as cp from'node:${CP}';\n`,
    'bare.mjs': `import'node:${CP}';\n`,
    'bare2.mjs': `import"node:${CP}";\n`,
    'default.mjs': `import cp from"node:${CP}";\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('a comment between import tokens does not hide the specifier', () => {
  const cases = {
    'a.mjs': `import /* x */ cp from 'node:${CP}';\n`,
    'b.mjs': `import cp /* ' */ from 'node:${CP}';\n`,
    'c.mjs': `import cp from /* x */ 'node:${CP}';\n`,
    'd.mjs': `import // x\n cp from 'node:${CP}';\n`,
    'e.mjs': `export default () => import /* x */ ('node:${CP}');\n`,
    'f.mjs': `export default () => import(/* x */ 'node:${CP}' /* y */);\n`,
    'g.cjs': `module.exports = require /* x */ ('${CP}');\n`,
    'h.cjs': `module.exports = require(// x\n'${CP}');\n`,
    'i.cjs': `module.exports = module.require('${CP}');\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('the word import in a comment or string does not swallow a later real import', () => {
  const cases = {
    'prose.mjs': `// we import the data\nimport 'node:${CP}';\nimport x from './ok.mjs';\n`,
    'block.mjs': `/* import things */\nimport cp from 'node:${CP}';\nimport x from './ok.mjs';\n`,
    'meta.mjs': `const u = import.meta.url;\nimport cp from 'node:${CP}';\n`,
  };
  const { flagged } = forbiddenIn({ ...cases, 'ok.mjs': 'export default 1;\n' });
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

// A computed load is a warning, so the one thing it must not allow is a way to
// load without the warning: a comment in the call, or require reached by name.
test('a comment or an alias cannot dodge the computed-load warning', () => {
  const cases = {
    'comment-import.mjs': 'export default (m) => import /* x */ (m);\n',
    'comment-require.cjs': 'module.exports = (m) => require // x\n(m);\n',
    'alias.cjs': 'const r = require;\nmodule.exports = (m) => r(m);\n',
    'paren.cjs': 'module.exports = (m) => (require)(m);\n',
    'comma.cjs': 'module.exports = (m) => (0, require)(m);\n',
    'member.cjs': 'module.exports = (m) => module.require(m);\n',
    'create.mjs': "import { createRequire } from 'node:module';\nexport default createRequire(import.meta.url);\n",
  };
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...cases });
  try {
    const { warnings, findings } = auditPlugin(dir);
    for (const name of Object.keys(cases)) {
      assert.ok(warnings.some((w) => w.file === name && /computed/.test(w.issue) && /deprecated/.test(w.issue)), `${name} loaded without a warning: ${JSON.stringify(warnings)}`);
    }
    assert.ok(!findings.some((f) => f.file !== 'create.mjs'), `these are warnings, not findings: ${JSON.stringify(findings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plain literal loads and typeof require are not reported as computed', () => {
  const dir = pluginWith({
    'index.mjs': "export default {};\n",
    'a.cjs': "const ok = typeof require === 'function';\nmodule.exports = [ok, require('./b.cjs'), module.require('./b.cjs'), require.resolve];\n",
    'b.cjs': 'module.exports = 1;\n',
  });
  try {
    const { ok, findings, warnings } = auditPlugin(dir);
    assert.deepEqual({ ok, findings, warnings }, { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The scan must stay linear on input built to make a regex backtrack: a run of
// adjacent comments after `import` once took exponential time. The CLI runs in
// a child process so a regression is a failed test, not a hung one.
test('adjacent comments after import do not stall the audit', () => {
  const dir = pluginWith({
    'index.mjs': `import ${'/**/ '.repeat(20000)}\nexport default {};\n`,
    // The same run of comments in front of a real specifier: the audit must
    // get through it in time and still read the import after it.
    'marker.mjs': `import ${'/**/ '.repeat(20000)}'node:${'child'}_process';\n`,
  });
  try {
    const r = runAudit(dir);
    assert.equal(r.status, 1, describeSpawn(r, 'the import after a long run of comments must be flagged'));
    assert.match(r.stdout, /✗ marker\.mjs: forbidden import "node:child_process"/);
    assert.doesNotMatch(r.stdout, /✗ index\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// macOS and Windows resolve a path case-insensitively: EVIL.MJS runs when the
// plugin imports ./evil.mjs. Extensions are compared in lower case.
test('code files with upper-case extensions are audited', () => {
  for (const name of ['EVIL.MJS', 'evil.Cjs', 'EVIL.JS', 'evil.TS', 'evil.MTS', 'EVIL.CTS']) {
    const { ok, flagged } = forbiddenIn({ [name]: `import cp from 'node:${CP}';\nexport default cp;\n` });
    assert.equal(ok, false, `${name} imports ${CP} and must fail the audit`);
    assert.ok(flagged.has(name), `${name}: ${[...flagged]}`);
  }
});

// Lower case decides which files the audit READS, never whether an import is
// safe. Node compares the raw name: require('./x.JSON') is not JSON to it, it
// loads the file as CommonJS code. So only an exact .json is data, and a
// relative import with a non-canonical extension is itself a finding.
test('only an exact .json is data: other spellings are code and are flagged', () => {
  for (const name of ['x.JSON', 'x.Json', 'x.jSON']) {
    const dir = pluginWith({
      'index.mjs': 'export default {};\n',
      'loader.cjs': `module.exports = require('./${name}');\n`,
      [name]: `module.exports = require('${CP}');\n`,
    });
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, `${name} runs as code under require() and must fail the audit`);
      assert.ok(findings.some((f) => f.file === 'loader.cjs' && /non-canonical extension/.test(f.issue) && f.issue.includes(name)), `${name}: import not flagged: ${JSON.stringify(findings)}`);
      assert.ok(findings.some((f) => f.file === name && /forbidden import/.test(f.issue)), `${name}: file not audited as code: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a relative import with a non-canonical extension is flagged, an exact one is not', () => {
  const dir = pluginWith({
    'index.mjs': "import './a.mjs';\nimport d from './data.json' with { type: 'json' };\nexport default { d };\n",
    'a.mjs': 'export const a = 1;\n',
    'data.json': '{}\n',
    'bad.cjs': "require('./x.JS');\nrequire('./y.Mjs');\nrequire('./z.TXT');\n",
    'x.JS': 'module.exports = 1;\n',
    'y.Mjs': 'module.exports = 1;\n',
    'z.TXT': 'module.exports = 1;\n',
  });
  try {
    const { findings } = auditPlugin(dir);
    const flaggedImports = findings.filter((f) => f.file === 'bad.cjs').map((f) => f.issue);
    for (const name of ['x.JS', 'y.Mjs', 'z.TXT']) assert.ok(flaggedImports.some((i) => i.includes(name)), `${name}: ${JSON.stringify(findings)}`);
    assert.ok(!findings.some((f) => f.file === 'index.mjs'), `exact lower-case imports are fine: ${JSON.stringify(findings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ES2022 allows a string literal as an import or export name. A quoted name sits
// inside the braces of the clause, so the clause pattern has to read a quote
// there. It must not read one outside the braces: without semicolons a bare
// import'x' would otherwise be swallowed by the next statement's from clause.
test('a quoted import or export name does not hide the specifier', () => {
  const cases = {
    'import-quoted.mjs': `import { "execFileSync" as e } from 'node:${CP}';\nexport default e;\n`,
    'import-single.mjs': `import { 'execFileSync' as e, x } from 'node:${CP}';\n`,
    'import-semi.mjs': `import { "a;b(c)" as e } from 'node:${CP}';\n`,
    'import-mixed.mjs': `import d, { "x" as y } from "node:${CP}";\n`,
    'export-quoted.mjs': `export { "x" as y } from 'node:${CP}';\n`,
    'export-quoted-both.mjs': `export { "x" as "y z" } from 'node:${CP}';\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('a bare import without semicolons is not swallowed by the next statement', () => {
  const cases = {
    'asi.mjs': `import 'node:${CP}'\nimport x from './ok.mjs'\nexport default x\n`,
    'asi2.mjs': `import "node:${CP}"\nimport { y } from './ok.mjs'\n`,
  };
  const { flagged } = forbiddenIn({ ...cases, 'ok.mjs': 'export default 1;\nexport const y = 1;\n' });
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

// A relative specifier is resolved against the importing file. One that leaves
// the plugin directory reaches code the integrity lock never pinned (the
// plugin sits at plugins.local/<id>/, so ../../lib is career-ops internals),
// and one through node_modules or .git reaches directories the lock skips: a
// file that appears there after install runs unnoticed. Node decodes
// percent-escapes in an ES module specifier, so ./%2e%2e/ is ../ and
// ./%6eode_modules/ is ./node_modules/.
function findingsFor(files) {
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...files });
  try {
    return auditPlugin(dir).findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a relative import that leaves the plugin directory is flagged', () => {
  const cases = {
    'up.mjs': "import { nodeCheck } from '../../lib/syntax-check.mjs';\nexport default nodeCheck;\n",
    'dot.mjs': "import '../outside.mjs';\n",
    'detour.mjs': "import './a/../../outside.mjs';\n",
    'dyn.mjs': "export default () => import('../outside.mjs');\n",
    'reexport.mjs': "export * from '../outside.mjs';\n",
    'req.cjs': "module.exports = require('../outside.cjs');\n",
    'encoded.mjs': "import './%2e%2e/outside.mjs';\n",
    'encoded2.mjs': "import './%2E%2e/outside.mjs';\n",
    'lib/deep.mjs': "import '../../outside.mjs';\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) {
    assert.ok(findings.some((f) => f.file === name && /leaves the plugin directory/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
  }
});

test('relative imports that stay inside the plugin directory are not flagged', () => {
  const findings = findingsFor({
    'lib/a.mjs': "import '../index.mjs';\nimport './b.mjs';\nimport '../lib/b.mjs';\nimport './x/../b.mjs';\n",
    'lib/b.mjs': 'export const b = 1;\n',
  });
  assert.deepEqual(findings, []);
});

test('a relative import through node_modules or .git is flagged', () => {
  const cases = {
    'nm.mjs': "import './node_modules/x/e.mjs';\n",
    'nm-deep.mjs': "import './lib/node_modules/y.mjs';\n",
    'nm-case.mjs': "import './NODE_MODULES/x.mjs';\n",
    'nm-encoded.mjs': "import './%6eode_modules/x.mjs';\n",
    'nm-detour.mjs': "import './lib/../node_modules/x.mjs';\n",
    'git.mjs': "import './.git/hooks/x.mjs';\n",
    'git-case.mjs': "import './.GIT/x.mjs';\n",
    'dyn.mjs': "export default () => import('./node_modules/x.mjs');\n",
    'req.cjs': "module.exports = require('./node_modules/x.cjs');\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) {
    assert.ok(findings.some((f) => f.file === name && /node_modules|\.git/.test(f.issue) && /integrity lock/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
  }
});

// require('./dir') resolves through dir/package.json, and the "main" or
// "exports" it names can be any file: require() runs a .txt as CommonJS. The
// audit only reads code-extension files, so a package.json that points
// elsewhere hides the target. Every string under main, exports and imports is
// a path Node can load.
test('a package.json that points at a file the audit does not read is flagged', () => {
  const cases = {
    'a/package.json': { main: './real.txt' },
    'b/package.json': { exports: { '.': { import: './x.TXT', default: './ok.mjs' } } },
    'c/package.json': { imports: { '#a': { node: ['./z.data', './ok.mjs'] } } },
    'd/package.json': { exports: './payload.bin' },
    'package.json': { main: 'lib/entry.node-script' },
  };
  const files = { 'index.mjs': 'export default {};\n', 'ok.mjs': 'export default 1;\n' };
  for (const [name, json] of Object.entries(cases)) files[name] = JSON.stringify(json);
  const findings = findingsFor(files);
  for (const name of Object.keys(cases)) {
    assert.ok(findings.some((f) => f.file === name && /package\.json/.test(f.issue) && /does not read/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
  }
});

test('a package.json is matched by name in any case', () => {
  const findings = findingsFor({ 'sub/Package.JSON': JSON.stringify({ main: './x.txt' }) });
  assert.ok(findings.some((f) => f.file === 'sub/Package.JSON' && /does not read/.test(f.issue)), JSON.stringify(findings));
});

test('a package.json that names code, data or no path is not flagged', () => {
  const findings = findingsFor({
    'package.json': JSON.stringify({ name: 'p', version: '1.0.0', type: 'module', main: './index.mjs', exports: { '.': './index.mjs', './data': './data.json' }, imports: { '#dep': 'some-package' }, scripts: { test: 'node test/smoke.mjs' } }),
    'lib/package.json': JSON.stringify({ main: 'lib' }),
    'data.json': '{}\n',
  });
  assert.deepEqual(findings, []);
});

// Ways to reach the module loader's own hooks, which run a file by extension
// or load by path without an import the audit can read.
test('require.extensions, module.constructor and Module._load are flagged', () => {
  const cases = {
    'ext.cjs': "require.extensions['.x'] = require.extensions['.js'];\n",
    'ext-ws.cjs': 'require /* x */ . extensions;\n',
    'ext-bracket.cjs': "require['extensions'];\n",
    'ctor.cjs': 'module.constructor._load;\n',
    'ctor-bracket.cjs': "module['constructor'];\n",
    'ctor-opt.cjs': 'module?.constructor;\n',
    'load.cjs': "const M = module.constructor;\nM._load('x');\n",
    'load2.cjs': "Module._load('x');\n",
    'load3.cjs': "someModule._load ('x');\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) {
    assert.ok(findings.some((f) => f.file === name && /module loader/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
  }
});

test('names that merely resemble the loader hooks are not flagged', () => {
  const findings = findingsFor({ 'ok.cjs': "const reload = () => 1;\nconst _loaded = 2;\nconst o = { constructor: 3, extensions: [1] };\nmodule.exports = [reload(), _loaded, o.extensions, require.resolve, require.main];\n" });
  assert.deepEqual(findings, []);
});

// The scan reads tokens, not text. Everything below is code that an earlier
// text scan read wrongly: a keyword and a block-comment opener inside a
// comment or a string that "closed" over the real load, a specifier whose raw
// spelling differs from the value Node loads, and the ways to reach require or
// Function without writing the call the scan looked for.
test('a decoy keyword and block-comment opener cannot swallow a real load', () => {
  const cases = {
    'line-comment.mjs': `// import /*\nimport { execSync } from "node:${CP}";\n// */ from "./ok.mjs"\n`,
    'prose-comment.mjs': `// see import docs /*\nimport { execSync } from 'node:${CP}';\n// */ from './ok.mjs'\n`,
    'plain-comment.mjs': `// x /*\nimport { execSync } from "node:${CP}";\n// */ from "./ok.mjs"\n`,
    'string.mjs': `const s = 'import /*';\nimport { execSync } from 'node:${CP}';\nconst t = '*/ from "./ok.mjs"';\n`,
    'template.mjs': `const s = \`import /*\`;\nimport { execSync } from 'node:${CP}';\nconst t = \`*/ from "./ok.mjs"\`;\n`,
    'req-line.cjs': `// require /*\nconst cp = require("${CP}");\n// */ ("./ok.cjs")\n`,
    'req-string.cjs': `const s = "require(/*";\nconst cp = require('${CP}');\nconst t = "*/ ('./ok.cjs')";\n`,
    'req-line2.cjs': `// require /*\nconst cp = require('${CP}');\n// */ ('./ok.cjs')\n`,
  };
  const { flagged } = forbiddenIn({ ...cases, 'ok.mjs': 'export default 1;\n', 'ok.cjs': 'module.exports = 1;\n' });
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('a backslash-newline continuation inside a specifier is read', () => {
  const cases = {
    'cont.mjs': `import { execSync } from 'node:child_\\\nprocess';\n`,
    'cont-crlf.mjs': `import { execSync } from 'node:child_\\\r\nprocess';\n`,
    'cont-dq.cjs': `module.exports = require("child_\\\nprocess");\n`,
    'cont-dyn.mjs': `export default () => import('node:child\\\n_process');\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('a specifier is judged by the value Node loads, not its spelling', () => {
  const cases = {
    'u4.mjs': `import 'node:child\\u005f${'process'}';\n`,
    'ubrace.mjs': `import 'node:child\\u{5f}${'process'}';\n`,
    'x2.mjs': `import 'node:child\\x5f${'process'}';\n`,
    'octal.cjs': `module.exports = require('child\\137${'process'}');\n`,
    'ident.cjs': `const cp = \\u0072equire('${CP}');\n`,
    'ident2.cjs': `const cp = r\\u0065quire('${CP}');\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('an escaped dot or slash cannot hide a path that leaves the plugin or skips the lock', () => {
  const cases = {
    'up.mjs': "import './\\u002e./outside.mjs';\n",
    'up2.mjs': "import '\\u002e\\u002e/outside.mjs';\n",
    'up-x.mjs': "import '..\\x2foutside.mjs';\n",
    'nm.mjs': "import './node\\u005fmodules/x.mjs';\n",
    'git.mjs': "import './\\u002egit/x.mjs';\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) assert.ok(findings.some((f) => f.file === name && /leaves the plugin directory|node_modules or \.git/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
});

test('an escaped extension is judged after escapes are decoded', () => {
  const dir = pluginWith({
    'index.cjs': "require('./x\\u002etxt');\nmodule.exports = {};\n",
    'x.txt': `const cp = require('${CP}');\n`,
  });
  try {
    const { ok, findings } = auditPlugin(dir);
    assert.equal(ok, false, 'require() runs x.txt as JavaScript');
    assert.ok(findings.some((f) => f.file === 'index.cjs' && /x\.txt/.test(f.issue) && /does not read/.test(f.issue)), JSON.stringify(findings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reaching require without calling it is a computed-load warning', () => {
  const cases = {
    'call.cjs': `const cp = require.call(null, '${CP}');\n`,
    'apply.cjs': `const cp = require.apply(null, ['${CP}']);\n`,
    'bind.cjs': `const r = require.bind(null);\nr('${CP}');\n`,
    'bracket.cjs': `const cp = require['call'](null, '${CP}');\n`,
    'ternary.cjs': `const r = 1 ? require : 0;\nr('${CP}');\n`,
    'ternary2.cjs': `const r = 1?require:0;\nr('${CP}');\n`,
    'logical.cjs': `const r = require || null;\nr('${CP}');\n`,
    'args.cjs': `const r = arguments[1];\nr('${CP}');\n`,
    'tagged.cjs': `const cp = require\`${CP}\`;\n`,
    'escaped.cjs': `const r = \\u0072equire;\nr('${CP}');\n`,
    'shorthand.cjs': `const o = { require };\no.require('${CP}');\n`,
  };
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...cases });
  try {
    const { warnings, findings } = auditPlugin(dir);
    for (const name of Object.keys(cases)) {
      assert.ok(warnings.some((w) => w.file === name && /computed/.test(w.issue) && /deprecated/.test(w.issue)), `${name} loaded without a warning: ${JSON.stringify(warnings)}`);
    }
    // shorthand.cjs also calls o.require('<literal>'), which is a read specifier and a finding.
    assert.deepEqual(findings.filter((f) => f.file !== 'shorthand.cjs'), [], 'aliases are warnings, not findings');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an object key named require and typeof require are not aliases', () => {
  const dir = pluginWith({
    'index.mjs': 'export default {};\n',
    'ok.cjs': "const o = { require: 1, nested: { require: 2 } };\nconst has = typeof require !== 'undefined';\nmodule.exports = [o, has, require.resolve, require.main, require.cache];\n",
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Function called without new is dynamic code execution too', () => {
  const cases = {
    'bare.mjs': "export default Function('return 1');\n",
    'new.mjs': "export default new Function('return 1');\n",
    'ws.mjs': "export default Function /* x */ ('return 1');\n",
    'process.mjs': "const p = Function('return process')();\nexport default p;\n",
    'evalcall.mjs': "export default eval('1');\n",
    'escaped.mjs': "export default \\u0065val('1');\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) assert.ok(findings.some((f) => f.file === name && /eval\/new Function/.test(f.issue)), `${name} must be flagged: ${JSON.stringify(findings)}`);
});

test('the word Function or eval in text, or as a property, is not dynamic code', () => {
  const findings = findingsFor({ 'ok.mjs': "// eval('x') and Function('y')\nconst s = \"Function('z')\";\nconst o = { Function: 1, eval: 2 };\nexport default [s, o.Function, o.eval];\n" });
  assert.deepEqual(findings, []);
});

// A plugin that runs a loop of big, hostile input must still finish: the scan
// is one pass over the source, so time grows with its size, not its keywords.
test('large hostile input is scanned in linear time', () => {
  const inputs = {
    'imports.mjs': 'import '.repeat(100000),
    'openers.mjs': 'import /*'.repeat(50000),
    'requires.cjs': 'require /*'.repeat(50000) + '\nrequire(',
    'braces.mjs': 'import {'.repeat(50000),
    'exports.mjs': 'export {'.repeat(50000),
    'templates.mjs': '`${'.repeat(30000),
    'quotes.mjs': "import '".repeat(50000),
    'slashes.mjs': '(a) / b /'.repeat(50000),
    // These start a regex scan on every `/`, and the scan never finds its end.
    'regex-class.mjs': 'const z = 1' + ' /['.repeat(100000),
    'regex-open.mjs': 'x = ' + '/['.repeat(60000),
    'regex-paren.mjs': '(/['.repeat(60000),
    'regex-return.mjs': 'function f() { return /[' + ' /['.repeat(60000) + ' }',
    'escapes.mjs': "const s = '" + '\\u{'.repeat(300000) + "';",
    'forks.mjs': 'x = {} / 1 / 2;\n'.repeat(30000),
    'name-forks.mjs': 'of / 1 / 2 '.repeat(30000),
    'html.cjs': 'a <!-- /* '.repeat(30000) + '\n--> /*\n'.repeat(30000),
  };
  for (const [name, text] of Object.entries(inputs)) {
    const dir = pluginWith({ 'index.mjs': 'export default {};\n', [name]: text });
    try {
      // Hostile input raises a finding per bogus specifier, so allow a big report.
      const started = Date.now();
      const r = spawnSync(process.execPath, [SCRIPT, dir], { cwd: ROOT, encoding: 'utf-8', timeout: 8000, maxBuffer: 1 << 28 });
      assert.equal(r.error, undefined, `${name}: the audit must finish: ${r.error?.message}`);
      assert.ok([0, 1].includes(r.status), describeSpawn(r, `${name}: the audit must finish`));
      assert.equal(r.signal, null, `${name}: the audit was killed`);
      assert.ok(Date.now() - started < 8000, `${name}: took ${Date.now() - started}ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// A `/` is a regex or a division by what comes before it. Reading one as the
// other swallows the load after it, in two ways. A division read as a regex runs
// to the next `/` on its line, so each division fixture puts the load before a
// `// /` on its line. A regex read as a division starts a template or a comment
// from a backtick or `/*` inside the regex, so each regex fixture hides one
// there. Either way the load is only seen by the right reading, and a lexer that
// always read one way would fail half of these.
const DIVISION_AFTER = {
  paren: '(4)', index: 'b[0]', call: 'f(x)', number: '4', string: "'x'", name: 'b', 'this': 'this',
  keyword_property: 'o.in', optional_property: 'o?.return', private_name: 'this.#of', template: '`${x}`',
  nested_template: '`a${`b${c}`}`', regex: '/x/g', property_if: 'o.if(1)',
};
const REGEX_AFTER = {
  if: 'if (x)', while: 'while (x)', for: 'for (;;)', return: 'function f() { return', assign: 'const re =',
  comma: 'f(a,', paren: 'f(', bang: 'const n = !', typeof: 'const t = typeof', ternary: 'c ?', colon: 'c ? 1 :',
  arrow: 'const g = () =>', case: 'switch (x) { case', semicolon: 'a();', else: 'if (a) b(); else',
  in: 'const b = x in', instanceof: 'const b = x instanceof', void: 'void', delete: 'delete', spread: 'f(...',
  line_start: '',
};
const SLASH_FIXTURES = {
  ...Object.fromEntries(Object.entries(DIVISION_AFTER).map(([k, before]) => [`div-${k}.cjs`, `const a = ${before} / 2; const cp = require('${CP}'); // /\n`])),
  ...Object.fromEntries(Object.entries(REGEX_AFTER).flatMap(([k, before]) => [
    [`re-tick-${k}.cjs`, `${before} /\`/.test(y);\nconst cp = require('${CP}');\n`],
    [`re-opener-${k}.cjs`, `${before} /[/*]/.test(y);\nconst cp = require('${CP}');\n`],
  ])),
};

test('a regex literal and a division are told apart, so neither hides a load', () => {
  const { findings, flagged } = forbiddenIn(SLASH_FIXTURES);
  for (const name of Object.keys(SLASH_FIXTURES)) {
    assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
    // Found by reading the file as written, not as a leftover of a wrong reading.
    assert.ok(!findings.some((f) => f.file === name && /could not be fully read/.test(f.issue)), `${name} must read to the end`);
  }
});

test('a plugin that only mentions loads in text, regexes and comments is clean', () => {
  const dir = pluginWith({
    'index.mjs': [
      "import crypto from 'node:crypto';",
      "import { readFile } from 'node:fs/promises';",
      "// require('x') and import('y') in prose, and a fetch( call, and eval(",
      "const re = /import\\s+x|require\\(|fetch\\(/;",
      "const s = \"import cp from 'x'; require('y'); Function('z')\";",
      "const t = `require('${CP}') ${crypto.randomUUID()} import('q')`;",
      "export default { re, s, t, readFile, q: 10 / 2 / 5 };",
      '',
    ].join('\n'),
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An optional call is still a call, and indirect eval does not write eval(.
test('an optional call or an indirect eval is read like a call', () => {
  const dir = pluginWith({
    'index.mjs': 'export default {};\n',
    'opt.cjs': `module.exports = require?.('${CP}');\n`,
    'opt-member.cjs': `module.exports = module.require?.('${CP}');\n`,
    'opt-computed.cjs': 'module.exports = (m) => require?.(m);\n',
    'eval-opt.mjs': "export default eval?.('1');\n",
    'eval-comma.mjs': "export default (0, eval)('1');\n",
    'eval-alias.mjs': "const e = eval;\nexport default e('1');\n",
    'function-opt.mjs': "export default Function?.('return 1');\n",
    'fetch-opt.mjs': "export default fetch?.('https://example.com');\n",
  });
  try {
    const { findings, warnings } = auditPlugin(dir);
    const flagged = (re) => new Set(findings.filter((f) => re.test(f.issue)).map((f) => f.file));
    for (const name of ['opt.cjs', 'opt-member.cjs']) assert.ok(flagged(/forbidden import/).has(name), `${name}: ${JSON.stringify(findings)}`);
    assert.ok(warnings.some((w) => w.file === 'opt-computed.cjs' && /specifier/.test(w.issue)), JSON.stringify(warnings));
    for (const name of ['eval-opt.mjs', 'eval-comma.mjs', 'eval-alias.mjs', 'function-opt.mjs']) assert.ok(flagged(/eval\/new Function/).has(name), `${name}: ${JSON.stringify(findings)}`);
    assert.ok(flagged(/direct global fetch/).has('fetch-opt.mjs'), JSON.stringify(findings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A `/` is a regex or a division, and where the source does not say which, the
// audit reads it both ways and reports what either reading loads. Each fixture
// below is built so that one wrong reading swallows the marker line after it
// (a quote, a backtick or a comment opener inside the text it takes for a
// regex), while Node runs the marker.
const NET = 'node:' + 'net';
const AMBIGUOUS = {
  'of-div.mjs': `let of = 4; const v = of / 2; import '${NET}'; // /\n`,
  'await-div.cjs': `var await = 4; var v = await / 2; require('${NET}'); // /\n`,
  'yield-div.cjs': `var yield = 4; var v = yield / 2; require('${NET}'); // /\n`,
  'private-of-div.mjs': `class P { #of = 4; m() { return this.#of / 2 + '/\`'.length; } }\nimport '${NET}';\n`,
  'prop-if-div.mjs': `const obj = { if: (v) => v }; const v = obj.if(1) / 2; import '${NET}'; // /\n`,
  'fn-expr-div.mjs': `const fe = function () {} / 2; import '${NET}'; // /\n`,
  'class-expr-div.mjs': `const ce = class {} / 2; import '${NET}'; // /\n`,
  'label-block-tick.mjs': `L: {}\n/\`/.test('a');\nimport '${NET}';\n`,
  'label-block-opener.mjs': `L: {}\n/[/*]/.test('a');\nimport '${NET}';\n`,
  'case-block-tick.mjs': `switch (1) { case 1: {}\n/\`/.test('a'); }\nimport '${NET}';\n`,
  'postinc-div.mjs': `let k = 1; k++ / 2 / 1; import '${NET}'; // /\n`,
  'preinc-regex.mjs': `++/\`/.lastIndex;\nimport '${NET}';\n`,
  // The first slash is a division and the second a regex, all on one line with
  // the marker. Reading every ambiguous slash as a regex, or every one as a
  // division, swallows the marker; only the mixed reading sees it.
  'chain.mjs': `let of = 1, v = of / 2; {} /\`/.test('a'); import '${NET}'; // /\n`,
  'chain-cjs.cjs': `var await = 1, v = await / 2; { } /\`/.test('a'); require('${NET}'); // /\n`,
};

test('a slash that is a regex or a division cannot hide a load either way', () => {
  const { flagged } = forbiddenIn(AMBIGUOUS);
  for (const name of Object.keys(AMBIGUOUS)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('an unambiguous slash is still read one way, so clean code stays clean', () => {
  const dir = pluginWith({
    'index.mjs': [
      "const re = /[a-z]+'/g, half = (n) => n / 2 / 1, ok = (a + 1) / (b - 1);",
      "if (re) /'/.test('x');",
      'const t = `${half(4)}` / 2 / 1;',
      "export default { re, half, ok, t, d: obj.if(1) / 2 / 1 };",
      '',
    ].join('\n'),
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// In CommonJS, `<!--` anywhere and `-->` at the start of a line begin a line
// comment, so a `/*` or a backtick after one is not what it looks like. In an
// ES module they are not comments, so the audit reads both ways.
test('HTML-like comments in CommonJS cannot hide a load', () => {
  const cases = {
    'open-opener.cjs': `const a = 1; <!-- /*\nrequire('${NET}');\n`,
    'open-tick.cjs': `const a = 1; <!-- \`\nrequire('${NET}');\n`,
    'close-opener.cjs': `--> /*\nrequire('${NET}');\n`,
    'close-later.cjs': `const a = 1;\n  --> /*\nrequire('${NET}');\n`,
    'close-after-comment.cjs': `/* x\n*/ --> \`\nrequire('${NET}');\n`,
    'js-open.js': `const a = 1; <!-- /*\nrequire('${NET}');\n`,
    'bare': `const a = 1; <!-- /*\nrequire('${NET}');\n`,
  };
  const { flagged } = forbiddenIn(cases);
  for (const name of Object.keys(cases)) assert.ok(flagged.has(name), `${name} must be flagged: ${[...flagged]}`);
});

test('a decrement and a comparison are not HTML-like comments', () => {
  const dir = pluginWith({ 'index.mjs': 'let n = 3; while (n --> 0) {}\nexport default n < !n;\n' });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Time must grow with the size of the file. A regex literal that never closes
// on its line used to be rescanned to the end of the line for every `/` after
// it, and a `\u{` with no `}` searched the rest of the file each time.
function auditCli(files, limitMs = 6000) {
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...files });
  try {
    const started = Date.now();
    const r = spawnSync(process.execPath, [SCRIPT, dir], { cwd: ROOT, encoding: 'utf-8', timeout: limitMs, maxBuffer: 1 << 28 });
    const ms = Date.now() - started;
    assert.equal(r.error, undefined, `the audit must finish in ${limitMs}ms: ${r.error?.message}`);
    return { ...r, ms, all: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a long line of slashes that open a regex class is scanned in linear time', () => {
  const r = auditCli({ 'slashes.mjs': `import '${NET}';\nconst z = 1${' /['.repeat(120000)}\n` });
  assert.ok(r.ms < 4000, `took ${r.ms}ms`);
  assert.match(r.all, /forbidden import "node:net"/);
});

test('many unclosed \\u{ escapes are scanned in linear time', () => {
  const r = auditCli({ 'braces.mjs': `import '${NET}';\nconst z = '${'\\u{'.repeat(1000000)}';\n` });
  assert.ok(r.ms < 4000, `took ${r.ms}ms`);
  assert.match(r.all, /forbidden import "node:net"/);
});

test('many ambiguous slashes stop at a cap and fail closed', () => {
  const r = auditCli({ 'forks.mjs': `import '${NET}';\n${'x = {} / 1 / 2;\n'.repeat(5000)}` });
  assert.ok(r.ms < 4000, `took ${r.ms}ms`);
  assert.equal(r.status, 1);
  assert.match(r.all, /forks\.mjs: .*could not be fully read/);
});

// A file Node rejects with a SyntaxError never runs, but the audit must not
// call it clean: an unterminated template or comment is the cheapest way to
// make the rest of a file disappear from a scan.
test('an unterminated template or block comment is a finding, not a clean file', () => {
  const cases = {
    'template.mjs': `const t = \`abc\nimport '${NET}';\n`,
    'comment.mjs': `/* abc\nimport '${NET}';\n`,
    'subst.mjs': `const t = \`a\${ b\nimport '${NET}';\n`,
    'template-then-marker.cjs': `module.exports = \`x\n;require('${NET}');\n`,
  };
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...cases });
  try {
    const { ok, findings } = auditPlugin(dir);
    assert.equal(ok, false);
    for (const name of Object.keys(cases)) assert.ok(findings.some((f) => f.file === name && /could not be fully read/.test(f.issue)), `${name}: ${JSON.stringify(findings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that is read to the end is not reported as unreadable', () => {
  const dir = pluginWith({ 'index.mjs': 'const t = `a${`b${1}`}c`; /* done */\nexport default t;\n' });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// require() tries .js, .json and then .node, so an import with no extension can
// land on a native addon the audit never reads, and a package.json main can
// point at an extensionless name that does the same.
test('a native addon or WebAssembly file reached without its extension is flagged', () => {
  const cases = {
    'require-addon': { 'index.cjs': "module.exports = require('./addon');\n", 'addon.node': 'not a real addon\n' },
    'require-dir-index': { 'index.cjs': "module.exports = require('./lib');\n", 'lib/index.node': 'not a real addon\n' },
    'main-extensionless': { 'index.cjs': "module.exports = require('./sub');\n", 'sub/package.json': '{"main":"./addon"}', 'sub/addon.node': 'x\n' },
    'main-bare-name': { 'index.cjs': "module.exports = require('./sub');\n", 'sub/package.json': '{"main":"addon"}', 'sub/addon.node': 'x\n' },
    'import-wasm': { 'index.mjs': "import './mod';\n", 'mod.wasm': 'x\n' },
    'require-wasm': { 'index.cjs': "require('./mod');\n", 'mod.wasm': 'x\n' },
    'exports-wasm': { 'index.mjs': 'export default 1;\n', 'package.json': '{"exports":"./mod"}', 'mod.wasm': 'x\n' },
  };
  for (const [name, files] of Object.entries(cases)) {
    const dir = pluginWith(files);
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, `${name} must fail the audit`);
      assert.ok(findings.some((f) => /native addon|WebAssembly/.test(f.issue)), `${name}: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a .node file in the plugin tree is reported whether or not anything loads it', () => {
  for (const name of ['addon.node', 'lib/deep/addon.NODE']) {
    const dir = pluginWith({ 'index.mjs': 'export default 1;\n', [name]: 'x\n' });
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, name);
      assert.ok(findings.some((f) => f.file === name && /native addon/.test(f.issue)), `${name}: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('an extensionless import of a code file is not a native addon', () => {
  const dir = pluginWith({
    'index.cjs': "module.exports = [require('./lib'), require('./util')];\n",
    'lib/index.js': 'module.exports = 1;\n',
    'util.js': 'module.exports = 2;\n',
    'package.json': '{"main":"./index","exports":{".":"./index.cjs"}}',
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Node rejects a package.json it cannot parse, and the audit reads main and
// exports from it, so one it cannot read is a file it cannot vouch for.
test('a package.json that does not parse is a finding', () => {
  for (const [name, text] of Object.entries({ truncated: '{ "main": "./x.node", ', empty: '', trailing: '{"main":"./x.js",}' })) {
    const dir = pluginWith({ 'index.mjs': 'export default 1;\n', 'package.json': text, 'sub/package.json': text });
    try {
      const { ok, findings } = auditPlugin(dir);
      assert.equal(ok, false, name);
      for (const file of ['package.json', 'sub/package.json']) assert.ok(findings.some((f) => f.file === file && /could not be parsed/.test(f.issue)), `${name} ${file}: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a package.json that parses, with or without a byte order mark, is not a finding', () => {
  const dir = pluginWith({ 'index.mjs': 'export default 1;\n', 'package.json': '{"name":"x","main":"./index.mjs"}', 'sub/package.json': '﻿{"name":"y"}' });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A name is the global only if no binding in scope hides it. A parameter or a
// declaration called fetch (a plugin that destructures its context) and a
// method called fetch are not the global; a call that no binding reaches is.
test('fetch bound by a parameter, a declaration or a method name is not the global', () => {
  const cases = {
    'destructured.mjs': "export default async function run({ fetch, log }) { const r = await fetch('u'); log(r); }\n",
    'method.mjs': "export class Client { constructor(c) { this.c = c; } async fetch(url) { return this.c.fetch(url); } }\n",
    'object-method.mjs': "export default { fetch(url) { return 1; }, async *page(u) { yield u; } };\n",
    'plain-param.mjs': "export function get(fetch, u) { return fetch(u); }\n",
    'arrow.mjs': "export const a = ({ fetch }) => fetch('u');\nexport const b = (fetch) => { return fetch('u'); };\nexport const c = async (x, [fetch]) => fetch(x);\nexport const d = fetch => fetch('u');\n",
    'default.mjs': "export const a = ({ fetch = null, ...rest }) => fetch('u');\nexport const b = ({ f: fetch }) => fetch('u');\n",
    'catch.mjs': "try { run(); } catch ({ fetch }) { fetch('u'); }\n",
    'top-const.mjs': "const { fetch } = ctx;\nexport const get = (u) => fetch(u);\n",
    'top-let.mjs': "let fetch = ctx.fetch;\nexport const get = (u) => fetch(u);\n",
    'top-function.mjs': "function fetch(u) { return u; }\nexport default fetch('u');\n",
    'block-const.mjs': "export function get(ctx, u) { const { fetch } = ctx; return fetch(u); }\n",
    'for-const.mjs': "for (const fetch of fetchers) { fetch('u'); }\n",
    'private.mjs': "export class C { #fetch(u) { return u; } go(u) { return this.#fetch(u); } }\n",
  };
  const findings = findingsFor(cases);
  assert.deepEqual(findings.filter((f) => /global fetch/.test(f.issue)), []);
});

test('a fetch call that no binding reaches is still the global', () => {
  const cases = {
    'after-function.mjs': "export function a({ fetch }) { return fetch('u'); }\nfetch('x');\n",
    'class-body.mjs': "export class C { async fetch(u) { return fetch(u); } }\n",
    'default-value.mjs': "export const a = (x = fetch('u')) => x;\n",
    'ternary-default.mjs': "export const a = (x = c ? 1 : fetch) => fetch('u');\n",
    'key-not-binding.mjs': "export const a = ({ fetch: other }) => fetch('u');\n",
    'paren-then-block.mjs': "let x = (fetch)\n{ fetch('u'); }\n",
    'extends.mjs': "export class C extends fetch('u') {}\n",
    'after-block.mjs': "export function get(ctx, u) { const { fetch } = ctx; return fetch(u); }\nfetch('x');\n",
    'after-loop.mjs': "for (const fetch of fs) { fetch('u'); }\nfetch('x');\n",
    'after-arrow.mjs': "export const a = ({ fetch }) => fetch('u'), b = fetch('x');\n",
    'after-arrow-line.mjs': "export const a = ({ fetch }) => fetch('u')\nfetch('x')\n",
    'expr-name.mjs': "const f = function fetch() {};\nfetch('x');\n",
    'ctx-key.mjs': "export default { fetch: (u) => u, go() { return fetch('u'); } };\n",
    // Calls that only look like a function or a catch clause with fetch as a parameter.
    'dot-function.mjs': "obj.function(fetch)\n{ fetch('u'); }\n",
    'dot-catch.mjs': "promise.catch(fetch)\n{ fetch('u'); }\n",
    'call-then-block.mjs': "run(fetch)\n{ fetch('u'); }\n",
  };
  const findings = findingsFor(cases);
  for (const name of Object.keys(cases)) assert.ok(findings.some((f) => f.file === name && /global fetch/.test(f.issue)), `${name}: ${JSON.stringify(findings.filter((f) => f.file === name))}`);
});

test('hostile nesting around fetch does not stall the audit and still flags the call', () => {
  const r = auditCli({
    'arrows.mjs': `${'fetch=>'.repeat(60000)}1;\nfetch('u');\n`,
    'patterns.mjs': `const ${'['.repeat(40000)}fetch${']'.repeat(40000)} = 1;\nfetch('u');\n`,
    'params.mjs': `${'((fetch) =>'.repeat(30000)}1${')'.repeat(30000)};\nfetch('u');\n`,
  });
  assert.ok(r.ms < 5000, `took ${r.ms}ms`);
  for (const name of ['arrows.mjs', 'patterns.mjs', 'params.mjs']) assert.match(r.all, new RegExp(`${name.replace('.', '\\.')}: direct global fetch`));
});

// Ways to reach the Function constructor, or to run code, without writing
// eval( or Function( : a constructor chain, Function passed around as a value,
// Function.call, and Reflect. Harmless uses of these are common, so they are
// warnings with a line number, not findings.
test('a constructor chain, Function as a value and Reflect.construct are warnings', () => {
  const cases = {
    'chain-call.mjs': "const f = (() => {}).constructor('return process');\nexport default f;\n",
    'chain-twice.mjs': "export default [].constructor.constructor('return process')();\n",
    'chain-index.mjs': "export default x['constructor']['constructor']('return 1')();\n",
    'chain-read.mjs': "const C = fn.constructor;\nexport default C;\n",
    'function-value.mjs': "const F = Function;\nexport default F;\n",
    'function-arg.mjs': "export default run(Function, 1);\n",
    'function-call.mjs': "export default Function.call(null, 'return 1');\n",
    'function-apply.mjs': "export default Function.apply(null, ['return 1']);\n",
    'function-bind.mjs': "export default Function.bind(null)('return 1');\n",
    'reflect-construct.mjs': "export default Reflect.construct(Object, []);\n",
    'reflect-apply.mjs': "export default Reflect.apply(f, null, []);\n",
  };
  const dir = pluginWith({ 'index.mjs': 'export default {};\n', ...cases });
  try {
    const { ok, findings, warnings } = auditPlugin(dir);
    assert.equal(ok, true, JSON.stringify(findings));
    for (const name of Object.keys(cases)) {
      const mine = warnings.filter((w) => w.file === name);
      assert.ok(mine.length > 0, `${name} must warn: ${JSON.stringify(warnings)}`);
      assert.ok(mine.every((w) => Number.isInteger(w.line) && w.line >= 1 && w.line <= 2), `${name}: ${JSON.stringify(mine)}`);
    }
    assert.equal(warnings.find((w) => w.file === 'chain-read.mjs').line, 1);
    assert.equal(warnings.find((w) => w.file === 'function-value.mjs').line, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harmless uses of Function, constructor and Reflect are not warnings', () => {
  const dir = pluginWith({
    'index.mjs': [
      'class A { constructor(x) { this.x = x; } static of(v) { return new A(v); } }',
      'const names = [new A(1).constructor.name, err.constructor.name];',
      'const ok = [fn instanceof Function, typeof Function, Function.prototype.toString.call(fn), o.Function, { Function: 1, constructor: 2 }];',
      "const t = 'constructor and Function and Reflect.construct in a string';",
      '// fn.constructor("x") and Function.call in a comment',
      'export default { names, ok, t, r: Reflect.has(A, "x"), s: Reflect.ownKeys(A) };',
      '',
    ].join('\n'),
  });
  try {
    assert.deepEqual(auditPlugin(dir), { ok: true, findings: [], warnings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('module.constructor is still a finding, not a warning', () => {
  const dir = pluginWith({ 'index.cjs': "module.exports = module.constructor;\n", 'two.cjs': "module.exports = module['constructor'];\n" });
  try {
    const { findings, warnings } = auditPlugin(dir);
    assert.deepEqual(findings.map((f) => f.file).sort(), ['index.cjs', 'two.cjs']);
    assert.deepEqual(warnings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
