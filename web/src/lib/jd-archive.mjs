/**
 * jd-archive.mjs — naming and rendering the file a pasted/uploaded JD becomes.
 *
 * Split from jd-source.mjs for one concrete reason: jd-source.mjs is imported by
 * the Add job dialog and the job store, both "use client", so it is bundled for
 * the browser and cannot touch a node builtin. This half needs node:crypto and is
 * only ever reached from /api/jd. The seam is the honest one anyway — jd-source
 * answers "what identifies this JD", this answers "what file does it become".
 *
 * Still a plain dependency-free .mjs, so both halves stay unit-testable under
 * bare `node --test`.
 */

import { createHash } from "node:crypto";
import { slug } from "./jd-source.mjs";

/**
 * Deterministic filename for a JD, derived from its own content.
 *
 * Content-addressed rather than timestamped, and that is the whole point: pasting
 * the same posting twice resolves to the same reference, so the dialog's
 * already-in-your-pipeline warning, merge-tracker's dedup and the inbox's
 * set-of-urls all keep working with no new dedup key to maintain. It also mirrors
 * the shape the apify writer already emits ({company}-{role}-{sha1[0:10]}.md), so
 * `jds/` stays readable by eye.
 *
 * The hash covers the JD text ONLY, not the company/role the user typed
 * alongside it. Those two fields are a label on the same posting, so letting them
 * into the hash would mean the same JD pasted twice with a typo corrected the
 * second time became two files and two pipeline rows.
 *
 * @param {{company?: string, role?: string, text: string}} args
 * @returns {string}
 */
export function jdFilename({ company, role, text }) {
  const hash = createHash("sha1").update(String(text ?? ""), "utf8").digest("hex").slice(0, 10);
  const parts = [slug(company) || "pasted", slug(role)].filter(Boolean);
  return `${parts.join("-")}-${hash}.md`;
}

/**
 * The file body written to `jds/`.
 *
 * A short human header, then the JD verbatim under a plain heading. The text is
 * NOT reformatted: this file is the archive of what the user actually submitted,
 * and it is what an evaluation reads months later once the posting is gone. The
 * header lines double as the provenance record for where it came from.
 *
 * The "## Job description" heading is load-bearing, not decoration: the evaluate
 * prompt tells the agent that everything below it is the posting, which is what
 * keeps the header's own fields from being read as part of the JD.
 *
 * @param {{company?: string, role?: string, source?: string, savedAt: string, text: string}} args
 * @returns {string}
 */
export function jdMarkdown({ company, role, source, savedAt, text }) {
  const c = company?.trim() ?? "";
  const r = role?.trim() ?? "";
  // "{role} at {company}" only reads right when there IS a role. With the company
  // alone it produced "Job description at Initech", which reads as a location.
  const title = r && c ? `${r} at ${c}` : r || (c ? `Job description: ${c}` : "Job description");
  const head = [
    `# ${title}`,
    "",
    `**Company:** ${c || "(not given)"}`,
    `**Role:** ${r || "(not given)"}`,
    `**Saved:** ${savedAt}`,
    `**Source:** ${source || "pasted"}`,
    "",
    "## Job description",
  ].join("\n");
  // Blank line after the heading, always: without it a JD that opens with its
  // own "## Requirements" heading lands on the line directly below ours and both
  // stop being headings.
  return `${head}\n\n${String(text ?? "").trim()}\n`;
}
