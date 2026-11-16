// A private parser in the data root's local/ folder (#7152). A Claude Code
// plugin install replaces the code root on every update, so the provider also
// runs a parser from <DATA_ROOT>/local/, and only from there.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { fail, pass, pinSandboxDataRoot, rmSync, ROOT } from '../helpers.mjs';

console.log('\nProvider — local-parser in the data root\'s local/ folder');

const localParser = (await import(pathToFileURL(join(ROOT, 'providers/local-parser.mjs')).href)).default;

// Prints its own path and cwd as the job title, so a test can see which file
// ran and where.
const PARSER_SOURCE = `import { fileURLToPath } from 'url';\nconsole.log(JSON.stringify([{ title: fileURLToPath(import.meta.url) + '|' + process.cwd(), url: 'https://example.com/job' }]));\n`;

const base = realpathSync(mkdtempSync(join(tmpdir(), 'co-local-parser-data-root-')));
const dataRoot = join(base, 'data-root');
const outside = join(base, 'outside');
mkdirSync(join(dataRoot, 'local'), { recursive: true });
mkdirSync(join(dataRoot, 'data'), { recursive: true });
mkdirSync(outside, { recursive: true });
const localScript = join(dataRoot, 'local', 'acme-jobs.mjs');
writeFileSync(localScript, PARSER_SOURCE);
writeFileSync(join(dataRoot, 'data', 'saved-jd.mjs'), PARSER_SOURCE);
writeFileSync(join(outside, 'evil.mjs'), PARSER_SOURCE);

let symlinked = false;
try {
  symlinkSync(join(outside, 'evil.mjs'), join(dataRoot, 'local', 'linked.mjs'));
  symlinked = true;
} catch {
  // Windows without Developer Mode cannot create symlinks; that case is skipped.
}

const entry = (script) => ({
  name: 'Acme',
  careers_url: 'https://example.com/careers',
  parser: { command: 'node', script },
});

