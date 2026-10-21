// tests/test-all-sandbox.mjs — a temp directory holding the real test-all.mjs
// and a `tests/` of fixture suites, for the suites that test the runner itself.
//
// The runner is driven the way a contributor drives it, through its CLI. A copy
// of test-all.mjs and the modules it imports goes into a temp directory, so
// discovery, flag parsing, the child runners and the summary are all the real
// ones. The copy is built by following test-all.mjs's own static imports, so a
// module added to them tomorrow is copied tomorrow.
//
// Shared by tests/test-all-jobs.test.mjs and
// tests/test-all-inline-jobs.test.mjs, which would otherwise each carry a copy
// of the import walk and drift apart.
import { rmSync, linkRepoPackage, ROOT, NODE } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';

/** The helpers import line of a fixture suite `depth` directories below tests/. */
export const helpers = (depth) => `import { pass, fail, warn, QUICK } from '${'../'.repeat(depth)}helpers.mjs';`;

/** A fixture line that waits `ms`. */
export const sleep = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;

/**
 * Build a sandbox holding the real runner.
 *
 * @param {string} prefix - mkdtemp prefix under the OS temp directory.
 * @returns {{
 *   sandbox: string,
 *   copied: Set<string>,
 *   suite: (rel: string, body: string[]) => void,
 *   runner: (args: string[], env?: Record<string, string>) => {status: number|null, stdout: string, stderr: string, all: string, verdicts: string[], totals: string, timing: string},
 *   remove: () => void,
 * }}
 */
export function createRunnerSandbox(prefix) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const copied = new Set();

  /** Copy `entry` and everything it statically imports by relative path. */
  const copyWithImports = (entry) => {
    const queue = [entry];
    while (queue.length) {
      const rel = queue.pop();
      if (copied.has(rel)) continue;
      copied.add(rel);
      const from = join(ROOT, rel);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(sandbox, rel)), { recursive: true });
      copyFileSync(from, join(sandbox, rel));
      if (!rel.endsWith('.mjs')) continue;
      // Statements that start a line only: test-all.mjs also names modules
      // inside inline sections, and following those would copy most of the
      // repository.
      const src = readFileSync(from, 'utf-8');
      for (const m of src.matchAll(/^(?:import|export)\s[^'"\n]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        queue.push(normalize(join(dirname(rel), m[1])).split('\\').join('/'));
      }
    }
  };

  try {
    copyWithImports('test-all.mjs');
    copyWithImports('tests/run-discovered-child.mjs');
    linkRepoPackage(sandbox, 'js-yaml');
  } catch (err) {
    rmSync(sandbox, { recursive: true, force: true });
    throw err;
  }

  return {
    sandbox,
    copied,

    /** Write one fixture suite under the sandbox's tests/. */
    suite(rel, body) {
      const at = join(sandbox, 'tests', rel);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, body.join('\n') + '\n', 'utf-8');
    },

    /** Run the sandboxed runner. CAREER_OPS_TEST_JOBS is blank unless a case sets it. */
    runner(args, env = {}) {
      const r = spawnSync(NODE, [join(sandbox, 'test-all.mjs'), ...args], {
        cwd: sandbox,
        encoding: 'utf-8',
        timeout: 120_000,
        env: { ...process.env, CAREER_OPS_TEST_JOBS: '', ...env },
      });
      // The runner names a suite by its path relative to the repo, in the
      // platform's own spelling: `tests\order\a.test.mjs` on Windows. The
      // expectations are written once, with forward slashes, so the captured
      // output is brought to that spelling here. (The first Windows run of
      // test-all-jobs failed seven checks on exactly this, with the runner
      // itself behaving correctly.)
      const stdout = (r.stdout ?? '').replaceAll('\\', '/');
      const stderr = r.stderr ?? '';
      return {
        status: r.status,
        stdout,
        stderr,
        all: `${stdout}${stderr}`,
        // The lines a reader scans a run for, in the order they were printed.
        verdicts: stdout.split('\n').map((l) => l.trim()).filter((l) => /^(✅|❌|⚠️)/u.test(l)),
        totals: (stdout.match(/📊 Results: .*/u) ?? [''])[0],
        timing: (stdout.match(/⏱ {2}\d+ discovered suites in .*/u) ?? [''])[0],
      };
    },

    remove() {
      rmSync(sandbox, { recursive: true, force: true });
    },
  };
}
