/**
 * cli-flags.mjs — reading a value-taking CLI flag in BOTH accepted forms.
 *
 * `args.indexOf('--flag')` returns -1 for `--flag=value`, so a lookup written
 * that way silently DISCARDS the value the caller supplied and the script runs
 * with its default instead — reporting a result for inputs nobody asked for,
 * with no warning. That is the defect #2401 described for weekly-digest
 * (`--from=…` digesting the wrong week) and #2402 fixed there and in
 * company-history.mjs; this module is the same semantics in one place, so the
 * next script does not have to rediscover it.
 */

/**
 * Value of a value-taking flag, accepting both `--flag value` and
 * `--flag=value`.
 *
 * @param {string[]} args - argv slice.
 * @param {string} flag - Flag name including leading dashes, e.g. '--file'.
 * @returns {string|undefined} The value, or undefined when the flag is absent.
 */
export function flagValue(args, flag) {
  if (!Array.isArray(args)) return undefined;
  // `--flag=value` first: indexOf() cannot see it, so checking it second would
  // let the space-separated lookup fall through and drop the value.
  const eq = args.find((a) => typeof a === 'string' && a.startsWith(`${flag}=`));
  if (eq !== undefined) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * Whether the flag appears at all, in either form.
 *
 * `flagValue` alone cannot tell an ABSENT flag from one supplied without a
 * value: both give `undefined`. A caller that treats the second as absent
 * silently falls back to its default — for `test-all --only` that meant
 * running the whole suite instead of refusing a filter it could not honour.
 * Pair the two whenever a missing value must be a usage error.
 *
 * @param {string[]} args - argv slice.
 * @param {string} flag - Flag name including leading dashes.
 * @returns {boolean}
 */
export function hasFlag(args, flag) {
  if (!Array.isArray(args)) return false;
  return args.some((a) => typeof a === 'string' && (a === flag || a.startsWith(`${flag}=`)));
}
