// Awards carry authorship credentials too: an RFC Contributor must not become
// its Author just because the RFC number is mentioned in the source (#1411).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyFacts } from '../verify-cv-facts.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'cv-award-facts-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const source = join(tmp, 'cv.md');
writeFileSync(source, `# Jane Doe
## Standards
Contributor — RFC 9999, Example Benchmarking Terminology
## Awards
Gold Medal, Example Programming Contest
`);
const options = { sourcePaths: [source], configPath: join(tmp, 'absent.json') };
function build(title) {
  const input = join(tmp, 'input.json');
  const output = join(tmp, 'cv.html');
  writeFileSync(input, JSON.stringify({
    candidate: { name: 'Jane Doe' }, summary: 'Engineer.',
    experience: [], skills: [], education: [], awards: [{ title }],
  }));
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../build-cv-html.mjs', import.meta.url)), input, output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  return readFileSync(output, 'utf8');
}
for (const title of [
  'Contributor — RFC 9999, Example Benchmarking Terminology',
  'Gold Medal, Example Programming Contest',
]) test(`source-backed award passes: ${title}`, () => {
  assert.equal(verifyFacts(build(title), options).verdict, 'pass');
});
for (const title of [
  'Author — RFC 9999, Example Benchmarking Terminology',
  'Author — RFC 9998, Example Benchmarking Methodology',
  'Example Industry Award',
]) test(`unsupported award blocks: ${title}`, () => {
  const result = verifyFacts(build(title), options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'award'), true);
});
test('explicit allow_facts supports a user-confirmed award', () => {
  const configPath = join(tmp, 'allow.json');
  writeFileSync(configPath, JSON.stringify({ allow_facts: ['Example Industry Award'] }));
  assert.equal(verifyFacts(build('Example Industry Award'), { ...options, configPath }).verdict, 'pass');
});
test('formatting inside an award preserves the credential', () => {
  const result = verifyFacts('<span class="award-title">Author — RFC <span style="white-space:nowrap">9999</span>, Example Benchmarking Terminology</span>', options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'award'), true);
});
