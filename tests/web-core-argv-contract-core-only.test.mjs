// The updater ships tests/ without web/. Keep the core-only behavior covered
// independently from the full checkout's argv probes.
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { join } from 'path';

console.log('\nweb → core argv contract in a core-only install (#4165)');

const moduleUrl = pathToFileURL(join(ROOT, 'tests', 'web-core-argv-contract.test.mjs')).href;
const probe = [
  "import { mkdtempSync, rmSync } from 'fs';",
  `import { verifyWebStaticSources } from ${JSON.stringify(moduleUrl)};`,
  `const root = mkdtempSync(${JSON.stringify(join(tmpdir(), 'co-web-argv-core-only-'))});`,
  'const messages = [];',
  'try {',
  '  const result = verifyWebStaticSources({ root, reportPass: (message) => messages.push(message), reportFail: (message) => messages.push(`FAIL: ${message}`) });',
  "  if (!result.skipped || messages.some((message) => message.startsWith('FAIL:'))) throw new Error(`expected a clean core-only skip, got ${JSON.stringify({ result, messages })}`);",
  "  console.log('core-only static check skipped cleanly');",
  '} finally {',
  '  rmSync(root, { recursive: true, force: true });',
  '}',
].join('\n');

const out = run(NODE, ['--input-type=module', '--eval', probe], {
  env: { ...process.env, CAREER_OPS_WEB_ARGV_CONTRACT_STATIC_ONLY: '1' },
});
if (out?.includes('core-only static check skipped cleanly')) {
  pass('web argv static contract skips cleanly when the updater omits web/ (#4165)');
} else {
  const detail = lastRunFailure();
  fail(
    `web argv core-only regression probe failed: ${(detail?.stderr || detail?.stdout || 'missing success marker').trim()}`,
  );
}
