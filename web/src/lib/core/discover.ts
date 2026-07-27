import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readInbox, readApplications } from "@/lib/career-ops";
import { canon } from "@/lib/explore-ai";

/**
 * Dedup context for AI search (modes/discover.md). The maintainer contract says
 * dedup the AI PROPOSALS against what's already known BEFORE showing them. We
 * give the agent a COMPACT "already known" block (companies/roles + a URL count,
 * token-cheap — not thousands of raw URLs) so it skips known employers, AND a
 * canonicalized URL set the client uses as a silent backstop on the stream.
 */
export function assembleDedupContext(): { urls: Set<string>; lines: string[] } {
  const urls = new Set<string>();
  const companies = new Set<string>();
  const roles = new Set<string>();

  // scan-history.tsv col 0 = url (every URL ever surfaced)
  try {
    const tsv = fs.readFileSync(path.join(careerOpsRoot(), "data", "scan-history.tsv"), "utf8");
    const rows = tsv.split("\n");
    for (let i = 1; i < rows.length; i++) {
      const url = rows[i].split("\t")[0]?.trim();
      if (url && /^https?:\/\//i.test(url)) urls.add(canon(url));
    }
  } catch {
    /* no history yet */
  }

  for (const j of readInbox()) {
    if (j.url && /^https?:\/\//i.test(j.url)) urls.add(canon(j.url));
    if (j.company) companies.add(j.company.trim());
  }
  for (const a of readApplications()) {
    if (a.company) companies.add(a.company.trim());
    if (a.role) roles.add(a.role.trim());
  }

  const compList = [...companies].filter(Boolean).slice(0, 120);
  const roleList = [...roles].filter(Boolean).slice(0, 60);
  const lines: string[] = [];
  if (compList.length) lines.push(`Companies already in the user's pipeline/tracker (don't re-propose these): ${compList.join(", ")}.`);
  if (roleList.length) lines.push(`Roles already tracked: ${roleList.join(", ")}.`);
  lines.push(`(${urls.size} posting URLs are already known and will be auto-filtered, so don't worry about matching exact URLs — just skip the companies above.)`);
  return { urls, lines };
}
