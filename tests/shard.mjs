/**
 * shard.mjs — split a full test-all run across machines (`--shard i/n`).
 *
 * A full run is CPU-bound: about 1,430 discovered suites, each in its own
 * process, four at a time on a hosted runner. On Windows that is ~17 minutes
 * and on macOS ~12, so the merge queue waits for the slowest leg. Split n
 * ways, each machine runs about 1/n of the suites.
 *
 * The split is a pure function of the discovered list, which is sorted the
 * same way on every OS (#1440): shard i takes every n-th suite starting at
 * the i-th. Interleaving, not contiguous blocks, because neighbours in that
 * order are alike (all the updater-* suites are slow, all the cv-section-*
 * ones quick) and a block would hand one shard all of them. Every suite is in
 * exactly one shard: tests/shard.test.mjs checks that the shards of a list are
 * disjoint and add up to it, and test.yml only passes a leg when every one of
 * its shards passed.
 *
 * test-all.mjs's inline sections are not files, so they cannot be dealt out:
 * shard 1 runs them, alongside its suites, in one of its slots.
 */

/** Most shards a run may be split into: more is a typo, not a plan. */
export const MAX_SHARDS = 32;

/**
 * Read `--shard i/n`.
 *
 * @param {string} raw - The flag's value, e.g. "2/3".
 * @returns {{index: number, count: number}|{error: string}}
 */
export function parseShard(raw) {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(raw ?? '').trim());
  if (!m) return { error: `--shard takes i/n, e.g. --shard 2/3 (got "${raw ?? ''}")` };
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count > MAX_SHARDS) return { error: `--shard ${raw}: at most ${MAX_SHARDS} shards` };
  if (index > count) return { error: `--shard ${raw}: the shard number cannot be larger than the number of shards` };
  return { index, count };
}

/**
 * The suites one shard runs, in their original order.
 *
 * @template T
 * @param {T[]} files - Every discovered suite, in discovery order.
 * @param {{index: number, count: number}} shard
 * @returns {T[]}
 */
export function pickShard(files, { index, count }) {
  return files.filter((_, at) => at % count === index - 1);
}

/** Whether this shard runs test-all.mjs's inline sections. */
export function runsInlineSections({ index }) {
  return index === 1;
}
