// keyword-match.mjs --url must not call process.exit() once the posting has
// been requested: on Windows, Node 24 aborts on process.exit() right after a
// request (nodejs/node#56645, the crash in #3788; discover-ats.mjs and
// fetch-jd.mjs avoid it the same way). Every refusal after the request
// (the JD could not be read, it names no known skill, the CV is missing) ended
// in process.exit(1). The preload stubs fetch and turns any process.exit()
// call into exit 99, which fails on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POSTING = 'https://job-boards.greenhouse.io/fictionalco/jobs/4001';

const greenhouseJob = (prose) => JSON.stringify({
  id: 4001,
  title: 'Platform Engineer',
  absolute_url: POSTING,
  location: { name: 'Remote' },
  content: `&lt;p&gt;${prose}&lt;/p&gt;`,
});
const WITH_SKILLS = greenhouseJob('You will build data services in Python and PostgreSQL, deploy them on Kubernetes, '
  + 'and keep them observable. '.repeat(4) + 'We value clear writing and steady delivery over heroics. '.repeat(4));
const WITHOUT_SKILLS = greenhouseJob('You will help a friendly team do good work for customers every day, '
  + 'listen carefully, and keep promises. '.repeat(6));

// `answer` is the Greenhouse API response: a status, and a body for a 200.
function runMatch({ answer, cv = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'keyword-match-exit-'));
  try {
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
let requests = 0;
const answer = ${JSON.stringify(answer)};
globalThis.fetch = async () => {
  requests++;
  return new Response(answer.body ?? '', { status: answer.status, headers: { 'content-type': 'application/json' } });
};
process.on('exit', () => { if (requests === 0) writeSync(2, 'no posting request was made\\n'); });
`);
    if (cv) writeFileSync(join(dir, 'cv.md'), '# CV\n\n## Skills\nPython, Kubernetes, Terraform\n');
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    delete env.CAREER_OPS_DATA_DIR;
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'keyword-match.mjs'),
      '--url', POSTING, '--json'], { cwd: dir, encoding: 'utf8', timeout: 20000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a posting whose JD cannot be read exits 1 with the reason, without calling process.exit', () => {
  const result = runMatch({ answer: { status: 404 } });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'Could not read JD text from that link via a known ATS API. '
    + 'Provide a direct posting URL that serves JD text, or pass --jd-text <file>.');
});

test('a JD that names no known skill exits 1 with the reason, without calling process.exit', () => {
  const result = runMatch({ answer: { status: 200, body: WITHOUT_SKILLS } });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stderr, /^No known skills found in JD text from https:\/\/job-boards\.greenhouse\.io\/fictionalco\/jobs\/4001\./);
  assert.doesNotMatch(result.stderr, /process\.exit called|no posting request/, describeSpawn(result));
});

test('a missing CV after the request exits 1 with the reason, without calling process.exit', () => {
  const result = runMatch({ answer: { status: 200, body: WITH_SKILLS }, cv: false });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stderr, /^CV not found: .*cv\.md\. Pass --cv <path> to point at your CV\.$/m);
  assert.doesNotMatch(result.stderr, /process\.exit called|no posting request/, describeSpawn(result));
});

test('a readable JD and CV still score and exit 0', () => {
  const result = runMatch({ answer: { status: 200, body: WITH_SKILLS } });
  assert.equal(result.status, 0, describeSpawn(result));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.keywordSource, 'url');
  assert.ok(payload.present.includes('Python') && payload.present.includes('Kubernetes'), result.stdout);
  assert.ok(payload.missing.includes('PostgreSQL'), result.stdout);
  assert.doesNotMatch(result.stderr, /process\.exit called|no posting request/, describeSpawn(result));
});
