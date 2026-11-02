/**
 * lib/personalization.mjs — Read-only section inspection for modes/_profile.md
 *
 * Core module for identifying the 8 structured profile sections, scanning
 * markdown heading boundaries, normalizing bodies (stripping comments and
 * whitespace noise), and determining whether sections are still template content.
 */

/** The eight template sections, in template order. `id` is the API/JSON key. */
export const SECTIONS = [
  { id: "targetRoles", heading: "## Your Target Roles" },
  { id: "adaptiveFraming", heading: "## Your Adaptive Framing" },
  { id: "exitNarrative", heading: "## Your Exit Narrative" },
  { id: "crossCuttingAdvantage", heading: "## Your Cross-cutting Advantage" },
  { id: "portfolio", heading: "## Your Portfolio / Demo" },
  { id: "compTargets", heading: "## Your Comp Targets" },
  { id: "negotiationScripts", heading: "## Your Negotiation Scripts" },
  { id: "locationPolicy", heading: "## Your Location Policy" },
];

/**
 * Locate every `# ` / `## ` heading by SOURCE OFFSET — nothing is normalized,
 * so a caller can splice the original string and keep every other byte.
 * A `## ` line inside a code fence is not a heading. `unsure` names the first
 * thing that makes the boundaries ambiguous (a heading-looking line inside an
 * HTML comment, a comment or fence that never closes), or is null.
 */
export function scanHeadings(text) {
  const heads = [];
  let unsure = null;
  let fence = null;
  let inComment = false;
  for (let pos = 0; pos < text.length; ) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl + 1;
    const line = text.slice(pos, end).replace(/\r?\n$/, "");
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !line.slice(mark[0].length).trim()) fence = null;
    } else {
      const heading = /^##? /.test(line);
      if (heading && inComment) unsure ??= `a heading-looking line ("${line.trim().slice(0, 60)}") sits inside an HTML comment`;
      else if (heading) heads.push({ level: line.startsWith("## ") ? 2 : 1, heading: line.trim(), start: pos, bodyStart: end });
      else if (mark && !inComment) fence = mark[1];
      if (!fence) {
        for (let i = 0; i < line.length; ) {
          const j = line.indexOf(inComment ? "-->" : "<!--", i);
          if (j === -1) break;
          inComment = !inComment;
          i = j + (inComment ? 4 : 3);
        }
      }
    }
    pos = end;
  }
  if (fence) unsure ??= "a code fence is never closed";
  if (inComment) unsure ??= "an HTML comment is never closed";
  heads.forEach((h, i) => { h.end = i + 1 < heads.length ? heads[i + 1].start : text.length; });
  return { heads, unsure };
}

/** Normalize a body for template comparison: drop HTML comments + whitespace noise. */
export function normBody(body) {
  let s = String(body ?? "");
  // Scanned by index, until stable: one pass over `<!<!-- a -->-- b -->` leaves
  // a fresh `<!--` behind. An opener that is never closed hides everything
  // after it when rendered, so it is dropped with the rest of the body.
  for (;;) {
    let out = "";
    let from = 0;
    for (;;) {
      const start = s.indexOf("<!--", from);
      if (start === -1) { out += s.slice(from); break; }
      out += s.slice(from, start);
      const end = s.indexOf("-->", start + 4);
      if (end === -1) break;
      from = end + 3;
    }
    if (out === s) break;
    s = out;
  }
  return s.replace(/\s+/g, " ").trim();
}

/** `## ` sections of a document as [heading, normalized body] pairs. */
export function sectionBodies(md) {
  const text = String(md ?? "");
  return scanHeadings(text).heads.filter((h) => h.level === 2).map((h) => [h.heading, normBody(text.slice(h.bodyStart, h.end))]);
}

/**
 * Per-section state of a user's _profile.md against the shipped template:
 * "filled" (differs from the template), "template" (still the shipped text),
 * or "missing" (heading absent or body empty).
 */
export function sectionState(userMd, templateMd) {
  const user = new Map(sectionBodies(userMd));
  const tpl = new Map(sectionBodies(templateMd));
  return SECTIONS.map((s) => {
    if (!user.has(s.heading)) return { id: s.id, heading: s.heading, state: 'missing' };
    const userBody = user.get(s.heading);
    if (!userBody) return { id: s.id, heading: s.heading, state: 'missing' };
    const same = userBody === (tpl.get(s.heading) ?? '');
    return { id: s.id, heading: s.heading, state: same ? 'template' : 'filled' };
  });
}
