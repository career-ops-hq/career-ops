// tests/cli-flags.test.mjs — the shared value-taking-flag reader.
//
// The defect it exists to prevent is silent: `args.indexOf('--flag')` returns
// -1 for `--flag=value`, so the script runs with its default and reports a
// result for inputs nobody asked for. Verified on main before the fix:
// `process-quality --file=X` read the default tracker, `validate-portals
// --file=X` validated portals.yml, `detect-reposts --window=5` used 90 days.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncli-flags — value-taking flags in both forms');

try {
  const { flagValue, hasFlag } = await import(pathToFileURL(join(ROOT, 'lib/cli-flags.mjs')).href);

  const check = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} => ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };

  check('space-separated form', flagValue(['--file', 'a.md'], '--file'), 'a.md');
  check('equals form', flagValue(['--file=a.md'], '--file'), 'a.md');
  check('an absent flag is undefined', flagValue(['--summary'], '--file'), undefined);

  // `--file=` is a supplied-but-empty value, not an absent flag: a caller who
  // typed it made a mistake the script should be able to reject, and folding
  // it into undefined would hand them the default instead.
  check('an explicitly empty value is empty, not absent', flagValue(['--file='], '--file'), '');

  // A value may itself contain '=' — only the FIRST one separates.
  check('only the first = separates', flagValue(['--file=a=b.md'], '--file'), 'a=b.md');

  // A trailing flag with no value stays undefined rather than reading past the
  // end of argv.
  check('a trailing flag with no value is undefined', flagValue(['--file'], '--file'), undefined);

  // Prefix collisions must not match: --filename is not --file.
  check('a longer flag sharing the prefix does not match', flagValue(['--filename', 'x'], '--file'), undefined);
  check('the equals form respects the prefix boundary too', flagValue(['--filename=x'], '--file'), undefined);

  // The equals form wins when both appear: checking indexOf first would let the
  // space lookup shadow it, which is the bug in reverse.
  check('the equals form is found even after a bare flag', flagValue(['--file', 'space.md', '--file=eq.md'], '--file'), 'eq.md');

  // Defensive: a non-array argv (a caller passing null) yields undefined
  // rather than throwing inside a CLI's argument parsing.
  check('a non-array argv yields undefined', flagValue(null, '--file'), undefined);
  check('a non-string entry is skipped', flagValue([42, '--file=a.md'], '--file'), 'a.md');

  // hasFlag exists because flagValue cannot separate "absent" from "supplied
  // with no value" — both are undefined, and treating the second as absent is
  // how `test-all --only` came to run the whole suite instead of refusing a
  // filter it could not honour (CodeRabbit review).
  check('hasFlag sees the space form', hasFlag(['--only', 'x'], '--only'), true);
  check('hasFlag sees a bare trailing flag', hasFlag(['--only'], '--only'), true);
  check('hasFlag sees the equals form', hasFlag(['--only=x'], '--only'), true);
  check('hasFlag sees an explicitly empty value', hasFlag(['--only='], '--only'), true);
  check('hasFlag is false when absent', hasFlag(['--summary'], '--only'), false);
  check('hasFlag respects the prefix boundary', hasFlag(['--only-me'], '--only'), false);
  check('hasFlag on a non-array is false', hasFlag(null, '--only'), false);

  // validateFlags — the unrecognized-flag / --help shape hand-rolled
  // identically by scan-ats-full.mjs (#1633/#1635), reply-watch.mjs
  // (#2743/#2745) and dedup-tracker.mjs (#2744/#2746), consolidated here for
  // #2775 and reused as-is by scan.mjs's own fix (#2270).
  const { validateFlags } = await import(pathToFileURL(join(ROOT, 'lib/cli-flags.mjs')).href);

  // The all-valid path never calls process.exit, so it is safe to call
  // in-process and assert it simply returns.
  try {
    validateFlags(['--dry-run'], ['--dry-run', '--help', '-h'], 'usage');
    pass('a fully-valid args array returns normally, without exiting');
  } catch (e) {
    fail(`validateFlags threw on valid args: ${e.message}`);
  }
  try {
    validateFlags([], ['--dry-run', '--help', '-h'], 'usage');
    pass('an empty args array returns normally');
  } catch (e) {
    fail(`validateFlags threw on empty args: ${e.message}`);
  }

  // Everything that exits the process is spawned in a child process — a
  // direct in-process exit would kill this test runner too.
  const cliFlagsUrl = JSON.stringify(pathToFileURL(join(ROOT, 'lib/cli-flags.mjs')).href);
  const runValidate = (args, knownFlags, usage, options) => {
    const script = `
      const { validateFlags } = await import(${cliFlagsUrl});
      validateFlags(${JSON.stringify(args)}, ${JSON.stringify(knownFlags)}, ${JSON.stringify(usage)}${options ? `, ${JSON.stringify(options)}` : ''});
      console.log('REACHED-END');
    `;
    return spawnSync(NODE, ['--input-type=module', '-e', script], { encoding: 'utf-8', timeout: 15000 });
  };

  {
    const r = runValidate(['--bogus'], ['--help', '-h'], 'USAGE-TEXT');
    if (r.status === 1 && /unrecognized flag\(s\): --bogus\. Valid flags: --help, -h/.test(r.stderr || '') && !/REACHED-END/.test(r.stdout || '')) {
      pass('an unrecognized flag exits 1 with the expected error');
    } else {
      fail(`unrecognized-flag case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    const r = runValidate(['--help'], ['--help', '-h'], 'USAGE-TEXT');
    if (r.status === 0 && /USAGE-TEXT/.test(r.stdout || '')) {
      pass('--help prints usage and exits 0');
    } else {
      fail(`--help case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    const r = runValidate(['-h'], ['--help', '-h'], 'USAGE-TEXT');
    if (r.status === 0 && /USAGE-TEXT/.test(r.stdout || '')) {
      pass('-h prints usage and exits 0');
    } else {
      fail(`-h case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // Ordering: --help plus an unrecognized flag must still error, not exit 0
    // having never looked at the unrecognized flag (the CodeRabbit finding on
    // #2745/#2746).
    const r = runValidate(['--help', '--bogus'], ['--help', '-h'], 'USAGE-TEXT');
    if (r.status === 1 && /unrecognized flag\(s\): --bogus/.test(r.stderr || '') && !/USAGE-TEXT/.test(r.stdout || '')) {
      pass('--help plus an unrecognized flag still errors (unrecognized check runs before --help)');
    } else {
      fail(`--help + unrecognized order case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // valueFlags: a value that itself looks like a flag (a negative number)
    // must not be misread as an unrecognized flag.
    const r = runValidate(['--since', '-5'], ['--since', '--help', '-h'], 'USAGE-TEXT', { valueFlags: ['--since'] });
    if (r.status === 0 && /REACHED-END/.test(r.stdout || '')) {
      pass('a valueFlags-listed flag\'s negative-number-shaped value is not misread as unrecognized');
    } else {
      fail(`valueFlags negative-value case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // CodeRabbit (#2778): --dry-run=1 must NOT be accepted just because its
    // base flag --dry-run is known — --dry-run isn't in valueFlags, so the
    // `=value` form is meaningless to it, and every caller of validateFlags
    // checks `args.includes('--dry-run')`, which is false for the string
    // '--dry-run=1' — a silent way to run with zero dry-run protection.
    const r = runValidate(['--dry-run=1'], ['--dry-run', '--help', '-h'], 'USAGE-TEXT');
    if (r.status === 1 && /unrecognized flag\(s\): --dry-run=1/.test(r.stderr || '')) {
      pass('--dry-run=1 is rejected — a boolean flag not in valueFlags may not take =value (#2778)');
    } else {
      fail(`--dry-run=1 case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // CodeRabbit (#2778): the equals form of a genuine value-taking flag must
    // still be accepted, including a negative-number-shaped value.
    const r = runValidate(['--since=-5'], ['--since', '--help', '-h'], 'USAGE-TEXT', { valueFlags: ['--since'] });
    if (r.status === 0 && /REACHED-END/.test(r.stdout || '')) {
      pass('--since=-5 is accepted — the equals form of a valueFlags-listed flag (#2778)');
    } else {
      fail(`--since=-5 case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }
  {
    // CodeRabbit (#2961): with requireOperand, a value-taking flag whose operand
    // is MISSING is reported instead of --help silently winning. Without it,
    // `--since --help` prints usage and exits 0.
    const opts = { valueFlags: ['--since'], requireOperand: true };
    const r = runValidate(['--since', '--help'], ['--since', '--help', '-h'], 'USAGE-TEXT', opts);
    if (r.status === 1 && /--since requires a value/.test(r.stderr || '') && !/USAGE-TEXT/.test(r.stdout || '')) {
      pass('requireOperand: --since --help is a missing operand, not a help request (#2961)');
    } else {
      fail(`requireOperand before-help case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    const opts = { valueFlags: ['--since'], requireOperand: true };
    const r = runValidate(['--since'], ['--since', '--help', '-h'], 'USAGE-TEXT', opts);
    if (r.status === 1 && /--since requires a value/.test(r.stderr || '')) {
      pass('requireOperand: a value-taking flag ending argv reports its missing operand');
    } else {
      fail(`requireOperand end-of-argv case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // The guard that keeps this OPT-IN: without requireOperand the behaviour is
    // unchanged, so callers with richer validation of their own (scan.mjs tells
    // a missing value from a zero, a negative, a non-finite and a repeat) keep
    // reaching it.
    const r = runValidate(['--since'], ['--since', '--help', '-h'], 'USAGE-TEXT', { valueFlags: ['--since'] });
    if (r.status === 0 && /REACHED-END/.test(r.stdout || '')) {
      pass('without requireOperand a missing operand still falls through to the caller');
    } else {
      fail(`opt-in guard case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // Guard: plain --help still works when nothing is dangling.
    const opts = { valueFlags: ['--since'], requireOperand: true };
    const r = runValidate(['--help'], ['--since', '--help', '-h'], 'USAGE-TEXT', opts);
    if (r.status === 0 && /USAGE-TEXT/.test(r.stdout || '')) {
      pass('requireOperand: --help alone still prints usage and exits 0');
    } else {
      fail(`requireOperand help-alone case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // Guard: a negative-number operand is an operand, not a missing one — the
    // shape the adjacency rule exists for.
    const opts = { valueFlags: ['--since'], requireOperand: true };
    const r = runValidate(['--since', '-5'], ['--since', '--help', '-h'], 'USAGE-TEXT', opts);
    if (r.status === 0 && /REACHED-END/.test(r.stdout || '')) {
      pass('requireOperand: --since -5 passes through, a negative value is an operand');
    } else {
      fail(`requireOperand negative case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

  {
    // Guard: the equals form carries its own operand, even before --help.
    const opts = { valueFlags: ['--since'], requireOperand: true };
    const r = runValidate(['--since=7', '--help'], ['--since', '--help', '-h'], 'USAGE-TEXT', opts);
    if (r.status === 0 && /USAGE-TEXT/.test(r.stdout || '')) {
      pass('requireOperand: --since=7 --help shows help, the equals form is complete');
    } else {
      fail(`requireOperand equals-then-help case => status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    }
  }

} catch (e) {
  fail(`cli-flags tests crashed: ${e.message}`);
}
