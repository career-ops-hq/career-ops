/**
 * Flags for one scan-ats-full.mjs child, after the script path. Explore always
 * caps each source, so it always asks for a shuffled sample: the uncapped order
 * is alphabetical, and its first few hundred companies are the same every run.
 *
 * @param {{ ats: string[], json: boolean, sinceDays: number, limitPerAts: number }} options
 * @returns {string[]}
 */
export function scannerArgs({ ats, json, sinceDays, limitPerAts }) {
  const args = [
    "--dry-run",
    "--since",
    String(Math.max(1, sinceDays || 7)),
    "--ats",
    ats.join(","),
    "--limit",
    String(Math.max(1, limitPerAts || 150)),
    "--shuffle",
  ];
  if (json) args.push("--json");
  return args;
}
