// Pure helpers for the Preparation page (viewer + prep checklist). No Node
// imports: client components use these, so they must bundle for the browser.
// Server-only path/file helpers live in safe-path.mjs and json-file.mjs.

/** Markdown task items (`- [ ] text` / `- [x] text`) in a document. */
export function parseTaskItems(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) out.push({ text: m[2], done: m[1] !== " " });
  }
  return out;
}

/** Stable key for a ticked item: file + (trimmed, capped) text. */
export function tickKey(file, text) {
  return `${file}::${String(text).trim().slice(0, 120)}`;
}

/** Done count; a saved tick overrides what the markdown itself says. */
export function countDone(file, items, ticks) {
  return items.filter((i) => ticks[tickKey(file, i.text)] ?? i.done).length;
}

/** Coerce untrusted JSON into { ticks, tasks }. Never throws. */
export function normalizeProgress(raw) {
  const out = { ticks: {}, tasks: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (raw.ticks && typeof raw.ticks === "object" && !Array.isArray(raw.ticks)) {
    for (const [k, v] of Object.entries(raw.ticks).slice(0, 5000)) if (typeof v === "boolean") out.ticks[k] = v;
  }
  if (raw.tasks && typeof raw.tasks === "object" && !Array.isArray(raw.tasks)) {
    for (const [company, list] of Object.entries(raw.tasks).slice(0, 500)) {
      if (!Array.isArray(list)) continue;
      out.tasks[company] = list
        .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
        .slice(0, 200)
        .map((t) => ({ id: t.id.slice(0, 40), text: t.text.slice(0, 300), done: t.done === true }));
    }
  }
  return out;
}

// Viewer paths are root-prefixed: `output/<…>` or `interview-prep/<file>.md`.

/** Does this file belong to the company `slug`? A folder `output/<slug>/…`, or a
 *  file whose name carries the slug as a whole token (`cv-…-acme-….pdf`,
 *  `interview-prep/acme-backend-engineer.md`), so "meta" never matches "metabase". */
export function matchesCompany(path, slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return false; // slugs are lowercase tokens joined by "-"
  const parts = path.split("/");
  if (parts[0] === "output" && parts.length > 2) return parts[1] === slug;
  const name = parts[parts.length - 1].toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${slug}([^a-z0-9]|$)`).test(name);
}

/** The most useful file for a company: its interview prep, then its evaluation, then any. */
export function pickForCompany(paths, slug) {
  const mine = paths.filter((p) => matchesCompany(p, slug));
  const base = (p) => p.split("/").pop();
  return (
    mine.find((p) => base(p) === "interview-prep.md") ??
    mine.find((p) => p.startsWith("interview-prep/")) ??
    mine.find((p) => base(p) === "evaluation.md") ??
    mine[0] ??
    null
  );
}
