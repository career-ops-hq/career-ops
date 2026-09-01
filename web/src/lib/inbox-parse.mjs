/**
 * inbox-parse.mjs — pipeline.md inbox row parser for the web read path.
 *
 * Plain .mjs (same pattern as report-files.mjs) so career-ops.ts and
 * `node --test` share one definition. modes/pipeline.md documents 1-column
 * (bare URL), 3/4/5-column, and labeled `posted:`/`trust:`/`note:`/`rank:`
 * shapes; CLI writers also emit URL-only pending rows and processed
 * `#NNN | URL | …` rows. Requiring three positional cells dropped those.
 */

/** A pipeline-row segment like `posted: 2026-07-14`, `trust: 62 stale` or
 *  `note: …` — the core appends these LABELED segments after whatever
 *  positional shape a row has (1/3/4/5 columns), so a naive positional reader
 *  would misread them as company/role/location/compensation on short rows. Any
 *  `word:`-prefixed segment is treated as labeled (forward-compatible with
 *  labels the core hasn't invented yet). */
const LABELED_SEGMENT = /^([a-z][a-z_-]*):\s*(.*)$/i;
const HTTP_URL = /^https?:\/\//i;

/**
 * Parse `data/pipeline.md` markdown into inbox jobs.
 *
 * `- [ ] URL | Company | Role [| Location [| Compensation]] [| label: …]*`
 * plus the shorter documented shapes: bare URL, URL|company, and processed
 * `- [x] #NNN | URL | Company | Role | …`. The http(s) cell is the URL even
 * when a report-number prefix sits in front of it. Missing company/role stay
 * empty strings — never invented. Non-http cells with no URL are skipped.
 *
 * @param {string | null | undefined} md
 * @returns {Array<{url: string, company: string, role: string, location?: string, compensation?: string, done: boolean, postedAt?: string}>}
 */
export function parseInboxMarkdown(md) {
  if (!md) return [];
  const jobs = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const all = m[2].split("|").map((s) => s.trim());
    const urlIndex = all.findIndex((seg) => HTTP_URL.test(seg));
    if (urlIndex < 0) continue;
    const labels = new Map();
    const positional = [];
    for (let i = urlIndex + 1; i < all.length; i++) {
      const seg = all[i];
      const lm = seg.match(LABELED_SEGMENT);
      if (lm) labels.set(lm[1].toLowerCase(), lm[2].trim());
      else positional.push(seg);
    }
    const posted = labels.get("posted");
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: all[urlIndex],
      company: positional[0] ?? "",
      role: positional[1] ?? "",
      location: positional[2] || undefined, // optional 4th column (#1015)
      compensation: positional[3] || undefined, // optional 5th column (#1017); 6th+ ignored
      // the row's own posting date (scan.mjs `posted:` label) — a more direct
      // freshness signal than the scan-history join, which stays as fallback
      postedAt: posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : undefined,
    });
  }
  return jobs;
}
