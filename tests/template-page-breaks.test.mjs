// tests/template-page-breaks.test.mjs — a project's tech line must never be
// stranded at the top of a page.
//
// Every CV template deliberately lets a `.project` split across a page boundary
// ("content packs tight instead of jumping wholesale and leaving large bottom
// gaps", as cv-template.html's own comment puts it). That choice is only safe
// while the *worst* split is forbidden. `.project-desc` and `.project-tech` are
// sibling blocks, so the gap between them is a legal break opportunity, and
// Chromium takes it whenever a description happens to end near the bottom of a
// page: the next page opens with a bare "TypeScript | github.com/user/repo" and
// nothing above it to say which project that describes.
//
// The symmetric case was already guarded — `.project-title` carries
// `break-after: avoid` so a title is never orphaned at the bottom. This file
// pins the other half, and pins it as an *invariant over every discovered
// template* rather than as seven copies of one assertion, because the failure is
// invisible until a CV happens to be the wrong length. Six of the seven
// templates shipped without it; a new variant copied from any of them would
// have shipped without it too.
//
// Deliberately a CSS assertion, not a render: suites here must run on a bare
// clone with only Node (#1440), and reproducing the orphan needs Chromium plus a
// payload tuned to one template's exact geometry. The rule is the contract; the
// render is how the rule was arrived at.
import { readFileSync, existsSync } from 'fs';
import { relative, join, dirname } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { listTemplates } from '../cv-templates.mjs';

console.log('\nCV template page-break control — no orphaned project tech line');

/**
 * Innermost CSS rules as {selectors, declarations} pairs.
 *
 * Matching the innermost `… { … }` also reaches rules nested inside
 * `@media print` without tracking at-rule depth — but only once two things that
 * do put braces inside a declaration block are removed first. Comments go so a
 * commented-out rule can never satisfy an assertion, and `{{PLACEHOLDER}}`
 * interpolations go because templates use them inside declarations
 * (`max-width: {{PAGE_WIDTH}};`), which would otherwise skip the rule holding
 * one and absorb its text into the next rule's selector list.
 *
 * @param {string} css - Stylesheet text (a full template file is fine).
 * @returns {Array<{selectors: string[], decls: string}>}
 */
function rules(css) {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\{[^{}]*\}\}/g, 'PLACEHOLDER');
  const out = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      decls: m[2],
    });
  }
  return out;
}

/** Whether any rule targeting `selector` declares `prop: value`. */
function declares(parsed, selector, prop, value) {
  const exact = new RegExp(`(^|\\s|>|\\+|~)${selector.replace('.', '\\.')}(\\s|$|:)`);
  const decl = new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*${value}\\s*(;|$)`);
  return parsed.some((r) => r.selectors.some((s) => exact.test(s)) && decl.test(r.decls));
}

/**
 * Whether a template emits `.project-tech` markup it did not author.
 *
 * The assertions below rest on one premise: the markup is not the template's to
 * opt out of, because it comes from the shared templates/sections/projects.html
 * (or, with no partial there, from the built-in builder in build-cv-html.mjs,
 * which emits the same classes). A template that never styles .project-tech is
 * still on the hook, because it still renders the div.
 *
 * A template pack (#3202) is the one case where that premise can fail. A pack
 * ships its own sections/ next to its template, and loadSectionPartials()
 * resolves partials relative to the template file — so a pack that authors its
 * own projects.html chooses that section's DOM outright, and a pack whose
 * projects.html has no .project-tech cannot orphan a line it never emits.
 *
 * The exemption is deliberately narrow, and follows the premise rather than the
 * template's name:
 *   - flat template            → held (shared partial / built-in builder)
 *   - pack, no projects.html   → held (falls through to the built-in builder,
 *                                 which emits .project-tech regardless)
 *   - pack with projects.html  → held only if that partial emits project-tech
 */
function emitsProjectTech(t) {
  if (!t.pack) return true;
  const partial = join(dirname(t.path), 'sections', 'projects.html');
  if (!existsSync(partial)) return true; // built-in builder still emits it
  return /project-tech/.test(readFileSync(partial, 'utf-8'));
}

const discovered = listTemplates('cv').filter((t) => t.format === 'html');

if (discovered.length === 0) {
  fail('no HTML CV templates discovered — listTemplates("cv") returned nothing');
} else {
  pass(`discovered ${discovered.length} HTML CV templates to check`);
}

const templates = [];
for (const t of discovered) {
  if (emitsProjectTech(t)) {
    templates.push(t);
    continue;
  }
  pass(
    `${relative(ROOT, t.path).replace(/\\/g, '/')}: pack authors its own sections/projects.html `
      + 'with no .project-tech — nothing to orphan, page-break rules not applicable'
  );
}

for (const t of templates) {
  const rel = relative(ROOT, t.path).replace(/\\/g, '/');
  const css = readFileSync(t.path, 'utf-8');
  const parsed = rules(css);

  // Every template is held to this, including one that styles no .project-tech.
  // The markup is not the template's to opt out of: it comes from the shared
  // templates/sections/projects.html, so a template emits that div whenever the
  // payload carries `tech`, styled or not — and an unstyled block is still a
  // block-level sibling that a page break can land in front of. Skipping on "no
  // .project-tech rule" would pass such a template vacuously.

  // Keeping a whole .project atomic is the other valid way to satisfy the
  // invariant: the block moves as a unit, so the opportunity never exists.
  const atomicProject = declares(parsed, '.project', 'break-inside', 'avoid');

  // Either side of the break opportunity may declare it — the CSS fragmentation
  // rules forbid the break if either does.
  const guarded = declares(parsed, '.project-tech', 'break-before', 'avoid')
    || declares(parsed, '.project-desc', 'break-after', 'avoid');

  if (atomicProject) {
    pass(`${rel}: .project is atomic (break-inside: avoid) — cannot split before the tech line`);
  } else if (guarded) {
    pass(`${rel}: forbids a break immediately before .project-tech`);
  } else {
    fail(`${rel}: .project may split across pages but nothing forbids a break before `
      + `.project-tech — a bare tech line can land alone atop the next page. Add `
      + `\`.project-tech { break-before: avoid; page-break-before: avoid; }\``);
  }

  // The templates pair every modern break property with its legacy alias. Losing
  // half the pair is the kind of edit that looks like a tidy-up and quietly drops
  // support for whatever engine still needs the prefix-era name.
  if (declares(parsed, '.project-tech', 'break-before', 'avoid')
    && !declares(parsed, '.project-tech', 'page-break-before', 'avoid')) {
    fail(`${rel}: .project-tech has break-before: avoid without the paired page-break-before: avoid`);
  }

  // Regression guard on the protection that already existed: a project title must
  // still not be the last thing on a page.
  if (declares(parsed, '.project-title', 'break-after', 'avoid')) {
    pass(`${rel}: .project-title still carries break-after: avoid`);
  } else if (!atomicProject) {
    fail(`${rel}: .project-title lost break-after: avoid — a title can be orphaned at the bottom of a page`);
  }
}
