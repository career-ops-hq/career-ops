// tests/runner-env-data-root.test.mjs — the model runners read the data root's
// .env, where doctor.mjs, remember-cli.mjs, scan.mjs and the plugin engine read
// it (#4688). gemini-eval, ollama-eval, openai-eval, openai-tailor and
// batch-evaluate-gemini read only the working directory's .env, so with a
// separate data folder the keys in its .env never reached them.
//
// Each runner starts in an empty working directory, with CAREER_OPS_ROOT
// pointing at a data root whose .env holds one setting the runner acts on
// before any network request: an invalid value it rejects by name, or an API
// key whose absence it reports.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

console.log('\nModel runners — .env is read from the data root');

// dotenv keeps a variable that is already set, even to '', so an inherited
// setting would hide the file under test: these are removed, not blanked.
const OWNED = /^(GEMINI_|OPENAI_|OLLAMA_|OPENROUTER_|CAREER_OPS_)/;

const CONTEXT = { 'cv.md': '# CV\n', 'modes/_profile.md': '# Profile\n', 'config/profile.yml': 'candidate:\n  full_name: Test\n' };

/**
 * Run `script` from an empty working directory against a fresh data root.
 * @param {{ rootEnv?: string, cwdEnv?: string, args?: (root: string) => string[] }} opts
 */
function runner(script, { rootEnv, cwdEnv, args = () => [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'runner-env-root-'));
  const cwd = mkdtempSync(join(tmpdir(), 'runner-env-cwd-'));
  try {
    for (const [rel, body] of Object.entries(CONTEXT)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    if (rootEnv !== undefined) writeFileSync(join(root, '.env'), rootEnv);
    if (cwdEnv !== undefined) writeFileSync(join(cwd, '.env'), cwdEnv);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !OWNED.test(k)));
    env.CAREER_OPS_ROOT = root;
    const r = spawnSync(NODE, [join(ROOT, script), ...args(root)], {
      cwd, env, encoding: 'utf8', input: '', timeout: 60000,
    });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

function check(label, result, ok, detail) {
  if (ok) pass(label);
  else fail(`${label} — ${detail}: exit ${result.status}\n${result.out.slice(0, 600)}`);
}

const JD = 'Senior Platform Engineer at Acme. Build and run the payments APIs.';

{
  const r = runner('ollama-eval.mjs', { rootEnv: 'OLLAMA_NUM_CTX=not-a-number\n', args: () => [JD] });
  check('ollama-eval reads OLLAMA_NUM_CTX from the data root .env', r,
    r.status === 1 && r.out.includes('Invalid OLLAMA_NUM_CTX: "not-a-number"'), 'the data root value was not read');
}

{
  const r = runner('openai-eval.mjs', { rootEnv: 'OPENAI_BASE_URL=not-a-url\n', args: () => [JD] });
  check('openai-eval reads OPENAI_BASE_URL from the data root .env', r,
    r.status === 1 && r.out.includes('Invalid OPENAI_BASE_URL: "not-a-url"'), 'the data root value was not read');
}

{
  const r = runner('openai-tailor.mjs', {
    rootEnv: 'OPENAI_BASE_URL=not-a-url\n',
    args: (root) => {
      writeFileSync(join(root, 'jd.txt'), JD);
      writeFileSync(join(root, 'report.md'), '# Report\n');
      return ['--jd', join(root, 'jd.txt'), '--report', join(root, 'report.md')];
    },
  });
  check('openai-tailor reads OPENAI_BASE_URL from the data root .env', r,
    r.status === 1 && r.out.includes('Invalid OPENAI_BASE_URL: "not-a-url"'), 'the data root value was not read');
}

{
  // --context-only prints the assembled context and exits before any request,
  // but only once the key check has passed.
  const r = runner('gemini-eval.mjs', { rootEnv: 'GEMINI_API_KEY=key-from-the-data-root\n', args: () => ['--context-only', JD] });
  check('gemini-eval finds GEMINI_API_KEY in the data root .env', r,
    r.status === 0 && !r.out.includes('GEMINI_API_KEY not found'), 'the key was not found');
}

{
  // With the key found, an empty data root stops at "no pipeline" before any request.
  const r = runner('batch-evaluate-gemini.mjs', { rootEnv: 'GEMINI_API_KEY=key-from-the-data-root\n' });
  check('batch-evaluate-gemini finds GEMINI_API_KEY in the data root .env', r,
    r.status === 0 && r.out.includes('No pipeline.md found.'), 'the key was not found');
}

{
  // The working directory's .env is still read, and the data root's wins over it.
  const cwdOnly = runner('ollama-eval.mjs', { cwdEnv: 'OLLAMA_NUM_CTX=from-the-cwd\n', args: () => [JD] });
  check('a .env in the working directory is still read', cwdOnly,
    cwdOnly.out.includes('Invalid OLLAMA_NUM_CTX: "from-the-cwd"'), 'the working directory value was not read');
  const both = runner('ollama-eval.mjs', { rootEnv: 'OLLAMA_NUM_CTX=from-the-root\n', cwdEnv: 'OLLAMA_NUM_CTX=from-the-cwd\n', args: () => [JD] });
  check('the data root .env wins over the working directory one', both,
    both.out.includes('Invalid OLLAMA_NUM_CTX: "from-the-root"'), 'the data root value did not win');
}
