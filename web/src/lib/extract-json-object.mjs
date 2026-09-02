/**
 * extract-json-object.mjs — pull a JSON object out of an LLM's text answer,
 * tolerating code fences, trailing prose, and — crucially — TRUNCATION (the
 * planner getting killed mid-output on a big form). When the object is
 * incomplete we salvage the largest valid prefix so the fields that DID
 * finish still come through (apply/prefill/route.ts).
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / clean-chips.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step — it has no `@/`
 * dependency, so factoring it out of the route is what makes it testable at
 * all.
 */

/**
 * @typedef {Object} ExtractedJson
 * @property {Record<string, unknown> | null} obj
 * @property {boolean} truncated
 */

/**
 * @param {string} text
 * @returns {ExtractedJson}
 */
export function extractJsonObject(text) {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return { obj: null, truncated: false };

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end !== -1) {
    try {
      return { obj: JSON.parse(s.slice(start, end + 1)), truncated: false };
    } catch {
      /* malformed even though balanced — fall through to salvage */
    }
  }

  // Truncated / unbalanced: walk back from successive STRUCTURAL commas
  // (commas outside any string), closing the JSON at each candidate boundary
  // and parsing the largest prefix that is valid.
  //
  // Each candidate prefix gets ITS OWN pad, computed from that prefix's own
  // open/close count — not the whole fragment's. An earlier field is usually
  // closed at a shallower depth than whatever the truncated tail was mid-way
  // through, so a pad sized for the full (broken) fragment almost never
  // matches what an earlier, complete field needs to close.
  //
  // Both the brace count and the backtrack points must ignore STRING content:
  // a completed field's own string value can legitimately contain a literal
  // '{', '}', or ',' (free text, a code snippet, a JSON example in prose), and
  // counting those as structural corrupts the pad for an otherwise perfectly
  // valid, already-complete field, or picks a backtrack point that lands
  // mid-string.
  //
  // `start` is an offset into `s`; every index used below (`prevComma`, loop
  // positions) is relative to `frag = s.slice(start)`, i.e. 0-based from a
  // DIFFERENT origin. Comparing a frag-relative index against `start` (an
  // s-relative one) is a unit mismatch: whenever there is enough leading
  // prose that `start` alone exceeds `frag.length`, EVERY frag-relative
  // comma index satisfies `<= start` trivially, so backtracking stops on its
  // first attempt even when a valid earlier candidate exists inside frag.
  //
  // A backtrack candidate must also land at ROOT-OBJECT depth (depth 1, i.e.
  // directly inside the outer `{`) — not at any structural comma regardless
  // of nesting. A comma one level deeper separates two properties WITHIN one
  // field's own value object ("value" from "needs_confirmation", say), and
  // that field is only complete once BOTH have arrived. Accepting a
  // depth-2+ comma as a boundary can close that field early and hand back a
  // FABRICATED partial answer that looks complete but silently dropped
  // content the planner never finished writing — worse than omitting the
  // field, because the caller has no way to tell the two apart.
  const frag = s.slice(start);
  const structural = new Array(frag.length).fill(false);
  const depths = new Array(frag.length).fill(0);
  {
    let inStr2 = false;
    let esc2 = false;
    let depth2 = 0;
    for (let i = 0; i < frag.length; i++) {
      const c = frag[i];
      structural[i] = !inStr2;
      depths[i] = depth2;
      if (inStr2) {
        if (esc2) esc2 = false;
        else if (c === "\\") esc2 = true;
        else if (c === '"') inStr2 = false;
      } else if (c === '"') inStr2 = true;
      else if (c === "{") depth2++;
      else if (c === "}") depth2--;
    }
  }
  const lastStructuralComma = (before) => {
    for (let i = before - 1; i >= 0; i--) {
      if (frag[i] === "," && structural[i] && depths[i] === 1) return i;
    }
    return -1;
  };

  for (let tryEnd = frag.length; tryEnd > 0; ) {
    const body = frag.slice(0, tryEnd).replace(/,\s*$/, "");
    let open = 0;
    let close = 0;
    for (let i = 0; i < body.length; i++) {
      if (!structural[i]) continue;
      if (body[i] === "{") open++;
      else if (body[i] === "}") close++;
    }
    const pad = "}".repeat(Math.max(0, open - close));
    try {
      return { obj: JSON.parse(body + pad), truncated: true };
    } catch {
      const prevComma = lastStructuralComma(tryEnd);
      if (prevComma < 0) break;
      tryEnd = prevComma;
    }
  }
  return { obj: null, truncated: true };
}
