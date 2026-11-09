/**
 * updater-batched-checkout.test.mjs — apply() checked system paths out one git
 * process per manifest entry (~360 per update). checkoutSystemPathsBatched()
 * plans the skips from one listing of the target tree and checks the rest out
 * in a few argv-bounded runs; apply() falls back to the per-path loop if any
 * run fails.
 *
 * Driven against a throwaway repo through the ctx `git` seam, the same way
 * updater-local-system-edits.test.mjs drives the per-path rules.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { planSystemCheckout, checkoutSystemPathsBatched } from '../update-system.mjs';

// update-system.mjs's ARGV_BUDGET: what one git call may put on the command line.
const ARGV_BUDGET = 8000;

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture that cannot be removed must not change the suite's verdict.
    }
  }
});

const check = (ok, name, detail = '') => (ok ? pass(name) : fail(detail ? `${name} — ${detail}` : name));

// --- planning from the tree listing ----------------------------------------
{
  const upstream = ['modes/a.md', 'modes/b.md', 'docs/x.md', 'kept/only.md', 'tool.mjs', 'pinned.mjs'];
  const plan = planSystemCheckout(
    ['modes/', 'docs/', 'gone/', 'kept/', 'tool.mjs', 'removed.mjs', 'pinned.mjs'],
    ['modes/b.md', 'kept/only.md', 'pinned.mjs'],
    upstream,
  );
  check(JSON.stringify(plan.checkout) === JSON.stringify(['modes/', 'docs/', 'tool.mjs']),
    'paths with upstream content left to check out are batched, a partly preserved directory included', JSON.stringify(plan));
  check(JSON.stringify(plan.absent) === JSON.stringify(['gone/', 'removed.mjs']),
    'a directory or file absent from the target tree is the absent-upstream skip', JSON.stringify(plan));
  check(JSON.stringify(plan.preserved) === JSON.stringify(['kept/', 'pinned.mjs']),
    'a directory whose upstream files are all preserved, and a preserved file, are skipped', JSON.stringify(plan));

  const prefix = planSystemCheckout(['mode/'], [], ['modes/a.md']);
  check(JSON.stringify(prefix.absent) === JSON.stringify(['mode/']), 'a name prefix is not a parent directory', JSON.stringify(prefix));
}

// --- the batched checkout on a real repo ------------------------------------
function makeRepo(fileCount) {
  const { dir, g } = makeUpdaterRepo({ prefix: 'co-batched-checkout-' });
  fixtures.push(dir);
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const file = `lib/module-${String(i).padStart(4, '0')}-${'with-a-long-name-'.repeat(3)}.mjs`;
    writeFileSync(join(dir, file), `old ${i}\n`);
    files.push(file);
  }
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'old pdf\n');
  writeFileSync(join(dir, 'modes', 'mine.md'), 'old mine\n');
  g('add', '-A');
  g('commit', '-qm', 'installed');
  const installed = g('rev-parse', 'HEAD');
  for (let i = 0; i < fileCount; i++) writeFileSync(join(dir, files[i]), `new ${i}\n`);
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'new pdf\n');
  writeFileSync(join(dir, 'modes', 'mine.md'), 'new mine\n');
  g('add', '-A');
  g('commit', '-qm', 'upstream');
  const target = g('rev-parse', 'HEAD');
  g('checkout', '-q', installed);
  // The user's own edit to a file the update keeps out.
  writeFileSync(join(dir, 'modes', 'mine.md'), 'my edit\n');
  const upstreamFiles = g('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(Boolean);
  return { dir, g, files, target, upstreamFiles };
}

{
  // 300 long file entries: well past one argv budget, so this also covers the runs.
  const fx = makeRepo(300);
  const calls = [];
  const git = (...args) => { calls.push(args); return fx.g(...args); };
  const updatePaths = [...fx.files, 'modes/', 'gone/'];
  const result = checkoutSystemPathsBatched(updatePaths, ['modes/mine.md'], fx.upstreamFiles, fx.target, { git });

  const checkouts = calls.filter((a) => a.includes('checkout'));
  check(checkouts.length >= 2 && checkouts.length <= 5,
    `${updatePaths.length} manifest entries take ${checkouts.length} checkout runs, not one each`);
  check(checkouts.every((a) => a.join(' ').length <= ARGV_BUDGET), 'every run stays within the argv budget');
  check(checkouts.every((a) => !a.some((x) => x.startsWith(':(exclude)'))), 'no run carries an exclusion');
  check(checkouts.some((a) => a.includes('modes/pdf.md')) && !checkouts.some((a) => a.includes('modes/mine.md') || a.includes('modes/')),
    'a directory with a preserved file is named file by file, without the preserved one');
  check(checkouts.every((a) => a[0] === '--literal-pathspecs'), 'every run reads its paths literally');
  check(JSON.stringify(result.skipped) === JSON.stringify(['gone/']), 'the path absent upstream is reported as skipped', JSON.stringify(result.skipped));
  check(result.updated.length === fx.files.length + 1, 'every other path is reported updated');
  check(readFileSync(join(fx.dir, fx.files[0]), 'utf-8') === 'new 0\n' && readFileSync(join(fx.dir, fx.files[299]), 'utf-8') === 'new 299\n',
    'files in the first and last run are at the target version');
  check(readFileSync(join(fx.dir, 'modes', 'pdf.md'), 'utf-8') === 'new pdf\n', 'a directory entry is checked out');
  check(readFileSync(join(fx.dir, 'modes', 'mine.md'), 'utf-8') === 'my edit\n', "the preserved file keeps the user's edit");
  check(!existsSync(join(fx.dir, 'gone')), 'nothing is created for the absent path');
}

{
  // Hundreds of long preserved files: the exclusions are counted in each run's
  // budget, so no run outgrows the command line, and they still apply.
  const fx = makeRepo(200);
  const { g } = fx;
  g('checkout', '-q', '--', 'modes/mine.md'); // the fixture's local edit; not part of this case
  g('checkout', '-q', fx.target);
  mkdirSync(join(fx.dir, 'kept'), { recursive: true });
  const preserved = [];
  for (let i = 0; i < 300; i++) {
    const file = `kept/preserved-${String(i).padStart(3, '0')}-${'a-long-preserved-template-name-'.repeat(2)}.html`;
    writeFileSync(join(fx.dir, file), `upstream ${i}\n`);
    preserved.push(file);
  }
  writeFileSync(join(fx.dir, 'kept', 'shipped.html'), 'upstream shipped\n');
  g('add', '-A');
  g('commit', '-qm', 'upstream adds kept/');
  const target = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'HEAD~2');
  mkdirSync(join(fx.dir, 'kept'), { recursive: true });
  for (const file of preserved) writeFileSync(join(fx.dir, file), 'the user\'s own\n');
  const upstreamFiles = g('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(Boolean);
  const calls = [];
  const git = (...args) => { calls.push(args); return g(...args); };
  checkoutSystemPathsBatched([...fx.files, 'kept/'], preserved, upstreamFiles, target, { git });
  const checkouts = calls.filter((a) => a.includes('checkout'));
  const longest = Math.max(...checkouts.map((a) => a.join(' ').length));
  check(longest <= ARGV_BUDGET, `with ${preserved.length} preserved files every run stays within the argv budget`, `longest run ${longest} chars`);
  check(readFileSync(join(fx.dir, 'kept', 'shipped.html'), 'utf-8') === 'upstream shipped\n', 'the unpreserved file in that directory is checked out');
  check(preserved.every((file) => readFileSync(join(fx.dir, file), 'utf-8') === "the user's own\n"), 'every preserved file keeps its local content');
  check(readFileSync(join(fx.dir, fx.files[199]), 'utf-8') === 'new 199\n', 'the other paths are checked out too');
}

{
  // A directory with nothing preserved under it stays one `dir/` pathspec, and
  // --literal-pathspecs still matches it as a directory.
  const fx = makeRepo(3);
  const calls = [];
  const git = (...args) => { calls.push(args); return fx.g(...args); };
  const result = checkoutSystemPathsBatched(['lib/'], [], fx.upstreamFiles, fx.target, { git });
  const run = calls.find((a) => a.includes('checkout'));
  check(run && run.includes('lib/') && run[0] === '--literal-pathspecs', 'an unpreserved directory goes out as one literal dir/ pathspec', JSON.stringify(run));
  check(fx.files.every((file, i) => readFileSync(join(fx.dir, file), 'utf-8') === `new ${i}\n`) && result.updated[0] === 'lib/',
    'every file under that directory is at the target version');
}

{
  // A run that fails reports every path it had started, for the caller's restore.
  const fx = makeRepo(300);
  let runs = 0;
  const git = (...args) => {
    if (args.includes('checkout') && ++runs === 2) throw new Error('simulated failure on the second run');
    return fx.g(...args);
  };
  const attempted = [];
  let threw = false;
  try {
    checkoutSystemPathsBatched(fx.files, [], fx.upstreamFiles, fx.target, { git, attempted });
  } catch {
    threw = true;
  }
  check(threw, 'a failed run throws, so apply() falls back to the per-path loop');
  check(attempted.length > 0 && attempted.length < fx.files.length && attempted[0] === fx.files[0],
    'attempted holds the paths of every run started, the failed one included', `${attempted.length} of ${fx.files.length}`);
}
