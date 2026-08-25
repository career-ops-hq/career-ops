/**
 * cli-flags.mjs — shared CLI argv helpers.
 *
 * Two related but distinct defects, both born from scripts hand-rolling their
 * own argv parsing and independently getting it wrong the same way:
 *
 * `args.indexOf('--flag')` returns -1 for `--flag=value`, so a lookup written
 * that way silently DISCARDS the value the caller supplied and the script runs
 * with its default instead — reporting a result for inputs nobody asked for,
 * with no warning. That is the defect #2401 described for weekly-digest
 * (`--from=…` digesting the wrong week) and #2402 fixed there and in
 * company-history.mjs. `flagValue`/`hasFlag` are the shared fix.
 *
 * An unrecognized or mistyped flag (`--dryrun` instead of `--dry-run`)
 * silently falls through to default/live behavior instead of failing fast —
 * fixed independently, in the identical shape, in scan-ats-full.mjs
 * (#1633/#1635), reply-watch.mjs (#2743/#2745) and dedup-tracker.mjs
 * (#2744/#2746). `validateFlags` is that shape in one place (#2775).
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

/**
 * Reject an unrecognized CLI flag before it can fall through to default/live
 * behavior, then handle --help/-h.
 *
 * Three scripts hand-rolled this exact shape independently — scan-ats-full.mjs
 * (#1633/#1635), reply-watch.mjs (#2743/#2745), dedup-tracker.mjs
 * (#2744/#2746) — because an unrecognized or mistyped flag (e.g. `--dryrun`
 * for `--dry-run`) was silently ignored and the script ran with its default,
 * live behavior instead of failing fast. #2775 collects the pattern here so
 * the next script does not have to rediscover it; scan.mjs's own instance
 * (#2270 — `--help` triggered a full live scan) is fixed by calling this
 * directly rather than adding a fourth hand-rolled copy.
 *
 * Order matters: the unrecognized-flag check runs BEFORE the --help check.
 * CodeRabbit caught the reverse ordering as a bug on both #2745 and #2746 —
 * `--help --bogus` must still error, not exit 0 having never looked at
 * `--bogus` at all.
 *
 * @param {string[]} args - argv slice.
 * @param {string[]} knownFlags - Every flag name this script accepts,
 *   leading dashes included (e.g. `['--dry-run', '--help', '-h']`).
 * @param {string} usage - Usage text printed for `--help`/`-h`.
 * @param {{valueFlags?: string[]}} [options] - `valueFlags` lists flags whose
 *   space-separated value is the NEXT argv token (e.g. `--since 7`). Without
 *   this, a value that itself starts with `-` (e.g. `--since -5`, a negative
 *   day count) would be misread as an unrecognized flag rather than left for
 *   the caller's own value validation to reject with a clearer message.
 *   `--flag=value` is self-contained and never needs to be listed.
 * @returns {void} Returns normally when every flag is recognized and --help
 *   was not requested; otherwise prints and calls `process.exit()`.
 */
export function validateFlags(args, knownFlags, usage, { valueFlags = [], requireOperand = false } = {}) {
  if (!Array.isArray(args)) return;

  // A value-taking flag's space-separated value (e.g. the `-5` in
  // `--since -5`) must not be mistaken for an unrecognized flag just because
  // it happens to start with `-`. Mirrors scan-ats-full.mjs's own adjacency
  // rule: only a token that does NOT start with `--` is treated as a value,
  // so a genuinely missing operand (next token is itself a flag) still falls
  // through to the caller's own "requires a value" check.
  const consumedValueIndices = new Set();
  args.forEach((a, idx) => {
    if (valueFlags.includes(a) && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) {
      consumedValueIndices.add(idx + 1);
    }
  });

  const unknownFlags = args.filter((a, idx) => {
    if (typeof a !== 'string' || !a.startsWith('-') || consumedValueIndices.has(idx)) return false;
    const flag = a.split('=')[0];
    return !knownFlags.includes(flag) || (a.includes('=') && !valueFlags.includes(flag));
  });
  if (unknownFlags.length > 0) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${knownFlags.join(', ')}`);
    process.exit(1);
  }

  // OPT-IN (`requireOperand`): a value-taking flag whose operand is MISSING is a
  // usage error, caught BEFORE --help — otherwise `--min-score --help` prints
  // usage and exits 0, the malformed flag is never reported, and the caller's
  // own value validation never runs (#2961). Same ordering argument as the
  // unrecognized-flag check above.
  //
  // Opt-in rather than automatic because several callers already validate this
  // themselves and say more than a generic message can. scan.mjs's requireValue()
  // distinguishes "no value" from a zero, a negative, a non-finite, an
  // out-of-range cutoff and a repeated flag; firing here first would replace all
  // five diagnostics with one line. Callers with nothing better to say opt in.
  //
  // Missing means: nothing follows, or what follows is another `--flag`. A token
  // starting with a single `-` is left alone — that is the negative-number shape
  // the adjacency rule above exists for (`--since -5`). The `--flag=value` form
  // carries its own operand and is never considered here.
  const missingOperand = requireOperand ? args.filter((a, idx) => {
    if (typeof a !== 'string' || !valueFlags.includes(a)) return false;
    const next = args[idx + 1];
    return next === undefined || (typeof next === 'string' && next.startsWith('--'));
  }) : [];
  if (missingOperand.length > 0) {
    // Wording matches scan.mjs's own hand-rolled requireValue() (scan.mjs:2345),
    // which already reports exactly this condition, so a caller that later
    // switches to this path keeps the message its tests assert on.
    console.error(`Error: ${missingOperand[0]} requires a value`);
    process.exit(1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
}
