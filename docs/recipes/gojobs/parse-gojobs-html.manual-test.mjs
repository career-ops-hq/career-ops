import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseFiles, parseSavedHtml } from './parse-gojobs-html.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/gojobs-search-results.html', import.meta.url));
const RECIPE_ROOT = fileURLToPath(new URL('.', import.meta.url));

test('parses English rows from legacy and current ASP.NET control prefixes', () => {
  const previousRoot = process.env.CAREER_OPS_ROOT;
  try {
    process.env.CAREER_OPS_ROOT = RECIPE_ROOT;
    assert.deepEqual(parseFiles([FIXTURE]), [
      { title: 'Learning Systems Specialist', url: 'https://www.gojobs.gov.on.ca/Preview.aspx?JobID=249065&Language=English', company: 'Ministry of Example Services', location: 'Toronto, Toronto Region', closingDate: 'Friday, September 18, 2026 11:59 pm EDT', jobId: '249065' },
      { title: 'Data & Reporting Analyst', url: 'https://www.gojobs.gov.on.ca/Preview.aspx?JobID=249066&Language=English', company: 'Ontario Public Service', location: 'London, West Region', closingDate: 'Monday, September 21, 2026 11:59 pm EDT', jobId: '249066' },
    ]);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
  }
});

test('deduplicates repeated postings across saved pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gojobs-parser-'));
  const html = '<a id="ctl00_Content_rptSearchResult_ctl01_lnkJobTitleEN" href="Preview.aspx?JobID=42&amp;Language=English">Role</a>';
  const previousRoot = process.env.CAREER_OPS_ROOT;
  try {
    process.env.CAREER_OPS_ROOT = dir;
    writeFileSync(join(dir, 'page-1.html'), html); writeFileSync(join(dir, 'page-2.htm'), html);
    assert.equal(parseFiles(['.']).length, 1);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects absolute and traversal inputs outside CAREER_OPS_ROOT', () => {
  const parent = mkdtempSync(join(tmpdir(), 'gojobs-root-'));
  const root = join(parent, 'data-root');
  const outside = join(parent, 'outside.html');
  const previousRoot = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(root);
    writeFileSync(outside, '<html></html>');
    process.env.CAREER_OPS_ROOT = root;
    assert.throws(() => parseFiles([outside]), /outside the career-ops data root/);
    assert.throws(() => parseFiles(['../outside.html']), /outside the career-ops data root/);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('rejects a symlink that escapes CAREER_OPS_ROOT', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'gojobs-symlink-'));
  const root = join(parent, 'data-root');
  const outside = join(parent, 'outside');
  const link = join(root, 'captures');
  const previousRoot = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(root);
    mkdirSync(outside);
    try { symlinkSync(outside, link, 'junction'); }
    catch (error) { return t.skip(`symlink unsupported here (${error.code || error.message})`); }
    process.env.CAREER_OPS_ROOT = root;
    assert.throws(() => parseFiles(['captures']), /outside the career-ops data root/);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('rejects an HTML symlink inside a directory when its target escapes CAREER_OPS_ROOT', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'gojobs-child-symlink-'));
  const root = join(parent, 'data-root');
  const captures = join(root, 'captures');
  const outside = join(parent, 'outside.html');
  const link = join(captures, 'escaped.html');
  const previousRoot = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(captures, { recursive: true });
    writeFileSync(outside, '<html></html>');
    try { symlinkSync(outside, link, 'file'); }
    catch (error) { return t.skip(`symlink unsupported here (${error.code || error.message})`); }
    process.env.CAREER_OPS_ROOT = root;
    assert.throws(() => parseFiles(['captures']), /outside the career-ops data root/);
  } finally {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('fails loudly on a saved Radware challenge', () => {
  assert.throws(() => parseSavedHtml('<title>Radware Captcha Page</title>', 'challenge.html'), /Radware challenge/);
});

test('fails loudly when only the bare search form was saved', () => {
  assert.throws(() => parseSavedHtml('<form action="Search.aspx"></form>', 'form.html'), /no GO Jobs result rows found/);
});

// Runs fn with the given env vars set (undefined deletes one) and cwd moved,
// then restores both.
function withEnvAndCwd(vars, cwd, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  const previousCwd = process.cwd();
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.chdir(cwd);
    return fn();
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ROW = '<a id="ctl00_Content_rptSearchResult_ctl01_lnkJobTitleEN" href="Preview.aspx?JobID=42&amp;Language=English">Role</a>';
const NO_ROOT_OVERRIDE = { CAREER_OPS_ROOT: undefined, CAREER_OPS_DATA_DIR: undefined };

test('reads captures from ~/career-ops-data when started from a plugin install copy', () => {
  const parent = mkdtempSync(join(tmpdir(), 'gojobs-plugin-'));
  const home = join(parent, 'home');
  const pluginCopy = join(parent, 'plugins', 'cache', 'career-ops', 'career-ops', '1.0.0');
  try {
    mkdirSync(join(home, 'career-ops-data', 'data', 'gojobs'), { recursive: true });
    mkdirSync(pluginCopy, { recursive: true });
    writeFileSync(join(home, 'career-ops-data', 'data', 'gojobs', 'page.html'), ROW);
    const jobs = withEnvAndCwd({
      ...NO_ROOT_OVERRIDE,
      CLAUDE_CODE_PLUGIN_CACHE_DIR: join(parent, 'plugins'),
      HOME: home,
      USERPROFILE: home,
    }, pluginCopy, () => parseFiles(['data/gojobs']));
    assert.equal(jobs.length, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('reads captures from the cwd when it is a checkout and nothing names a data root', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'gojobs-checkout-'));
  try {
    mkdirSync(join(checkout, 'data', 'gojobs'), { recursive: true });
    writeFileSync(join(checkout, 'data', 'gojobs', 'page.html'), ROW);
    const jobs = withEnvAndCwd({
      ...NO_ROOT_OVERRIDE,
      CLAUDE_CODE_PLUGIN_CACHE_DIR: join(checkout, 'no-plugins-here'),
    }, checkout, () => parseFiles(['data/gojobs']));
    assert.equal(jobs.length, 1);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
