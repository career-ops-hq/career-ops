// lib/template-manifest.mjs — the <!-- career-ops-template --> manifest block
// a CV or cover-letter template carries, and the section vocabulary its
// `sections:` key is checked against (#3852).
//
// Shared by cv-templates.mjs (resolve-time completeness check) and
// build-cv-html.mjs (render-time parse check). Kept dependency-free on
// purpose: the builder imports it, and the builder has never needed js-yaml.

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

export function parseMeta(path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return {};
  }
  const block = text.match(/<!--\s*career-ops-template\s*([\s\S]*?)-->/);
  if (!block) return {};
  const meta = {};
  for (const line of block[1].split(/\r?\n/)) {
    // `(.*?)`, not `(.+?)`: a key written with a blank value is a key the
    // author typed, and it is recorded as ''. Dropping it would put the empty
    // declaration out of reach of every check downstream — a bare `sections:`
    // would parse as no key at all and fall silently back to the built-in
    // builders, which is the exact silence the sections key exists to remove.
    // Harmless for the other keys: `name` is read through `meta.name || ...`,
    // so an empty value still falls back to the prettified filename.
    const kv = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2];
  }
  return meta;
}

// ── Section completeness (#3852) ─────────────────────────────────────────────
//
// The CV sections build-cv-html.mjs renders from a `sections/<name>.html`
// partial when the template ships one. The manifest key below is checked
// against this list, and the builder imports it rather than keeping a second
// copy, so the check and the render can never disagree about which sections
// exist.
export const PARTIAL_SECTIONS = Object.freeze([
  'competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills',
]);

// The sections a template's manifest claims to own:
//
//   <!-- career-ops-template
//   name: ATS Friendly
//   sections: all                      every name in PARTIAL_SECTIONS
//   sections: experience, education    an explicit subset
//   -->
//
// Before this key existed a pack could only hope it was complete. A section
// with no partial — or a partial with a typo in it — rendered through the
// built-in builder, which emits exactly the DOM the pack was written to avoid,
// and nothing in the output said so. A declared section is a checkable claim
// instead: its partial must exist (checked here, at resolve) and parse
// (checked by the builder, which owns the partial format), or the render fails.
//
// Returns null when the manifest is silent, which keeps every pack written
// before this key on its old contract: silent fallback to the built-in
// builder. Throws on an empty declaration or a name outside the vocabulary —
// both mean the author meant to claim something, and a claim quietly ignored
// is the silence this key exists to remove.
export function declaredSections(meta) {
  const raw = meta?.sections;
  // Only an absent key declares nothing. A present-but-blank one (`sections:`
  // with nothing after it) reaches the empty-declaration error below, which is
  // why parseMeta records a blank value instead of dropping the line.
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (value.toLowerCase() === 'all') return new Set(PARTIAL_SECTIONS);
  const names = value.split(/[\s,]+/).filter(Boolean).map((n) => n.toLowerCase());
  if (names.length === 0) {
    throw new Error('manifest key "sections" is empty — write "all" or a list of section names');
  }
  const unknown = names.filter((n) => !PARTIAL_SECTIONS.includes(n));
  if (unknown.length) {
    throw new Error(
      `manifest key "sections" names unknown section${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} `
        + `(known: ${PARTIAL_SECTIONS.join(', ')}, or "all")`
    );
  }
  return new Set(names);
}

// For a template file on disk: what its manifest declares, and which declared
// sections have no partial beside it. `declared` is null for a silent manifest.
// Existence only — whether a partial parses is the renderer's call.
export function checkDeclaredSections(templatePath) {
  const declared = declaredSections(parseMeta(templatePath));
  if (!declared) return { declared: null, missing: [] };
  const sectionsDir = resolve(dirname(templatePath), 'sections');
  const missing = PARTIAL_SECTIONS.filter(
    (name) => declared.has(name) && !existsSync(resolve(sectionsDir, `${name}.html`))
  );
  return { declared, missing };
}