try {
  process.env.CAREER_OPS_ROOT = dataRoot;

  // 1. A parser under <DATA_ROOT>/local/ runs, by relative or absolute path.
  if (localParser.detect(entry('local/acme-jobs.mjs'))) {
    pass('detect() accepts a relative script that resolves under <DATA_ROOT>/local/');
  } else {
    fail('detect() rejected local/acme-jobs.mjs that exists only under <DATA_ROOT>/local/');
  }
  if (localParser.detect(entry(localScript))) {
    pass('detect() accepts an absolute script path under <DATA_ROOT>/local/');
  } else {
    fail('detect() rejected an absolute script path under <DATA_ROOT>/local/');
  }

  const jobs = await localParser.fetch(entry('local/acme-jobs.mjs'));
  const [ranPath, ranCwd] = String(jobs[0]?.title ?? '').split('|');
  // Compared through realpathSync.native: on Windows the module loader and
  // fs.realpathSync can spell one temp path with long and 8.3 short names.
  if (ranPath && realpathSync.native(ranPath) === realpathSync.native(localScript)) {
    pass('fetch() runs the data-root parser it validated');
  } else {
    fail(`fetch() ran ${JSON.stringify(ranPath)}, expected ${localScript}`);
  }
  if (ranCwd && realpathSync(ranCwd) === realpathSync(dataRoot)) {
    pass('fetch() runs a data-root parser with the data root as its cwd');
  } else {
    fail(`fetch() ran the data-root parser in ${JSON.stringify(ranCwd)}, expected ${dataRoot}`);
  }

  // An in-repo parser keeps running from the project root.
  const repoJobs = await localParser.fetch({
    careers_url: 'https://example.com/careers',
    parser: { command: 'node', script: 'tests/providers/_fixture-local-parser.mjs', args: ['echo'] },
  });
  if (repoJobs.length === 1) {
    pass('fetch() still runs an in-repo parser while a data root override is set');
  } else {
    fail(`fetch() returned ${repoJobs.length} jobs for the in-repo parser, expected 1`);
  }

  // 2. Only local/: never another folder in the data root.
  if (localParser.detect(entry('data/saved-jd.mjs')) === null
    && localParser.detect(entry(join(dataRoot, 'data', 'saved-jd.mjs'))) === null) {
    pass('detect() refuses a script elsewhere in the data root');
  } else {
    fail('detect() accepted a script in <DATA_ROOT>/data/, outside local/');
  }
  if (localParser.detect({ parser: { command: join(dataRoot, 'data', 'saved-jd.mjs') } }) === null) {
    pass('detect() refuses a path-style command elsewhere in the data root');
  } else {
    fail('detect() accepted a path-style command in <DATA_ROOT>/data/');
  }
  if (localParser.detect({ parser: { command: localScript } })) {
    pass('detect() accepts a path-style command under <DATA_ROOT>/local/');
  } else {
    fail('detect() rejected a path-style command under <DATA_ROOT>/local/');
  }
  if (localParser.detect(entry(join(outside, 'evil.mjs'))) === null) {
    pass('detect() refuses a script outside both roots');
  } else {
    fail('detect() accepted a script outside the project root and the data root');
  }

  // 3. The realpath check still refuses a symlink out of local/.
  if (symlinked) {
    if (localParser.detect(entry('local/linked.mjs')) === null) {
      pass('detect() refuses a symlink from <DATA_ROOT>/local/ to outside both roots');
    } else {
      fail('detect() followed a symlink out of <DATA_ROOT>/local/');
    }
  } else {
    pass('symlink case skipped: this platform could not create a symlink');
  }

  // 3b. A local/ folder that is itself a symlink out of the data root is not
  //     an allowed folder; one that points inside the data root still is.
  if (symlinked) {
    const linkedRoot = join(base, 'linked-local-root');
    mkdirSync(linkedRoot, { recursive: true });
    symlinkSync(outside, join(linkedRoot, 'local'), 'dir');
    process.env.CAREER_OPS_ROOT = linkedRoot;
    if (localParser.detect(entry('local/evil.mjs')) === null) {
      pass('detect() refuses a parser when <DATA_ROOT>/local is a symlink out of the data root');
    } else {
      fail('detect() accepted a parser through a local/ symlink that leaves the data root');
    }

    const innerRoot = join(base, 'inner-local-root');
    mkdirSync(join(innerRoot, 'parsers'), { recursive: true });
    writeFileSync(join(innerRoot, 'parsers', 'acme-jobs.mjs'), PARSER_SOURCE);
    symlinkSync(join(innerRoot, 'parsers'), join(innerRoot, 'local'), 'dir');
    process.env.CAREER_OPS_ROOT = innerRoot;
    if (localParser.detect(entry('local/acme-jobs.mjs'))) {
      pass('detect() accepts a parser when <DATA_ROOT>/local links to a folder inside the data root');
    } else {
      fail('detect() rejected a local/ symlink that stays inside the data root');
    }
    process.env.CAREER_OPS_ROOT = dataRoot;
  } else {
    pass('local/ symlink cases skipped: this platform could not create a symlink');
  }

  // 4. With the data root at the checkout (no override), nothing changes.
  process.env.CAREER_OPS_ROOT = ROOT;
  if (localParser.detect(entry(localScript)) === null) {
    pass('detect() refuses the other folder\'s parser when the data root is the checkout');
  } else {
    fail('detect() accepted a parser outside the checkout with no data root override');
  }

  // 5. A data root path-resolver refuses skips the data-root parser and leaves
  //    the in-repo one working.
  const pluginsDir = join(base, 'plugins');
  const refusedRoot = join(pluginsDir, 'cache', 'career-ops', 'career-ops', '1.0.0', 'data');
  mkdirSync(join(refusedRoot, 'local'), { recursive: true });
  writeFileSync(join(refusedRoot, 'local', 'acme-jobs.mjs'), PARSER_SOURCE);
  const savedCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginsDir;
  process.env.CAREER_OPS_ROOT = refusedRoot;
  try {
    if (localParser.detect(entry('local/acme-jobs.mjs')) === null) {
      pass('detect() skips a data-root parser when path-resolver refuses the data root');
    } else {
      fail('detect() ran a parser from a data root inside a plugin install copy');
    }
    if (localParser.detect(entry('tests/providers/_fixture-local-parser.mjs'))) {
      pass('detect() still accepts an in-repo parser when the data root is refused');
    } else {
      fail('a refused data root broke the in-repo parser');
    }
  } finally {
    if (savedCacheDir === undefined) delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
    else process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = savedCacheDir;
  }

  // 6. A data root with no local/ folder adds nothing.
  const bareRoot = join(base, 'bare-root');
  mkdirSync(bareRoot, { recursive: true });
  process.env.CAREER_OPS_ROOT = bareRoot;
  if (localParser.detect(entry('local/acme-jobs.mjs')) === null
    && localParser.detect(entry('tests/providers/_fixture-local-parser.mjs'))) {
    pass('a data root without local/ leaves only in-repo parsers runnable');
  } else {
    fail('a data root without local/ changed which parsers detect() accepts');
  }
} catch (e) {
  fail(`local-parser data-root tests crashed: ${e.message}`);
} finally {
  pinSandboxDataRoot();
  rmSync(base, { recursive: true, force: true });
}
