/**
 * Reproduction for issue 3936: section 75's line-based read-only boundary
 * scan misses write-capable fs calls routed through a local re-binding.
 */

import { pass, fail } from './helpers.mjs';

const SELF_TEST_ONLY_FS = new Set(['mkdtempSync', 'mkdirSync', 'writeFileSync', 'rmSync']);

function extractRunSelfTestBody(src) {
  const runSelfTestStart = src.indexOf('function runSelfTest()');
  if (runSelfTestStart === -1) return '';

  const openBrace = src.indexOf('{', runSelfTestStart);
  let depth = 0;
  let i = openBrace;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(openBrace, i + 1);
}

function findOutsideSelfTestWriteCalls(src) {
  const selfTestBody = extractRunSelfTestBody(src);
  return src
    .replace(selfTestBody, '')
    .split('\n')
    .filter(line => [...SELF_TEST_ONLY_FS].some(fn => line.includes(`${fn}(`)) && !/^\s*import\b/.test(line));
}

{
  const jdArchiveSrc = [
    "import { writeFileSync } from 'fs';",
    'function runSelfTest() {',
    "  writeFileSync('/tmp/self-test.txt', 'ok');",
    '}',
    'const write = writeFileSync;',
    'export function checkJdArchive() {',
    "  write('reports/001-acme-2026-01-01.md', 'mutate');",
    '}',
  ].join('\n');

  const outsideSelfTest = findOutsideSelfTestWriteCalls(jdArchiveSrc);
  if (outsideSelfTest.length > 0) {
    pass('section 75 line scan catches local write aliases outside runSelfTest');
  } else {
    fail('section 75 line scan misses local write aliases outside runSelfTest');
  }
}
