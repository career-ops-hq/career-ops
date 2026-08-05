// tests/cli-flags.test.mjs — the shared value-taking-flag reader.
//
// The defect it exists to prevent is silent: `args.indexOf('--flag')` returns
// -1 for `--flag=value`, so the script runs with its default and reports a
// result for inputs nobody asked for. Verified on main before the fix:
// `process-quality --file=X` read the default tracker, `validate-portals
// --file=X` validated portals.yml, `detect-reposts --window=5` used 90 days.
import { pass, fail, ROOT } from './helpers.mjs';
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
} catch (e) {
  fail(`cli-flags tests crashed: ${e.message}`);
}
