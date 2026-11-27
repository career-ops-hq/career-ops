// tests/validate-profile-flags.test.mjs — validate-profile.mjs checks the file
// it was pointed at, in either flag spelling, and says so when it cannot.
//
// The `--profile` lookup used `indexOf('--profile')`, which is -1 for
// `--profile=path`. The `=` spelling validated the default profile instead (or,
// on a root with none, printed "nothing to validate" and exited 0), so a
// profile that does not parse read as clean. A mistyped flag (`--jsno`) was
// ignored the same way, and so was a `--profile` path that does not exist: the
// usage-error exit the header documents (1) was never taken.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'validate-profile-flags-'));
try {
  const emptyRoot = join(dir, 'empty-root');
  mkdirSync(join(emptyRoot, 'config'), { recursive: true });
  const broken = join(dir, 'broken.yml');
  writeFileSync(broken, 'candidate: [unclosed\n  full_name: "Alex Doe\n');
  const fine = join(dir, 'fine.yml');
  writeFileSync(fine, 'candidate:\n  full_name: "Alex Doe"\n');

  const run = (...args) => {
    const r = spawnSync(NODE, [join(ROOT, 'validate-profile.mjs'), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: emptyRoot, CAREER_OPS_PROFILE: '' },
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };

  console.log('\nvalidate-profile — --profile in both spellings');

  ok('premise: the space form exits 2 on a profile that does not parse', () => {
    const r = run('--profile', broken);
    assert.strictEqual(r.status, 2, `exit ${r.status}\n${r.out}${r.err}`);
  });

  ok('the `=` form exits 2 on the same profile', () => {
    const r = run(`--profile=${broken}`);
    assert.strictEqual(r.status, 2, `exit ${r.status}: the file was never read\n${r.out}${r.err}`);
  });

  ok('--json reports the file it read, in both spellings', () => {
    for (const args of [['--profile', fine, '--json'], [`--profile=${fine}`, '--json']]) {
      const r = run(...args);
      assert.strictEqual(r.status, 0, `${args.join(' ')}: exit ${r.status}\n${r.err}`);
      assert.strictEqual(JSON.parse(r.out).profile, fine, `${args.join(' ')}: validated another file`);
    }
  });

  console.log('\nvalidate-profile — bad invocations stop the run');

  ok('a --profile path that does not exist is a usage error, not "nothing to validate"', () => {
    for (const args of [['--profile', join(dir, 'typo.yml')], [`--profile=${join(dir, 'typo.yml')}`]]) {
      const r = run(...args);
      assert.strictEqual(r.status, 1, `${args.join(' ')}: exit ${r.status}\n${r.out}${r.err}`);
      assert.match(r.err, /typo\.yml/, r.err);
    }
  });

  ok('--profile with no value is a usage error', () => {
    for (const args of [['--profile'], ['--profile='], ['--profile', '--json']]) {
      const r = run(...args);
      assert.strictEqual(r.status, 1, `${args.join(' ')}: exit ${r.status}\n${r.out}`);
      assert.match(r.err, /requires a value/, r.err);
    }
  });

  ok('an unknown flag is a usage error', () => {
    const r = run('--jsno');
    assert.strictEqual(r.status, 1, `exit ${r.status}\n${r.out}`);
    assert.match(r.err, /unrecognized flag\(s\): --jsno/, r.err);
  });

  ok('no flag and no profile at the default path still exits 0', () => {
    const r = run();
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.err}`);
    assert.match(r.out, /nothing to validate/, r.out);
  });

  ok('--help still prints usage and exits 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = run(flag);
      assert.strictEqual(r.status, 0, `${flag}: exit ${r.status}\n${r.err}`);
      assert.match(r.out, /Usage: node validate-profile\.mjs/, r.out);
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
