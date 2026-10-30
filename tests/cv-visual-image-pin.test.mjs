// tests/cv-visual-image-pin.test.mjs
//
// tests/cv-visual/Dockerfile pins the Playwright image a third time, by tag and
// digest, for the cv-visual job (the root Dockerfile's two pins are checked in
// test-all.mjs). Its first line asks to stay aligned with package.json, but
// nothing checked it, so the 1.64.1 bump (#5415) left it a patch behind. Only
// the tag can be compared here: the digest has to come from the registry, so
// this requires one is present but cannot derive it.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n🔎 cv-visual image pin (tests/cv-visual/Dockerfile matches package.json)');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

// The Playwright version of the digest-pinned FROM line, or null when the line
// is missing or has lost its digest.
function pinnedVersion(dockerfile) {
  return dockerfile
    .match(/^FROM mcr\.microsoft\.com\/playwright:v([\d.]+)-[\w.-]+@sha256:[0-9a-f]{64}\s*$/m)?.[1] ?? null;
}

// ── The parser ───────────────────────────────────────────────────────
const DIGEST = 'a'.repeat(64);
for (const [label, text, want] of [
  ['a tag and digest', `# x\nFROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}\n`, '1.64.1'],
  ['CRLF line endings', `FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}\r\nWORKDIR /work\r\n`, '1.64.1'],
  ['a tag without a digest', 'FROM mcr.microsoft.com/playwright:v1.64.1-noble\n', null],
  ['a short digest', 'FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:abc\n', null],
]) {
  const got = pinnedVersion(text);
  if (got === want) pass(`FROM line with ${label} reads as ${want ?? 'no pin'}`);
  else fail(`FROM line with ${label}: expected ${want ?? 'no pin'}, got ${got ?? 'no pin'}`);
}

// ── The pin ──────────────────────────────────────────────────────────
// A missing playwright dependency already fails the root Dockerfile check in
// test-all.mjs, so it is not reported a second time here.
const pkgPlaywright = JSON.parse(read('package.json')).dependencies?.playwright;
if (pkgPlaywright) {
  const pinned = pinnedVersion(read('tests/cv-visual/Dockerfile'));
  if (!pinned) {
    fail('tests/cv-visual/Dockerfile missing the expected "FROM mcr.microsoft.com/playwright:vX-<distro>@sha256:<digest>" line');
  } else if (pinned !== pkgPlaywright) {
    fail(`tests/cv-visual/Dockerfile's base image is playwright@${pinned} but package.json depends on playwright@${pkgPlaywright} — bump its tag and digest`);
  } else {
    pass(`tests/cv-visual/Dockerfile's base image (${pinned}) matches package.json`);
  }
}
