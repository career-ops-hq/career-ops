// tests/browser-extract-challenge.test.mjs — browser-extract.mjs refuses a
// Cloudflare challenge page in jd mode instead of emitting it as the JD.
//
// jdFailure() rejects only text below its length floor, and a site-branded
// challenge body clears it (#6713: 838 characters, "Humans only"), so the
// interstitial came back as `{ url, title, text }` with exit 0. pipeline and
// auto-pipeline use that text as the JD when `scan.extractor: cli` is set.
// Cloudflare titles the page itself, and archive-posting.mjs already refuses
// those titles on an HTTP error (#6724); jd mode now does the same and fails
// with `bot_challenge`.
//
// The CLI runs against a fake `playwright` (a module hook, as in
// tests/fixtures/playwright-stub.mjs) whose page answers with the status and
// DOM each case sets, so no case opens a browser or the network.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

console.log('\nbrowser-extract.mjs — a Cloudflare challenge page is not a JD');

const dir = mkdtempSync(join(tmpdir(), 'browser-extract-challenge-'));
const fake = join(dir, 'fake-playwright.mjs');
writeFileSync(fake, `
const page = JSON.parse(process.env.FAKE_PAGE);
const tab = {
  goto: async () => ({ status: () => page.status }),
  waitForTimeout: async () => {},
  url: () => page.url,
  evaluate: async () => page.raw,
};
export const chromium = {
  launch: async () => ({
    newContext: async () => ({ route: async () => {}, newPage: async () => tab }),
    close: async () => {},
  }),
};
`);
const hooks = join(dir, 'hooks.mjs');
writeFileSync(hooks, `
const FAKE = ${JSON.stringify(pathToFileURL(fake).href)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') return { url: FAKE, shortCircuit: true };
  return nextResolve(specifier, context);
}
`);
const register = join(dir, 'register.mjs');
writeFileSync(register, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);

const URL_ = 'https://careers.example.com/jobs/1';
// The page #6713 describes: Cloudflare's title, the site's own heading, and a
// body long enough to pass the 200-character floor.
const CHALLENGE_BODY = `Humans only\n\n${'Please wait while we check that your browser can reach careers.example.com securely. '.repeat(9)}\nRay ID: 8f2c0a1b2c3d4e5f`;
const JD_BODY = `Senior Platform Engineer\n\n${'You will own the infrastructure that runs our payments platform, from provisioning to deployment. '.repeat(5)}`;

function extract(status, pageTitle, h1, body) {
  const raw = { title: h1, text: body, anchors: [], jsonLdDescription: '', jsonLdTitle: '', bodyText: body, pageTitle };
  const r = spawnSync(NODE, ['--import', pathToFileURL(register).href, join(ROOT, 'browser-extract.mjs'), URL_], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, FAKE_PAGE: JSON.stringify({ status, url: URL_, raw }) },
  });
  // The error is the JSON line; newer Node versions add a deprecation warning
  // for module.register() after it.
  let error = null;
  try { error = JSON.parse(r.stderr.split('\n').find((l) => l.startsWith('{')) || 'null'); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, error };
}

try {
  for (const [status, title] of [[403, 'Just a moment...'], [503, 'Attention Required! | Cloudflare']]) {
    const r = extract(status, title, 'Humans only', CHALLENGE_BODY);
    if (r.status === 1 && r.stdout === '' && r.error?.code === 'bot_challenge') {
      pass(`HTTP ${status} "${title}" fails with bot_challenge instead of emitting the page as the JD`);
    } else {
      fail(`HTTP ${status} "${title}": exit ${r.status}, stdout ${JSON.stringify(r.stdout.slice(0, 120))}, error ${JSON.stringify(r.error)}`);
    }
  }

  // Only on an HTTP error, as in archive-posting: a challenge the browser
  // passes reloads the posting, and a real posting can be served with a 403.
  const passed = extract(200, 'Just a moment...', 'Humans only', CHALLENGE_BODY);
  if (passed.status === 0 && JSON.parse(passed.stdout || '{}').text) pass('a 200 page is not judged by its title');
  else fail(`a 200 page was refused: exit ${passed.status}, error ${JSON.stringify(passed.error)}`);

  const posting = extract(403, 'Senior Platform Engineer | Acme Careers', 'Senior Platform Engineer', JD_BODY);
  const emitted = posting.status === 0 ? JSON.parse(posting.stdout) : null;
  if (emitted?.text?.includes('payments platform') && !('pageTitle' in emitted)) {
    pass('a posting served with a 403 under its own title is still emitted, in the same { url, title, text } shape');
  } else {
    fail(`a 403 posting: exit ${posting.status}, stdout ${JSON.stringify(posting.stdout.slice(0, 160))}, error ${JSON.stringify(posting.error)}`);
  }
} catch (e) {
  fail(`browser-extract challenge test crashed: ${e.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
