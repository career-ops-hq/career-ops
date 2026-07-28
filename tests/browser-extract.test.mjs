// tests/browser-extract.test.mjs — unit coverage for the pure logic in
// browser-extract.mjs (config resolution + result normalizers). The Playwright
// navigation path is exercised live, not here.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nbrowser-extract.mjs (config + normalizers)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);
  const { resolveExtractorMode, compactText, normalizeJd, normalizeListing, parseArgs } = mod;

  // resolveExtractorMode — default mcp, explicit cli, garbage → mcp, missing → mcp
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-extractor-'));
  try {
    const write = (name, body) => { const p = join(tmp, name); writeFileSync(p, body); return p; };
    if (resolveExtractorMode(write('cli.yml', 'scan:\n  extractor: cli\n')) === 'cli') pass('resolveExtractorMode reads scan.extractor: cli');
    else fail('resolveExtractorMode should read cli');
    if (resolveExtractorMode(write('mcp.yml', 'scan:\n  extractor: mcp\n')) === 'mcp') pass('resolveExtractorMode reads scan.extractor: mcp');
    else fail('resolveExtractorMode should read mcp');
    if (resolveExtractorMode(write('none.yml', 'candidate:\n  full_name: X\n')) === 'mcp') pass('resolveExtractorMode defaults to mcp when the key is absent');
    else fail('resolveExtractorMode should default to mcp');
    if (resolveExtractorMode(write('bad.yml', 'scan:\n  extractor: nonsense\n')) === 'mcp') pass('resolveExtractorMode falls back to mcp for an unknown value');
    else fail('resolveExtractorMode should fall back to mcp on garbage');
    if (resolveExtractorMode(join(tmp, 'does-not-exist.yml')) === 'mcp') pass('resolveExtractorMode returns mcp when the profile is missing');
    else fail('resolveExtractorMode should return mcp for a missing file');
    if (resolveExtractorMode(write('malformed.yml', 'scan:\n  extractor: [cli\n')) === 'mcp') pass('resolveExtractorMode falls back to mcp on malformed YAML (catch branch)');
    else fail('resolveExtractorMode should return mcp when the YAML is invalid');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // parseArgs — index-based: a flag value is never mistaken for the URL, and 0 is honored
  const flagsFirst = parseArgs(['--mode', 'listing', 'https://x/careers']);
  if (flagsFirst.url === 'https://x/careers' && flagsFirst.mode === 'listing') pass('parseArgs finds the URL even when flags precede it');
  else fail(`parseArgs flags-first => ${JSON.stringify(flagsFirst)}`);
  const urlFirst = parseArgs(['https://x/1', '--mode', 'jd', '--max', '5']);
  if (urlFirst.url === 'https://x/1' && urlFirst.mode === 'jd' && urlFirst.max === 5) pass('parseArgs handles url-first with flags');
  else fail(`parseArgs url-first => ${JSON.stringify(urlFirst)}`);
  const zeroMax = parseArgs(['https://x/1', '--max', '0']);
  if (zeroMax.max === 0) pass('parseArgs honors --max 0 (not silently replaced by the default)');
  else fail(`parseArgs --max 0 => ${zeroMax.max}`);
  const badMax = parseArgs(['https://x/1', '--max', 'abc']);
  if (badMax.max === 200) pass('parseArgs falls back to the default for a non-integer --max');
  else fail(`parseArgs --max abc => ${badMax.max}`);

  // parseArgs --max-chars (#configurable JD cap): overrides the jd text cap,
  // defaults to 12000, and rejects non-positive/non-integer values.
  if (parseArgs(['https://x/1']).maxChars === 12000) pass('parseArgs defaults maxChars to the 12000 JD cap');
  else fail(`parseArgs default maxChars => ${parseArgs(['https://x/1']).maxChars}`);
  const bigChars = parseArgs(['https://x/1', '--max-chars', '40000']);
  if (bigChars.maxChars === 40000) pass('parseArgs honors an explicit --max-chars');
  else fail(`parseArgs --max-chars 40000 => ${bigChars.maxChars}`);
  const badChars = parseArgs(['https://x/1', '--max-chars', '0']);
  if (badChars.maxChars === 12000) pass('parseArgs ignores a non-positive --max-chars (keeps the default cap)');
  else fail(`parseArgs --max-chars 0 => ${badChars.maxChars}`);
  const nonIntChars = parseArgs(['https://x/1', '--max-chars', '1.5']);
  if (nonIntChars.maxChars === 12000) pass('parseArgs ignores a non-integer --max-chars (keeps the default cap)');
  else fail(`parseArgs --max-chars 1.5 => ${nonIntChars.maxChars}`);

  // compactText — collapse whitespace + cap length
  if (compactText('a   b\t\tc') === 'a b c') pass('compactText collapses runs of whitespace');
  else fail(`compactText => ${JSON.stringify(compactText('a   b\t\tc'))}`);
  const capped = compactText('x'.repeat(50), 10);
  if (capped.length === 11 && capped.endsWith('…')) pass('compactText caps length and appends an ellipsis');
  else fail(`compactText cap => ${JSON.stringify(capped)}`);

  // normalizeJd — shape { url, title, text }
  const jd = normalizeJd({ title: '  Senior Go  Engineer ', text: 'Line1\n\n\n\nLine2   end' }, 'https://x/1');
  if (jd.url === 'https://x/1' && jd.title === 'Senior Go Engineer' && jd.text === 'Line1\n\nLine2 end') {
    pass('normalizeJd shapes { url, title, text } and compacts both');
  } else {
    fail(`normalizeJd => ${JSON.stringify(jd)}`);
  }

  // normalizeJd honors a custom text cap (a long JD is truncated at the cap, not
  // silently at the 12000 default) while leaving the default behavior unchanged.
  const longText = 'y'.repeat(20000);
  const raised = normalizeJd({ title: 'Role', text: longText }, 'https://x/1', 15000);
  const defaulted = normalizeJd({ title: 'Role', text: longText }, 'https://x/1');
  if (raised.text.length === 15001 && raised.text.endsWith('…') &&
      defaulted.text.length === 12001 && defaulted.text.endsWith('…')) {
    pass('normalizeJd applies a custom textCap and defaults to the 12000 JD cap');
  } else {
    fail(`normalizeJd textCap => raised=${raised.text.length} default=${defaulted.text.length}`);
  }

  // normalizeListing — resolve relatives, drop nav/short labels, dedup, cap
  const anchors = [
    { href: '/jobs/1', label: 'Staff Engineer' },
    { href: 'https://x/jobs/1', label: 'Staff Engineer (dupe URL after resolve)' }, // different label, but…
    { href: '/jobs/2', label: 'Careers' },       // nav stopword → dropped
    { href: '/jobs/3', label: 'AI' },             // too short → dropped
    { href: 'javascript:void(0)', label: 'Broken Protocol Role' }, // non-http → dropped
    { href: '/jobs/4', label: 'ML Platform Lead' },
  ];
  const listed = normalizeListing(anchors, 'https://x/careers', 10);
  const urls = listed.jobs.map((j) => j.url);
  if (listed.url === 'https://x/careers' &&
      listed.jobs.length === 2 &&
      urls.includes('https://x/jobs/1') && urls.includes('https://x/jobs/4') &&
      listed.jobs[0].title === 'Staff Engineer') {
    pass('normalizeListing resolves relative URLs, dedups, drops nav/short/non-http anchors');
  } else {
    fail(`normalizeListing => ${JSON.stringify(listed.jobs)}`);
  }

  // dedup by resolved URL
  const dup = normalizeListing(
    [{ href: '/j/1', label: 'Role A' }, { href: 'https://x/j/1', label: 'Role A again' }],
    'https://x/careers',
  );
  if (dup.jobs.length === 1) pass('normalizeListing dedups by resolved URL');
  else fail(`normalizeListing dedup => ${JSON.stringify(dup.jobs)}`);

  // max cap
  const many = normalizeListing(
    Array.from({ length: 20 }, (_, i) => ({ href: `/j/${i}`, label: `Role Number ${i}` })),
    'https://x/careers',
    5,
  );
  if (many.jobs.length === 5) pass('normalizeListing respects the max cap');
  else fail(`normalizeListing max => ${many.jobs.length}`);

} catch (e) {
  fail(`browser-extract tests crashed: ${e.message}`);
}
