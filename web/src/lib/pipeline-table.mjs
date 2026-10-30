/**
 * pipeline-table.mjs — line parsing of `data/pipeline.md` for the web read path.
 *
 * Split out of career-ops.ts for the same reason tracker-table.mjs exists: the
 * web reader of a user data file is exactly the kind of code that needs a
 * regression test running the REAL parser, and `node --test` (see
 * web/package.json) can only import plain .mjs — career-ops.ts pulls in `@/`
 * path aliases and Next-only modules.
 *
 * Everything here is pure: text in, rows out. No fs, no Next.
 */

/**
 * Split a career-ops data file into lines, tolerating CRLF.
 *
 * `data/` is gitignored (see .gitignore), so the repo-wide `eol=lf` policy in
 * .gitattributes does NOT reach the user's own pipeline.md / scan-history.tsv:
 * an editor, a sync client or any non-LF writer on Windows can leave CRLF
 * there. A plain `split("\n")` then leaves a trailing "\r" on every line, which
 * silently defeats any `$`-anchored row regex (JS `.` never matches \r) — the
 * file parses to zero rows and the UI just looks empty. Split on the line
 * break, not on "\n".
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r?\n/);
}

const LABELED_SEGMENT = /^(posted|trust|yrs|note|rank):\s(.*)$/i;

/** What a row points at: a posting URL, or a job description saved on disk
 *  (`local:jds/…`, the row modes/scan.md writes for a pasted posting). */
const ROW_TARGET = /^(?:https?:\/\/|local:\S)/i;

/** Parse data/pipeline.md — `- [ ] URL | Company | Role [| Location [| Compensation]] [| label: …]*`.
 *  The http(s) or `local:` cell is the URL, so `#NNN | URL | …` and a bare
 *  checkbox URL both survive. Company and role are the first two cells after that URL and
 *  are never labels: a `word:` there is text. Labels (`posted:`/`trust:`/`yrs:`/`note:`/`rank:`)
 *  start at the third cell after the URL, so they do not occupy location or
 *  compensation. Missing company and role stay empty. A row with neither an
 *  http(s) nor a `local:` cell is skipped. Further trailing columns are ignored.
 *  @param {string} md - content of data/pipeline.md.
 *  @returns {{url: string, company: string, role: string, location?: string, compensation?: string, done: boolean, postedAt?: string}[]}
 */
export function parseInbox(md) {
  const jobs = [];
  for (const line of splitLines(md)) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const all = m[2].split("|").map((s) => s.trim());
    const urlIndex = all.findIndex((seg) => ROW_TARGET.test(seg));
    if (urlIndex < 0) continue;
    const labels = new Map();
    const positional = [];
    for (let i = urlIndex + 1; i < all.length; i++) {
      const seg = all[i];
      // Company and role sit in the two cells after the URL. Reading `word:`
      // there as a tag turned a real company or title into a dropped column.
      const lm = i >= urlIndex + 3 ? seg.match(LABELED_SEGMENT) : null;
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
