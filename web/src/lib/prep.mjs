// Pure helpers for the Preparation page (output viewer + prep checklist).
import path from "node:path";

/** Resolve `rel` inside `base`; returns null when it would escape `base`. */
export function resolveInside(base, rel) {
  const root = path.resolve(base);
  const full = path.resolve(root, rel);
  return full.startsWith(root + path.sep) ? full : null;
}

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
