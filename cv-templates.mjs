#!/usr/bin/env node
// cv-templates.mjs — discover, resolve, and validate CV / cover-letter templates.
// Single source of truth for "which template file, and is it usable?".
// Backward-compatible: with no config and no named files, resolves the base
// templates/cv-template.html (name "standard"), identical to prior behavior.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { getProfilePath, getCareerOpsRoot } from './path-resolver.mjs';
import {
  parseMeta, PARTIAL_SECTIONS, declaredSections, checkDeclaredSections,
} from './lib/template-manifest.mjs';

// The manifest block and the section vocabulary live in lib/template-manifest.mjs
// so build-cv-html.mjs can share them without importing this module (and the
// js-yaml it pulls in for profile defaults). Re-exported here because this is
// where callers have always found parseMeta.
export { parseMeta, PARTIAL_SECTIONS, declaredSections, checkDeclaredSections };

const __dirname = dirname(fileURLToPath(import.meta.url));
// templates/ is System Layer (code root); config/profile.yml is User Layer and
// follows the data root. CAREER_OPS_PROFILE still wins over both.
export const DEFAULT_TEMPLATES_DIR = resolve(__dirname, 'templates');
const DEFAULT_PROFILE_PATH = getProfilePath();

// The user layer: templates the user made or customized live under the data root,
// where the updater never looks. Read per call, not at load, so the data root a
// caller sets is the one searched.
export function DEFAULT_USER_TEMPLATES_DIR() {
  return resolve(getCareerOpsRoot(), 'data', 'templates');
}

export const KINDS = {
  cv: {
    prefix: 'cv-template',
    profileKey: ['cv', 'template'],
    required: ['NAME', 'EXPERIENCE', 'EDUCATION'],
  },
  cover: {
    prefix: 'cover-letter-template',
    profileKey: ['cover_letter', 'template'],
    required: ['NAME', 'ROLE_TITLE', 'OPENING'],
  },
};

export function prettify(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function kebab(display) {
  return String(display)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The only template formats the resolver recognizes. `format` reaches path
// construction (fileFor) unmodified, so it must be allowlisted or a value like
// `--format=../../etc/passwd` would traverse out of the templates dir.
const VALID_FORMATS = new Set(['html', 'tex']);
function assertFormat(format) {
  if (!VALID_FORMATS.has(format)) {
    throw new Error(`Unsupported template format: ${format} (expected html or tex)`);
  }
}

// filename → {name, format} | null. Base "cv-template.html" → name "standard";
// "cv-template.<name>.html" → that name. Only html/tex are recognized.
function parseFilename(prefix, file) {
  const m = file.match(new RegExp(`^${prefix}(?:\\.([a-z0-9-]+))?\\.(html|tex)$`));
  if (!m) return null;
  return { name: m[1] || 'standard', format: m[2] };
}

// Build the entry a discovered template file contributes.
function entryFor(parsed, path, pack, layer) {
  const meta = parseMeta(path);
  return {
    name: parsed.name,
    displayName: meta.name || prettify(parsed.name),
    path,
    format: parsed.format,
    meta,
    pack,
    layer,
  };
}

// Discover every template of `kind`/`format` under `dir`: the flat files that
// have always lived there, plus one level of *template packs* (#3202).
//
// A pack is a subdirectory holding its own `<prefix>.<name>.<format>` next to
// its own `sections/`. That co-location is the whole point: build-cv-html.mjs
// resolves partials relative to the template file, so a pack gets its own DOM
// without touching the `sections/` every flat template shares.
//
// The template name comes from the *filename*, exactly as it does for a flat
// template — never from the directory name. `templates/ats/cv-template.ats.html`
// is template "ats" because of the file, and the directory could be called
// anything. That keeps one naming rule instead of two.
//
// Packs are one level deep only. Nothing here recurses: a pack's `sections/`
// must not be mistaken for a nested pack, and an arbitrarily deep walk over a
// user-writable directory is a cost (and a surface) with no use case behind it.
//
// Symlinked directories are followed, which needs an explicit stat because
// `Dirent.isDirectory()` is false for a symlink.
//
// Refusing them looks like the safer default and isn't. A symlink grants no
// capability its creator lacked: anyone who can drop `templates/mine` as a link
// can drop it as a real directory holding the same file, so skipping buys no
// protection against a hostile template — it only makes a legitimate one
// vanish. The repo's actual symlink guards are on a different axis, and both
// stay intact: resolveInsideRepo() in reconcile-pipeline.mjs resolves
// user-supplied path *arguments* before a boundary check, and contacts.mjs
// refuses to *write* through a link escaping the project. Discovery does
// neither — it enumerates a directory the project owns and only ever reads.
//
// Cycles are not a concern precisely because this walk is one level and never
// recurses; a link pointing at its own ancestor is read once as a directory
// and contributes whatever template files sit at its top level.
//
// The deciding cost is silent invisibility. career-ops sanctions a symlinked
// user layer (#524), so a pack maintained outside the repo is a supported
// setup, and skipping it would drop the template from the registry with
// nothing said — the same failure this file refuses to accept for name
// collisions.
//
// Returns Map<name, entry>. A name claimed twice throws — see assertNoCollision.
function discoverIn(kind, { dir, format }, layer) {
  const cfg = KINDS[kind];
  const found = new Map();
  if (!existsSync(dir)) return found;

  const claim = (parsed, path, pack) => {
    if (parsed.format !== format) return;
    const prior = found.get(parsed.name);
    if (prior) assertNoCollision(parsed.name, prior.path, path, dir);
    found.set(parsed.name, entryFor(parsed, path, pack, layer));
  };

  // One listing serves both passes. Reading twice would let the flat pass and
  // the pack pass see different directory states, and the collision check spans
  // them: a file present for one read and gone for the other decides whether a
  // name is ambiguous. A single snapshot makes that verdict reproducible.
  const top = readdirSync(dir, { withFileTypes: true });

  // Flat templates. Unchanged from before packs existed, including the fact
  // that a symlinked file is read through like any other.
  for (const d of top) {
    const parsed = parseFilename(cfg.prefix, d.name);
    if (parsed) claim(parsed, resolve(dir, d.name), null);
  }

  // Packs, one level down.
  for (const d of top) {
    const packDir = resolve(dir, d.name);
    if (!d.isDirectory()) {
      // statSync follows the link; it throws on a broken one, which is not a pack.
      if (!d.isSymbolicLink()) continue;
      try {
        if (!statSync(packDir).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    let inner;
    try {
      inner = readdirSync(packDir);
    } catch {
      continue; // unreadable directory is not a pack
    }
    for (const file of inner) {
      const parsed = parseFilename(cfg.prefix, file);
      if (parsed) claim(parsed, resolve(packDir, file), d.name);
    }
  }

  return found;
}

// System templates plus the user's own. A name in both layers resolves to the
// user's file: that is the point of a user layer (a customized copy of a shipped
// name), and the two layers are separate directories, so unlike a clash inside
// one directory there is no ambiguity about which the user meant. A name claimed
// twice inside a single layer still throws.
function discover(kind, { dir, format, userDir = null }) {
  const found = discoverIn(kind, { dir, format }, 'system');
  if (!userDir || resolve(userDir) === resolve(dir)) return found;
  for (const [name, entry] of discoverIn(kind, { dir: userDir, format }, 'user')) found.set(name, entry);
  return found;
}

// A template name resolves to exactly one file, enforced when it is discovered
// rather than settled by a precedence rule.
//
// Precedence would have to pick a winner while both files exist and both look
// correct — during a migration from a flat template to a pack, say — and the
// loser would simply stop being rendered, silently, with nothing in the output
// naming the file that won. Failing at discovery costs one clear error and
// makes the ambiguity impossible to ship past.
function assertNoCollision(name, a, b, dir) {
  const rel = (p) => p.slice(dir.length + 1) || p;
  const [x, y] = [rel(a), rel(b)].sort();
  throw new Error(
    `Template name "${name}" is claimed by two files: ${x} and ${y}. `
      + `A name must resolve to one template — rename one, or remove the one you no longer use.`
  );
}

// The user layer is searched when `dir` is left at its default, or when `userDir`
// is named. Naming only `dir` keeps that directory the whole registry, so a
// caller pointing at a fixture is not mixed with whatever the data root holds.
function userDirFor(dir, userDir) {
  if (userDir !== undefined) return userDir;
  return dir === undefined ? DEFAULT_USER_TEMPLATES_DIR() : null;
}

export function listTemplates(kind, { dir, format = 'html', userDir } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  assertFormat(format);
  const user = userDirFor(dir, userDir);
  return [...discover(kind, { dir: dir ?? DEFAULT_TEMPLATES_DIR, format, userDir: user }).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function validateTemplate(path, kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  const text = readFileSync(path, 'utf-8');
  const missing = cfg.required.filter((ph) => !text.includes(`{{${ph}}}`));
  return { ok: missing.length === 0, missing };
}

// ---- ATS lint (#3109) ----
//
// validateTemplate answers "are the required placeholders present". atsLint
// answers a different question: does this template obey the ATS rules
// modes/pdf.md already documents? A template can be placeholder-complete and
// still be a two-column layout table.
//
// The rule set, the severities and the "must not flag" contract are DATA, in
// templates/ats-rules.yml, which quotes the modes/pdf.md bullet each rule
// enforces. Detection is code: one detector per rule id, registered below and
// dispatched by the rule's `detect` name. A rule with `detect: null` is agreed
// policy with no detector yet; it is reported under `skipped`, never as a pass.
//
// Findings are warnings. Nothing here throws, and nothing here blocks a render:
// an adventurous template is a choice, an unknowing one is a bug.

const DEFAULT_ATS_RULES_PATH = resolve(__dirname, 'templates', 'ats-rules.yml');

// Whether a rule can be judged on an unrendered template (#4798). `structural`
// rules read markup and styling, which a template carries. `content` rules need
// what the render payload fills in, so on a template they have no answer: they
// are reported under `skipped`, never run, and never read as a pass.
const ATS_RULE_SCOPES = ['structural', 'content'];

export function loadAtsRules(path = DEFAULT_ATS_RULES_PATH) {
  const doc = loadYaml(readFileSync(path, 'utf-8')) || {};
  // A missing `rules:` key, a wrongly-typed one and an empty list used to
  // coerce to [], and atsLint then walked zero rules and reported ok. Every
  // other way of breaking this file already fails loudly, so a config that
  // lints nothing has to as well. atsLint catches this and reports it through
  // `error`, the same path an unreadable rules file takes.
  if (!Array.isArray(doc.rules) || doc.rules.length === 0) {
    throw new Error(
      `ATS rules file defines no rules: ${path}. `
        + 'An empty rule set checks nothing and would report a clean pass.'
    );
  }
  // A nonempty list used to satisfy the check no matter what was in it, so
  // `rules: [{}]` loaded and atsLint recorded a skip with no rule id and
  // returned ok. The fields below are the contract this file's own header
  // states: every rule quotes its source, severity is advisory throughout, and
  // `detect: null` carries the reason it is still open. A rule that cannot say
  // which policy it enforces cannot be evaluated OR honestly skipped.
  const seen = new Set();
  for (const [i, rule] of doc.rules.entries()) {
    const at = `${path} rule ${i}`;
    if (!rule || typeof rule !== 'object') throw new Error(`${at}: each rule must be a mapping`);
    if (!rule.id) throw new Error(`${at}: needs an id`);
    if (seen.has(rule.id)) throw new Error(`${at}: duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
    if (!rule.rule) throw new Error(`${at} (${rule.id}): needs a human-readable rule name`);
    if (rule.severity !== 'warning') {
      throw new Error(`${at} (${rule.id}): severity must be "warning"; atsLint is advisory and never blocks a render`);
    }
    if (!Array.isArray(rule.source) || rule.source.length === 0) {
      throw new Error(`${at} (${rule.id}): needs at least one source quote`);
    }
    // Own properties only, as for `detect` below: `scope: toString` is not a scope.
    if (!ATS_RULE_SCOPES.some((scope) => scope === rule.scope)) {
      throw new Error(
        `${at} (${rule.id}): scope must be one of ${ATS_RULE_SCOPES.join(', ')}; got ${JSON.stringify(rule.scope)}. `
          + 'A rule that does not say whether it needs rendered output cannot be dispatched honestly.'
      );
    }
    if (!rule.must_not_flag) {
      throw new Error(`${at} (${rule.id}): needs must_not_flag, the half that decides whether the rule is worth having`);
    }
    // detect: null is a rule with no detector yet, which is legitimate. It
    // still has to say what is unsettled, or a permanent skip reads as a pass.
    if (rule.detect === null) {
      if (!rule.unimplemented_because) {
        throw new Error(`${at} (${rule.id}): a null detector must carry unimplemented_because`);
      }
    } else if (!Object.hasOwn(ATS_DETECTORS, rule.detect)) {
      // Any other value silently disables a detector that IS registered.
      // Writing `detector:` for `detect:` leaves no detect key, so the null
      // path skipped the rule as "no detector yet". That reason is false, and
      // the document its detector catches came back clean. A name nothing
      // registers reads the same way. Own properties only, or `detect:
      // toString` dispatches to a function on the prototype.
      throw new Error(
        `${at} (${rule.id}): detect must name a registered detector `
          + `(${Object.keys(ATS_DETECTORS).join(', ')}), or be null with unimplemented_because; `
          + `got ${JSON.stringify(rule.detect)}`
      );
    }
  }

  return {
    sourceDoc: doc.source_doc || null,
    rules: doc.rules,
    cannotCatch: Array.isArray(doc.cannot_catch) ? doc.cannot_catch : [],
  };
}

// Regions an extractor never reads as content, and which must not be mistaken
// for markup: a `<table>` written inside a comment is prose about a table.
function stripNonContent(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ');
}

// Tags out, then entities in. The order is not cosmetic: decoding first would
// turn `&lt;b&gt;` into markup the tag-stripper then deletes, inventing a tag
// out of text the author escaped precisely so it would stay text. Every
// provider that reads raw HTML strips then decodes for the same reason.
//
// Decoding at all matters because the accepted headers include `Awards &
// Honors`, and HTML writes that ampersand as `&amp;` — comparing against the
// raw escape flagged the sanctioned spelling as an invented synonym. The
// decoder is the shared one under providers/, not a local table: private
// copies of it have drifted out of sync four separate times (see the header of
// providers/_html-entities.mjs), and a fifth here would be the same mistake.
function textOf(fragment) {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Everything between an element's opening tag and its OWN closing tag, found
// by counting nested tags of the same name from `from` (the index just past
// the opening tag).
//
// The class-based scan below used to capture as far as the first `</`, which
// is the close of whatever is nested INSIDE the heading, not the heading's.
// Two ways that reads something other than what the heading says, and the
// second is the dangerous one:
//
//   <div class="section-title"><span class="icon"></span>Career Highlights</div>
//        → capture ends at the decoration, text comes back empty, heading
//          skipped as a placeholder.
//   <div class="section-title">Work <em>Experience</em> Details</div>
//        → capture ends at `</em>`, text reads "Work Experience", which is a
//          SANCTIONED header, and the real heading passes clean.
//
// Truncating onto an accepted name is strictly worse than truncating onto
// nothing: the empty case at least fails visibly. Both are the same bug, so
// both are fixed by bounding the element instead of guessing at its end.
//
// A regex backreference cannot do this and was measured: `<(\w+)[^>]*>(.*?)</\1>`
// makes the OUTERMOST element win, so `<body>` swallows the document in one
// lazy match and the scan finds no headings at all in any real template — a
// silent, total kill of the rule that presents as a clean pass. Counting is
// what a backreference cannot do, so the count is written out.
//
// An unclosed element returns the rest of the document. That over-reads rather
// than under-reads, so a malformed heading is reported loudly instead of
// vanishing — the same direction of error the rest of this detector takes.
function innerHtml(html, tag, from) {
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  scan.lastIndex = from;
  let depth = 1;
  for (let m; (m = scan.exec(html));) {
    if (m[2]) continue; // self-closing: opens and closes in one tag
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return html.slice(from);
}

// A `<table>` opened while another is still open. Depth never exceeds 1 for a
// flat table, however many of them a template has, which is the must-not-flag.
function detectNestedTable(html) {
  let depth = 0;
  for (const m of stripNonContent(html).matchAll(/<(\/?)table\b/gi)) {
    if (m[1]) depth = Math.max(0, depth - 1);
    else if (++depth >= 2) return ['a <table> is nested inside another <table>'];
  }
  return [];
}

const HIDDEN_SIGNALS = [
  [/display\s*:\s*none/i, 'display:none'],
  [/visibility\s*:\s*hidden/i, 'visibility:hidden'],
  [/font-size\s*:\s*0(?:px|pt|em|rem|%)?\s*(?:;|$)/i, 'font-size:0'],
  // `color` STANDALONE — anchored on the start of a declaration, so the
  // property is `color` and not one that merely ends in it. Unanchored, the
  // `color:#fff` inside `background-color:#fff` matched, and a badge (white
  // background, dark text) was reported as white-on-white. That is the first
  // thing a real template carries, and a lint that fires on it is one people
  // learn to ignore. The same substring sits inside `border-color`,
  // `outline-color` and `text-decoration-color`; all four are excluded by the
  // `-` that precedes the word, none by an enumeration this would have to
  // chase. `^` and `;` are the only declaration boundaries that exist here
  // because the scan reads style ATTRIBUTES, never a stylesheet block.
  [/(?:^|;)\s*color\s*:\s*(?:#fff(?:fff)?\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i, 'white text'],
];

// INLINE style attributes only. A stylesheet rule hiding a class is layout —
// templates/ats/cv-template.ats.html hides a decorative separator that way, so
// a stylesheet-wide scan fires on the template named "ats". `style="…"` on a
// span is where the stuffing trick actually lives; verify-ats.mjs draws the
// same line for white text and explains why at its check 8. That boundary is
// the rule's ceiling, not an oversight: see `must_not_flag` in the YAML.
function detectHiddenText(html) {
  const out = [];
  // `style` is anchored on a preceding space, so `data-style`, `my-style` and
  // any other attribute merely ENDING in "style" cannot match. Those values
  // carry data, and reading one as an inline style called visible text hidden.
  // The third alternative is the unquoted form (`style=display:none`), valid
  // HTML that hides text and matched nothing at all. An unquoted value ends at
  // the first space or `>`, so it is the whole declaration. The class pass
  // below was anchored this way already; this matcher kept the bug.
  for (const m of stripNonContent(html).matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const decl = m[1] ?? m[2] ?? m[3];
    for (const [re, label] of HIDDEN_SIGNALS) {
      if (re.test(decl)) out.push(`inline style hides text (${label}): style="${decl.trim().slice(0, 80)}"`);
    }
  }
  return out;
}

// Only a heading whose text is LITERAL is checkable. Every shipped template
// writes `{{SECTION_EXPERIENCE}}`, so the payload owns the wording of every
// rendered heading. A template-time check that read those as headings would
// flag every template in the repo and be wrong about all of them.

// True when `text` is nothing but `{{PLACEHOLDER}}` runs and whitespace.
// `{{...}}` is this repo's only substitution syntax. validateTemplate above
// looks for `{{NAME}}` literally, and build-cv-html.mjs resolves the same form.
//
// Two parts of the same file ask this one question. A heading that is only a
// placeholder has no wording yet. A `lang` that is only a placeholder has no
// language yet. The two answers had already drifted apart: the heading check
// read `{{SECTION_SUMMARY}}` as unchosen, while the language read took
// `{{LANG}}` for a chosen language called "{{lang}}".
function isPlaceholderOnly(text) {
  return !text.replace(/\{\{[^}]*\}\}/g, '').trim();
}

/**
 * The document's primary language subtag, lowercased, or null when absent.
 *
 * Absent means English here. A rule that refused to run without a `lang` would
 * check nothing by default, which is the quiet way for a lint to be useless.
 *
 * An unsubstituted placeholder counts as absent too. `lang="{{LANG}}"` read as
 * the language "{{lang}}", which is not "en". Every CV template this project
 * ships stood the rule down, and the cover letter alone was ever checked. A
 * template has not picked a language yet, so a placeholder value says nothing
 * about the CV rendered from it.
 *
 * @param {string} html
 * @returns {string|null}
 */
function documentLanguage(html) {
  // Comments out first. A commented-out `<html lang="es">` sitting above the
  // real document otherwise reads as the document's language and silences the
  // rule on an English CV, which is the dangerous direction: the lint stops
  // checking and records it only in `skipped`.
  //
  // The tag body is quoted strings OR characters that are neither a quote nor
  // `>`, so the `>` that ends the tag is the first one OUTSIDE a value. `[^>]*`
  // ended the capture at a `>` written inside a quoted value, handing the
  // walker a tag already truncated before `lang`, and `<html data-note=">"
  // lang="es">` read as English. That fires the rule on a Spanish CV, the
  // opposite direction from the evasions above and just as wrong.
  //
  // An unterminated quote matches nothing and returns null, which reads as
  // English and runs the rule. Malformed markup gets checked rather than
  // silently exempted.
  const open = stripNonContent(html).match(/<html\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i);
  if (!open) return null;

  // Attributes are walked as name/value pairs instead of searched as text, so
  // `lang` appearing INSIDE another attribute's quoted value cannot be read as
  // the attribute itself. There is no HTML parser here by design, and a walker
  // is the smallest thing that gets quoting right.
  // A name starts where a run of name characters does, so a long run with no `=` after it is read once, not from every position in it.
  const attr = /(?<![\w:.-])([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = attr.exec(open[1])) !== null) {
    if (m[1].toLowerCase() !== 'lang') continue;
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim().toLowerCase();
    if (!value || isPlaceholderOnly(value)) return null;
    // BCP 47: the primary subtag decides the language. en-GB is English.
    return value.split('-')[0];
  }
  return null;
}

function detectStandardSectionHeaders(html, rule) {
  const accepted = new Set((rule.headers || []).map((h) => h.toLowerCase()));
  if (accepted.size === 0) return [];
  const body = stripNonContent(html);
  // Deduplicated because the two passes overlap: an element carrying both a
  // heading tag and the class (`<h2 class="section-title">`) is matched by
  // each, and reported the same finding twice. Deduplicating the TEXT rather
  // than the matches also collapses a heading genuinely written twice, which
  // is the same warning either way.
  const headings = [...new Set([
    // The class pass reads to the matching close (see innerHtml). The heading
    // pass does not need to: `</h[1-6]>` is already the element's own end, and
    // a heading nested in a heading is not markup anyone writes.
    // `class` is anchored on a preceding space so `data-class`, `ng-class` and
    // any other attribute merely ENDING in "class" cannot match. The third
    // alternative is the unquoted form (`class=section-title`), which is valid
    // HTML and was silently skipped; an unquoted value cannot contain a space,
    // so it is the whole class list and needs no word-boundary search.
    ...[...body.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sclass\s*=\s*(?:"[^"]*\bsection-title\b[^"]*"|'[^']*\bsection-title\b[^']*'|section-title(?=[\s>]))[^>]*>/gi)]
      .map((m) => innerHtml(body, m[1], m.index + m[0].length)),
    ...[...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => m[1]),
  ].map(textOf))];

  const out = [];
  for (const heading of headings) {
    if (!heading) continue;
    if (isPlaceholderOnly(heading)) continue;
    if (accepted.has(heading.toLowerCase())) continue;
    out.push(`non-standard section heading: "${heading.slice(0, 60)}"`);
  }
  return out;
}

// Keyed by the rule's `detect` name. tests/ats-lint.test.mjs asserts this map
// and templates/ats-rules.yml name exactly the same detectors, in both
// directions — a detector nothing dispatches, or a rule naming a detector that
// does not exist, is drift the same way a stale line number was.
export const ATS_DETECTORS = {
  'nested-table': detectNestedTable,
  'hidden-text': detectHiddenText,
  'standard-section-headers': detectStandardSectionHeaders,
};

/**
 * Lint a template file against the ATS rules in templates/ats-rules.yml.
 * Advisory: every finding is a warning, and this never throws.
 *
 * @param {string} path Template file to read.
 * @param {'cv'|'cover'} kind Which template kind, so kind-scoped rules apply.
 * @param {{rulesPath?: string}} [opts]
 * @returns {{ok: boolean, path: string, kind: string, findings: object[],
 *            skipped: object[], cannotCatch: object[], error: string|null}}
 */
export function atsLint(path, kind, opts = {}) {
  const result = { ok: true, path, kind, findings: [], skipped: [], cannotCatch: [], error: null };
  try {
    const { rules, cannotCatch } = loadAtsRules(opts.rulesPath || DEFAULT_ATS_RULES_PATH);
    result.cannotCatch = cannotCatch;
    const html = readFileSync(path, 'utf-8');
    for (const rule of rules) {
      if (Array.isArray(rule.kinds) && !rule.kinds.includes(kind)) continue;

      // The accepted-header list is English. A template that declares another
      // language and writes its headings literally would have every one of
      // them reported, which this rule's own must_not_flag rules out. Reported
      // as a skip so silence stays distinguishable from a pass.
      if (rule.id === 'standard-section-headers') {
        const lang = documentLanguage(html);
        if (lang && lang !== 'en') {
          result.skipped.push({
            id: rule.id,
            rule: rule.rule,
            scope: rule.scope,
            reason: `document language is "${lang}"; the accepted-header list is English only`,
          });
          continue;
        }
      }

      // A path handed to atsLint is a template, never rendered output, so a
      // content rule has nothing to read. Skipped before its detector is even
      // looked up: a clean result here would be a pass that checked nothing.
      if (rule.scope === 'content') {
        result.skipped.push({
          id: rule.id,
          rule: rule.rule,
          scope: rule.scope,
          reason: 'content-dependent: needs rendered output, and this is an unrendered template'
            + (rule.unimplemented_because ? `. Also unimplemented: ${rule.unimplemented_because}` : ''),
        });
        continue;
      }

      const detector = rule.detect ? ATS_DETECTORS[rule.detect] : null;
      if (!detector) {
        result.skipped.push({
          id: rule.id,
          rule: rule.rule,
          scope: rule.scope,
          reason: rule.detect
            ? `no detector registered for "${rule.detect}"`
            : rule.unimplemented_because || 'no detector yet',
        });
        continue;
      }
      for (const detail of detector(html, rule)) {
        result.findings.push({
          id: rule.id,
          rule: rule.rule,
          severity: rule.severity || 'warning',
          scope: rule.scope,
          detail,
          source: rule.source || [],
        });
      }
    }
  } catch (err) {
    result.error = err?.message || String(err);
  }
  result.ok = result.findings.length === 0 && !result.error;
  return result;
}

// ---- renderLint (#5941) ----
//
// generate-pdf.mjs renders with JavaScript off and aborts every request that is
// not file: or data:. Both are silent, so a template carrying a <script> or a
// remote font renders without it and says nothing. renderLint says it. Same
// posture as atsLint: warnings only, never throws, never blocks a render.
// The rules live here rather than in templates/ats-rules.yml because they
// describe the renderer, not modes/pdf.md.
// Stands in for the template's own file: URL when there is no remote <base>.
const DOCUMENT_URL = 'file:///template/';
// How many levels of iframe srcdoc markup are read; what lies deeper is reported, not skipped.
const MAX_SRCDOC_DEPTH = 16;

// CSS Syntax 3, "consume an escaped code point": `\` plus 1-6 hex digits and one
// optional whitespace, or `\` plus any other character, which stands for itself.
// A backslash-newline inside a string is a line continuation and decodes to nothing.
function decodeCssEscapes(css) {
  return css.replace(/\\(?:\r\n|[\n\r\f]|([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/g, (m, hex, ch) => {
    if (hex === undefined && ch === undefined) return '';
    if (ch !== undefined) return ch;
    const code = parseInt(hex, 16);
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
  });
}

// One start or end tag, read with the HTML tokenizer's own states: tag name, before
// attribute name, attribute name, after attribute name, before attribute value, the
// three value states, and the self-closing solidus. A quote opens a value only right
// after `=`, so `alt=Jane's` is one unquoted value, and `"`, `'`, `<` and `=` inside
// a name are name characters. One pass, no backtracking. The first of two attributes
// with the same name wins. Returns null when the input ends inside the tag, which
// the parser drops. `at` is the index of `<`, followed by an ASCII letter or `/`.
const isHtmlSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\f' || c === '\r';
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const cleanName = (s) => asciiLower(s).replace(/\0/g, '�');
function tokenizeTag(html, at) {
  const n = html.length;
  let i = at + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  const nameStart = i;
  while (i < n && !isHtmlSpace(html[i]) && html[i] !== '/' && html[i] !== '>') i++;
  const name = cleanName(html.slice(nameStart, i));
  const attrs = [];
  const seen = new Set();
  let selfClosing = false;
  for (;;) {
    while (i < n && isHtmlSpace(html[i])) i++;
    if (i >= n) return null;
    if (html[i] === '>') { i++; break; }
    if (html[i] === '/') {
      i++;
      if (html[i] === '>') { selfClosing = true; i++; break; }
      continue;
    }
    // attribute name: a leading `=` belongs to the name
    const nameAt = i;
    if (html[i] === '=') i++;
    while (i < n && !isHtmlSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    if (i >= n) return null;
    const attrName = cleanName(html.slice(nameAt, i));
    let value = '';
    let j = i;
    while (j < n && isHtmlSpace(html[j])) j++;
    if (j >= n) return null;
    if (html[j] === '=') {
      i = j + 1;
      while (i < n && isHtmlSpace(html[i])) i++;
      if (i >= n) return null;
      const q = html[i];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, i + 1);
        if (end < 0) return null;
        value = html.slice(i + 1, end);
        i = end + 1;
      } else if (q !== '>') {
        const valueAt = i;
        while (i < n && !isHtmlSpace(html[i]) && html[i] !== '>') i++;
        if (i >= n) return null;
        value = html.slice(valueAt, i);
      }
    } else {
      i = j;
    }
    if (!seen.has(attrName)) {
      seen.add(attrName);
      attrs.push([attrName, value.replace(/\0/g, '�').replace(/\r\n?/g, '\n')]);
    }
  }
  return { raw: html.slice(at, i), name, closing, attrs, selfClosing, end: i };
}

// The attributes of one tag as [name, value] pairs, values with their character
// references decoded the way a browser does: the lint must see `https&#58;//x` as
// `https://x`, and a numeric reference decodes without its semicolon in an attribute.
const attrCache = new Map();
export function tagAttributes(tag) {
  let attrs = attrCache.get(tag);
  if (!attrs) {
    attrs = (tokenizeTag(tag, 0)?.attrs ?? []).map(([k, v]) => [k, decodeEntities(v, { bareNumeric: true })]);
    if (attrCache.size > 4096) attrCache.clear();
    attrCache.set(tag, attrs);
  }
  return attrs;
}
const attrNames = (tag) => tagAttributes(tag).map(([k]) => k);
function attrValue(tag, name) {
  return tagAttributes(tag).find(([k]) => k === name)?.[1] ?? null;
}

// The URL parser drops tab, LF and CR from anywhere in a URL, so `ht&#9;tps://x`
// is remote. Only the URL consumers strip: `rel`, `type` and `http-equiv` need
// the raw value. srcset is not stripped: tab, LF and CR are whitespace there, so
// they end a candidate URL instead of sitting inside one.
// Leading and trailing C0 controls and spaces go too (`&#1;javascript:` is `javascript:`),
// but not DEL or U+FFFD, which the URL parser keeps.
// Trimmed with two index scans: a regex for a trailing run backtracks from every start inside a run
// that is not at the end, which is quadratic on `a` + 100000 spaces + `b`.
function trimWhile(s, drop) {
  let a = 0;
  let b = s.length;
  while (a < b && drop(s.charCodeAt(a))) a++;
  while (b > a && drop(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}
const normalizeUrl = (v) => trimWhile(v, (c) => c <= 0x20).replace(/[\t\n\r]/g, '');
const urlValue = (tag, name) => {
  const v = attrValue(tag, name);
  return v === null ? null : normalizeUrl(v);
};

// The URL of every srcset candidate, since a remote one can follow a local one.
// A candidate URL is the run of non-whitespace characters, so the comma inside
// `data:image/png;base64,AAAA` stays part of it; only a comma that ends the run
// separates candidates (HTML Standard, "parse a srcset attribute").
function srcsetUrls(v) {
  const out = [];
  let i = 0;
  while (i < v.length) {
    while (i < v.length && /[\t\n\f\r ,]/.test(v[i])) i++;
    const start = i;
    while (i < v.length && !/[\t\n\f\r ]/.test(v[i])) i++;
    const token = v.slice(start, i);
    if (token === '') break;
    let end = token.length;
    while (end > 0 && token[end - 1] === ',') end--;
    const url = token.slice(0, end);
    if (url !== token) {
      // A trailing comma ends the candidate: there are no descriptors.
    } else {
      // Descriptors run to the next comma outside parentheses.
      let depth = 0;
      while (i < v.length) {
        const c = v[i++];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) break;
      }
    }
    if (url) out.push(url);
  }
  return out;
}

const excerpt = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 80);

// One pass over the markup in the HTML tokenizer's own terms, so no rule has to
// guess what is a tag and what is text. Comments (and the `<!-->` forms), bogus
// comments, CDATA in svg/math, the bodies of raw-text and RCDATA elements, and
// everything inside <template> are not markup and never become tags; a quoted
// attribute value is part of its tag. Open tags come back with the video, audio
// or picture they sit in, their namespace, and <style> bodies come back whole.
// With JavaScript off a <noscript> is ordinary markup, so it is scanned like any other.
//
// What the tokenizer does with the next characters depends on the tree builder, so the scan
// keeps the stack of open elements and their namespaces (HTML Standard, "tree construction
// dispatcher"): a start tag is read by the HTML rules when the current node is an HTML
// element, an HTML integration point (svg foreignObject, desc, title; math annotation-xml with
// an html encoding) or a MathML text integration point (mi, mo, mn, ms, mtext); anywhere else it
// is foreign content, which has no raw text, RCDATA or script data at all.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const MEDIA = new Set(['video', 'audio', 'picture']);
// These start tags leave foreign content (as does font with color, face or size, and the end tags br and p).
const FOREIGN_BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var']);
const SVG_HTML_POINTS = new Set(['foreignobject', 'desc', 'title']);
const MATH_TEXT_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
const HTML_VOID = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const HTML_SPECIAL = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br', 'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select', 'source', 'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp']);
const HTML_SCOPE = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
// End tags the HTML rules close only when the element is in scope; any other end tag closes its
// element unless a special element sits above it. The formatting elements (the adoption agency's)
// are taken to close everything above them too, which is what Chromium does to an open svg.
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u']);
const SCOPED_END = new Set(['address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'summary', 'ul', 'li', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'applet', 'marquee', 'object', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', ...FORMATTING]);
// Table parts are ignored outside a table, a form inside a form, and a select inside a select.
const TABLE_PARTS = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);
// In svg content an end tag with one of these names is case-adjusted (`</foreignobject>` is `</foreignObject>`)
// before any element is matched, so it closes the svg element and never an HTML element of that name (probed).
const SVG_CAMEL = new Set(['altglyph', 'altglyphdef', 'altglyphitem', 'animatecolor', 'animatemotion', 'animatetransform', 'clippath', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence', 'foreignobject', 'glyphref', 'lineargradient', 'radialgradient', 'textpath']);
// HTML start tags that close an open <p> first, and the ones that close an open list item or definition.
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre', 'search', 'section', 'summary', 'ul', 'xmp', 'li', 'dd', 'dt']);
// Chromium stops nesting at 512 open elements, and so does the end-tag search.
const MAX_OPEN = 512;
const isSpecial = (e) => (e.ns === 'html' ? HTML_SPECIAL.has(e.name) : e.ns === 'svg' ? SVG_HTML_POINTS.has(e.name) : MATH_TEXT_POINTS.has(e.name) || e.name === 'annotation-xml');
const isScopeBarrier = (e) => (e.ns === 'html' ? HTML_SCOPE.has(e.name) : isSpecial(e));

// Where script data ends. The tokenizer's escape states change what a `</script` means: after
// `<!--` it is still script data, and after `<script` inside that it ends only the inner script.
function scriptEnd(html, from) {
  // `--!>` is deliberately absent: it ends a comment (see scanHtml) but not the escaped
  // states, where the tokenizer reads `--!` as text and stays escaped (probed).
  const marks = /<!--|-->|<\/?script(?=[\t\n\f\r />])/gi;
  marks.lastIndex = from;
  let state = 0; // 0 script data, 1 escaped, 2 double escaped
  for (let m; (m = marks.exec(html));) {
    const mark = m[0].toLowerCase();
    if (mark === '<!--') {
      if (state === 0) state = 1;
      marks.lastIndex = m.index + 2; // its two dashes can open `-->`
    } else if (mark[0] === '-') {
      if (state !== 0) state = 0;
    } else if (mark === '<script') {
      if (state === 1) state = 2;
    } else if (state === 2) {
      state = 1;
    } else {
      return m.index;
    }
  }
  return html.length;
}

export function scanHtml(html) {
  const tags = [];
  const styles = [];
  const media = [];
  const stack = [];
  let templates = 0;
  let framesets = 0;
  let pending = 0; // where the text since the last token starts
  const popTo = (length) => {
    while (stack.length > length) {
      const e = stack.pop();
      if (e.template) templates--;
      if (e.frameset) framesets--;
      if (e.media) media.pop();
    }
  };
  // Text that is the child of a foreign <style> is its stylesheet. Foreign content
  // has no raw text, so its character references are decoded before CSS reads them;
  // a CDATA section's are not (probed).
  const text = (from, to, cdata = false) => {
    const sheet = stack.at(-1)?.sheet;
    if (!sheet) return;
    const chunk = html.slice(from, to);
    sheet.body += cdata ? chunk : decodeEntities(chunk, { bareNumeric: true, text: true });
  };
  // Whether the HTML rules, not the foreign content rules, read a token about to be inserted.
  const htmlRules = (name, end) => {
    const cur = stack.at(-1);
    return !cur || cur.ns === 'html' || cur.integration
      ? true
      : cur.ns === 'math' && !end && (MATH_TEXT_POINTS.has(cur.name) ? name !== 'mglyph' && name !== 'malignmark' : cur.name === 'annotation-xml' && name === 'svg');
  };
  const leaveForeign = () => {
    while (stack.length && stack.at(-1).ns !== 'html' && !stack.at(-1).integration && !(stack.at(-1).ns === 'math' && MATH_TEXT_POINTS.has(stack.at(-1).name))) popTo(stack.length - 1);
  };
  // An end tag the HTML rules read ("any other end tag", and the scoped ones).
  const htmlEnd = (name) => {
    if (name === 'body' || name === 'html' || name === 'br') return;
    const heading = /^h[1-6]$/.test(name);
    const scoped = SCOPED_END.has(name);
    // A form is taken off by its pointer, in a table too (not inside a template), and a select closes whatever it holds.
    const unbounded = name === 'template' || name === 'select' || (name === 'form' && templates === 0);
    for (let k = stack.length - 1; k >= 0 && k >= stack.length - MAX_OPEN; k--) {
      const e = stack[k];
      if (e.ns === 'html' && (heading ? /^h[1-6]$/.test(e.name) : e.name === name)) {
        // `</form>` takes the form off the stack and leaves what it holds open.
        if (name === 'form' && templates === 0) stack.splice(k, 1);
        else popTo(k);
        return;
      }
      if (unbounded ? false : scoped ? isScopeBarrier(e) : isSpecial(e)) return;
    }
  };
  // The HTML rules close an open <p> before a block, and an open li, dd or dt before the next one.
  const closeOpen = (name) => {
    if (name === 'li' || name === 'dd' || name === 'dt') {
      const items = name === 'li' ? ['li'] : ['dd', 'dt'];
      for (let k = stack.length - 1; k >= 0 && k >= stack.length - MAX_OPEN; k--) {
        const e = stack[k];
        if (e.ns === 'html' && items.includes(e.name)) { popTo(k); break; }
        if (isSpecial(e) && !(e.ns === 'html' && (e.name === 'address' || e.name === 'div' || e.name === 'p'))) break;
      }
    }
    const top = stack.at(-1);
    if (top && top.ns === 'html' && ((name === 'option' && top.name === 'option') || (name === 'optgroup' && (top.name === 'option' || top.name === 'optgroup')) || (/^h[1-6]$/.test(name) && /^h[1-6]$/.test(top.name)))) popTo(stack.length - 1);
    if (!CLOSES_P.has(name)) return;
    for (let k = stack.length - 1; k >= 0 && k >= stack.length - MAX_OPEN; k--) {
      const e = stack[k];
      if (e.ns === 'html' && e.name === 'p') { popTo(k); return; }
      if (isScopeBarrier(e) || (e.ns === 'html' && e.name === 'button')) return;
    }
  };
  let i = 0;
  while ((i = html.indexOf('<', i)) !== -1) {
    const next = html[i + 1];
    const cur = stack.at(-1);
    const at = i;
    if (html.startsWith('<!--', i)) {
      text(pending, at);
      const abrupt = /^<!---?>/.exec(html.slice(i, i + 6));
      const close = /--!?>/g;
      close.lastIndex = i + 4;
      const end = abrupt ? null : close.exec(html);
      i = abrupt ? i + abrupt[0].length : end ? end.index + end[0].length : html.length;
      pending = i;
    } else if (cur && cur.ns !== 'html' && !cur.integration && !(cur.ns === 'math' && MATH_TEXT_POINTS.has(cur.name)) && html.startsWith('<![CDATA[', i)) {
      text(pending, at);
      const end = html.indexOf(']]>', i);
      text(i + 9, end < 0 ? html.length : end, true);
      i = end < 0 ? html.length : end + 3;
      pending = i;
    } else if (next === '!' || next === '?' || (next === '/' && !/[a-zA-Z]/.test(html[i + 2] ?? ''))) {
      text(pending, at);
      const end = html.indexOf('>', i);
      i = end < 0 ? html.length : end + 1;
      pending = i;
    } else {
      if (!/[a-zA-Z]/.test(next === '/' ? html[i + 2] ?? '' : next ?? '')) { i++; continue; }
      const token = tokenizeTag(html, i);
      if (!token) { text(pending, at); pending = html.length; break; } // the input ends inside the tag, and the parser drops it
      text(pending, at);
      i = pending = token.end;
      let { name } = token;
      if (token.closing) {
        // The foreign content rules read an end tag unless the current node is an HTML element;
        // br and p leave foreign content first, and any other name closes the nearest open
        // element of that name, stopping at the first HTML element, which the HTML rules take over.
        if (stack.length && stack.at(-1).ns !== 'html') {
          if (name === 'br' || name === 'p') leaveForeign();
          else {
            let k = stack.length - 1;
            while (k >= 0 && k >= stack.length - MAX_OPEN && stack[k].ns !== 'html' && stack[k].name !== name) k--;
            if (k >= 0 && stack[k].ns !== 'html' && stack[k].name === name) { popTo(k); continue; }
            if (stack.at(-1).ns === 'svg' && SVG_CAMEL.has(name)) continue;
          }
        }
        htmlEnd(name);
        continue;
      }
      let useHtml = htmlRules(name, false);
      if (!useHtml && (FOREIGN_BREAKOUT.has(name) || (name === 'font' && token.attrs.some(([k]) => k === 'color' || k === 'face' || k === 'size')))) {
        leaveForeign();
        useHtml = true;
      }
      const ns = useHtml ? (name === 'svg' || name === 'math' ? name : 'html') : stack.at(-1).ns;
      // The HTML tree builder renames <image> to <img> (the svg element keeps its name).
      if (ns === 'html' && name === 'image') name = 'img';
      if (ns === 'html') {
        // The tree builder drops these start tags, so they make no element and open nothing.
        const open = (n) => stack.slice(-MAX_OPEN).some((e) => e.ns === 'html' && e.name === n);
        // A table part closes an open select; outside a table it is dropped.
        if ((TABLE_PARTS.has(name) || name === 'table') && open('select')) popTo(stack.findLastIndex((e) => e.ns === 'html' && e.name === 'select'));
        if (TABLE_PARTS.has(name) && !open('table') && !open('template')) continue;
        if (name === 'form' && open('form') && templates === 0) continue;
        if (name === 'select' && open('select')) {
          popTo(stack.findLastIndex((e) => e.ns === 'html' && e.name === 'select'));
          continue;
        }
        closeOpen(name);
      }
      const inert = templates > 0;
      if (!inert) tags.push({ raw: token.raw, name, media: media.at(-1) ?? null, svg: ns === 'svg', ns, frameset: framesets > 0 });
      // A trailing slash closes a tag only where the HTML parser honours it: an element made in
      // svg or math content. <picture/> and <template/> still open an element.
      const selfClosing = token.selfClosing && ns !== 'html';
      if (ns === 'html' && RAW_TEXT.has(name)) {
        // The tokenizer reads the body as text up to the end tag; the element never stays open.
        const end = name === 'plaintext' ? null : new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
        let stop = html.length;
        if (name === 'script') stop = scriptEnd(html, i);
        else if (end) { end.lastIndex = i; stop = end.exec(html)?.index ?? html.length; }
        if (name === 'style' && !inert) styles.push({ tag: token.raw, body: html.slice(i, stop) });
        i = pending = stop;
        continue;
      }
      if (selfClosing || (ns === 'html' && HTML_VOID.has(name))) continue;
      const e = { name, ns, integration: false };
      if (ns === 'svg') e.integration = SVG_HTML_POINTS.has(name);
      else if (ns === 'math' && name === 'annotation-xml') e.integration = /^(?:text\/html|application\/xhtml\+xml)$/i.test(attrValue(token.raw, 'encoding') ?? '');
      if (ns === 'html' && name === 'template') { e.template = true; templates++; }
      if (ns === 'html' && name === 'frameset') { e.frameset = true; framesets++; }
      if (ns === 'html' && MEDIA.has(name)) { e.media = true; media.push(name); }
      // A foreign <style> is read for its CSS, and its children are markup.
      // Only an svg <style> is a stylesheet: Chromium applies no CSS from a math <style> (probed).
      if (ns === 'svg' && name === 'style' && !inert) {
        e.sheet = { tag: token.raw, body: '' };
        styles.push(e.sheet);
      }
      stack.push(e);
    }
  }
  text(pending, html.length); // an element left open at the end still holds its text
  return { tags, styles };
}

// The URLs a stylesheet asks for, read the way CSS Syntax 3 tokenizes it: comments
// and strings are skipped as units (so `"/*"` opens no comment and `content:"url(x)"`
// requests nothing), an unquoted url() runs to its `)`, and a string is a request
// only inside url(), image-set() or right after @import. @namespace takes a
// namespace name, not a resource. Escapes are decoded in names and values.
const CSS_IDENT = /(?:[a-zA-Z0-9_-]|[^\x00-\x7f]|\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\n\r\f]))+/y;
function cssRequestUrls(source) {
  // Input preprocessing: CRLF, CR and FF are LF, so a string ends at a CR and a
  // backslash-CRLF is one line continuation.
  const css = source.replace(/\r\n?|\f/g, '\n');
  const urls = [];
  const open = [];
  let atRule = null;
  let atFirst = false;
  let word = null; // the last bare identifier, so `filter:` can be told from a selector
  let property = null;
  let i = 0;
  const ident = (at) => { CSS_IDENT.lastIndex = at; const m = CSS_IDENT.exec(css); return m ? m[0] : null; };
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';
  // A filter reference to an external document is not requested (probed); every other url() is.
  const wanted = () => atRule !== 'namespace' && property !== 'filter' && property !== '-webkit-filter';
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      const value = decodeCssEscapes(css.slice(i + 1, Math.min(j, css.length)));
      const top = open.at(-1);
      if (wanted() && (top === 'url' || top === 'image-set' || top === '-webkit-image-set' || (atRule === 'import' && atFirst && !open.length))) urls.push(value);
      atFirst = false;
      i = css[j] === c ? j + 1 : j;
    } else {
      const name = ident(c === '@' ? i + 1 : i);
      if (name && c === '@') {
        atRule = decodeCssEscapes(name).toLowerCase();
        atFirst = true;
        i += 1 + name.length;
      } else if (name) {
        atFirst = false;
        i += name.length;
        if (css[i] !== '(') { word = decodeCssEscapes(name).toLowerCase(); continue; }
        i++;
        const fn = decodeCssEscapes(name).toLowerCase();
        while (fn === 'url' && isSpace(css[i] ?? '')) i++;
        if (fn !== 'url' || css[i] === '"' || css[i] === "'") { open.push(fn); continue; }
        let j = i;
        while (j < css.length && css[j] !== ')') j += css[j] === '\\' ? 2 : 1;
        if (wanted()) urls.push(decodeCssEscapes(trimWhile(css.slice(i, j), (c) => c === 0x20 || c === 0x09 || c === 0x0a)));
        i = j + 1;
      } else {
        if (c === '(') open.push('(');
        else if (c === ')') open.pop();
        else if (c === ':') property = word;
        else if (c === ';' || c === '{' || c === '}') { property = null; if (c !== '}') atRule = null; }
        if (!isSpace(c)) atFirst = false;
        i++;
      }
    }
  }
  return urls;
}

// The URLs a tag makes Chromium request, as probed with JavaScript off and a route()
// that logs every request (see FETCHERS in tests/render-lint.test.mjs, which pins the
// whole probe). Requested: img/image/feImage, video and audio src, a video poster, a
// source src in video/audio and srcset in picture, an input type=image src, embed src,
// object data, iframe src (not under srcdoc), frame src (inside a frameset), link href
// for stylesheet/prefetch/preload-with-as and its imagesrcset, the legacy background of
// body, table, thead, tbody, tfoot, tr, td and th, the url() of the svg fill, stroke,
// marker-*, clip-path, mask and cursor attributes, and the target of a refresh.
// Not requested: a, area, cite, ping, action, formaction, longdesc, lowsrc, usemap,
// codebase, archive, track, script src, use/pattern/textPath hrefs, icons, manifest.
const BACKGROUND_TAGS = new Set(['body', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
const SVG_URL_ATTRS = ['fill', 'stroke', 'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'mask', 'cursor'];
const REFRESH_RE = /^[\t\n\f\r ]*[0-9.]/;
function fetchedUrls({ raw, name, media, svg, ns, frameset }) {
  const urls = [];
  const one = (...attrs) => { for (const a of attrs) urls.push(urlValue(raw, a) ?? ''); };
  // An element name means what it means in its own namespace: svg:video, svg:link and math:td request
  // nothing, an svg <image> takes href (not src), and an HTML <image> is already an <img> (probed).
  if (ns === 'html') {
    if (['img', 'video', 'audio', 'embed'].includes(name)) one('src');
    if (name === 'iframe' && attrValue(raw, 'srcdoc') === null) one('src');
    if (name === 'frame' && frameset) one('src');
    if (name === 'object') one('data');
    if (name === 'input' && attrValue(raw, 'type')?.toLowerCase() === 'image') one('src');
    if (name === 'source' && (media === 'video' || media === 'audio')) one('src');
    if (name === 'img' || (name === 'source' && media === 'picture')) urls.push(...srcsetUrls(attrValue(raw, 'srcset') ?? ''));
    if (name === 'video') one('poster');
    if (BACKGROUND_TAGS.has(name)) one('background');
    if (name === 'link') {
      const rel = (attrValue(raw, 'rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/);
      const as = attrValue(raw, 'as') ?? '';
      if (rel.includes('stylesheet') || rel.includes('prefetch') || (rel.includes('preload') && as !== '')) one('href');
      if (rel.includes('preload') && as.toLowerCase() === 'image') urls.push(...srcsetUrls(attrValue(raw, 'imagesrcset') ?? ''));
    }
  }
  // SVG reads href and ignores xlink:href when both are present (probed on <image> and <feImage>).
  if (svg && (name === 'image' || name === 'feimage')) one(attrValue(raw, 'href') !== null ? 'href' : 'xlink:href');
  // url(#id) in a presentation attribute is a same-document reference, never a request.
  if (svg) for (const a of SVG_URL_ATTRS) urls.push(...cssRequestUrls(`${a}:${attrValue(raw, a) ?? ''}`).filter((u) => !normalizeUrl(u).startsWith('#')));
  if (ns === 'html' && name === 'meta' && /^refresh$/i.test(attrValue(raw, 'http-equiv') ?? '')) {
    const target = /^[\t\n\f\r ]*[0-9.]+[\t\n\f\r ]*(?:[;,][\t\n\f\r ]*|[\t\n\f\r ]+)?(?:url[\t\n\f\r ]*=[\t\n\f\r ]*)?(?:"([^"]*)"|'([^']*)'|(.*))$/is.exec(attrValue(raw, 'content') ?? '');
    if (target) urls.push((target[1] ?? target[2] ?? target[3] ?? '').trim());
  }
  return urls;
}

// Requests made by one scanned document, and by every iframe srcdoc inside it.
// `inheritedBase` is the base URL of the document that holds the markup: a
// srcdoc document inherits its parent's, and its own <base> wins. A srcdoc
// nested past MAX_SRCDOC_DEPTH is probed one level (`shallow`) and, if it holds
// a request or yet another srcdoc, reported as `capped` instead of passing.
const requestCache = new WeakMap();
function scanRequests(doc, depth = 0, inheritedBase = new URL(DOCUMENT_URL), shallow = false) {
  if (depth === 0 && requestCache.has(doc)) return requestCache.get(doc);
  const remote = [];
  const capped = [];
  // A relative URL resolves against an absolute remote <base href>, so it is
  // a remote request too. Only the first <base> counts, as in a browser.
  let base = inheritedBase;
  const baseTag = doc.tags.find((t) => t.name === 'base' && attrValue(t.raw, 'href') !== null);
  if (baseTag) {
    try { base = new URL(urlValue(baseTag.raw, 'href'), inheritedBase); } catch { /* an unparsable base is ignored */ }
  }
  // Classify the resolved URL rather than pattern-match the text, so every
  // spelling the URL parser accepts counts: `https:example.com`, `https:/x`,
  // `https:\\x`, `//host`. Probed in Chromium with JavaScript off: a URL with an
  // authority is aborted by the route whatever its scheme (http, ftp, ws, gopher,
  // a custom one), a file: URL naming another host fails to load, and a URL with
  // no authority (`urn:`, `blob:`, `about:`, `data:`) is never requested.
  // A URL the parser rejects is not requested.
  const isRemote = (u, { sameDocFragment = false } = {}) => {
    const v = normalizeUrl(u);
    if (v === '' || v.startsWith('{{')) return false;
    // A fragment-only URL is a resource request that resolves against the base
    // (`<img src="#logo">`), but a same-document reference in `<use>` and CSS
    // `url(#id)`, which is never fetched.
    if (sameDocFragment && v.startsWith('#')) return false;
    try {
      const url = new URL(v, base);
      if (url.protocol === 'chrome:') return false; // blocked before the route sees it (probed)
      return url.protocol === 'file:' ? url.host !== '' && url.host !== 'localhost' : url.host !== '';
    } catch {
      return false;
    }
  };
  for (const tagInfo of doc.tags) {
    const { raw, name, ns, media } = tagInfo;
    // An svg or math iframe is a foreign element and loads no srcdoc (probed).
    if (name === 'iframe' && ns === 'html') {
      const srcdoc = attrValue(raw, 'srcdoc');
      if (srcdoc !== null) {
        if (shallow) capped.push(excerpt(raw));
        else if (depth < MAX_SRCDOC_DEPTH) {
          const inner = scanRequests(scanHtml(srcdoc), depth + 1, base);
          remote.push(...inner.remote);
          capped.push(...inner.capped);
        } else {
          const innerDoc = scanHtml(srcdoc);
          const inner = scanRequests(innerDoc, depth + 1, base, true);
          if (inner.remote.length || inner.capped.length || LOCAL_RULES.some(({ detect }) => detect(innerDoc).length)) capped.push(excerpt(raw));
        }
      }
    }
    if (fetchedUrls(tagInfo).some((u) => isRemote(u))) remote.push(excerpt(raw));
  }
  // Only CSS-bearing content: <style> bodies and style="" values. A title or
  // visible text that happens to contain url(...) is prose, not a request.
  const sources = doc.styles
    // A style element with another type is not CSS; browsers ignore it.
    .filter(({ tag }) => /^(?:text\/css)?$/i.test(attrValue(tag, 'type') ?? ''))
    .map(({ body }) => body);
  for (const { raw } of doc.tags) {
    const inline = attrValue(raw, 'style');
    if (inline) sources.push(inline);
  }
  for (const source of sources) {
    for (const u of cssRequestUrls(source)) if (isRemote(u, { sameDocFragment: true })) remote.push(excerpt(`url(${u})`));
  }
  const result = { remote, capped };
  if (depth === 0) requestCache.set(doc, result);
  return result;
}

// These read one document's own tags. A template holds more than one document when an iframe has a srcdoc, and
// each is printed with JavaScript off, so a script, handler, script URL or refresh in a srcdoc is as dead as one outside.
const LOCAL_RULES = [
  {
    id: 'script-element',
    rule: 'A <script> never runs: the renderer disables JavaScript.',
    detect: (doc) => doc.tags.filter((t) => t.name === 'script').map((t) => excerpt(t.raw)),
  },
  {
    id: 'embedded-content',
    rule: '<iframe>, <object> and <embed> pull in content the renderer will not load.',
    // An iframe with srcdoc carries its own static markup, which renders with
    // JavaScript off and needs no request.
    detect: (doc) => doc.tags
      .filter((t) => t.ns === 'html' && ['iframe', 'object', 'embed'].includes(t.name) && !(t.name === 'iframe' && attrNames(t.raw).includes('srcdoc')))
      .map((t) => excerpt(t.raw)),
  },
  {
    id: 'event-handler-attribute',
    rule: 'An on* attribute never fires: the renderer disables JavaScript.',
    detect: (doc) => doc.tags
      .filter((t) => attrNames(t.raw).some((n) => /^on[a-z]+$/.test(n)))
      .map((t) => excerpt(t.raw)),
  },
  {
    id: 'script-url',
    rule: 'A javascript: or data:text/html URL is never followed.',
    detect: (doc) => doc.tags
      .filter((t) => ['href', 'src', 'xlink:href'].some((a) => /^(?:javascript:|data:text\/html)/i.test(urlValue(t.raw, a) ?? '')))
      .map((t) => excerpt(t.raw)),
  },
  {
    id: 'meta-refresh',
    // Probed: the refresh fires after its delay; a local target replaces the printed page, a remote one is aborted and leaves an error page.
    rule: 'A <meta http-equiv="refresh"> navigates the page after its delay: a local target replaces the document being printed, and a remote one is aborted and leaves an error page.',
    // A refresh with no content, or content that does not start with a time, does nothing.
    detect: (doc) => doc.tags
      .filter((t) => t.name === 'meta' && /^refresh$/i.test(attrValue(t.raw, 'http-equiv') ?? '') && REFRESH_RE.test(attrValue(t.raw, 'content') ?? ''))
      .map((t) => excerpt(t.raw)),
  },
];

const nestedDocuments = new WeakMap();
// The document and every iframe srcdoc in it, to the depth scanRequests reads in full.
function documentsIn(doc, depth = 0) {
  if (depth === 0 && nestedDocuments.has(doc)) return nestedDocuments.get(doc);
  const docs = [doc];
  if (depth < MAX_SRCDOC_DEPTH) {
    for (const { raw, name, ns } of doc.tags) {
      const srcdoc = name === 'iframe' && ns === 'html' ? attrValue(raw, 'srcdoc') : null;
      if (srcdoc !== null) docs.push(...documentsIn(scanHtml(srcdoc), depth + 1));
    }
  }
  if (depth === 0) nestedDocuments.set(doc, docs);
  return docs;
}

const RENDER_RULES = [
  ...LOCAL_RULES.map((rule) => ({ ...rule, detect: (doc) => documentsIn(doc).flatMap((d) => rule.detect(d)) })),
  {
    id: 'remote-subresource',
    rule: 'Every request that is not file: or data: is aborted, and a file: URL that names another host does not load, so a remote image, stylesheet or font is dropped without a message.',
    detect: (doc) => scanRequests(doc).remote,
  },
  {
    id: 'srcdoc-depth-limit',
    rule: `An iframe srcdoc nested deeper than ${MAX_SRCDOC_DEPTH} levels could not be checked.`,
    detect: (doc) => scanRequests(doc).capped,
  },
];

/**
 * Report what the renderer silently drops from a template.
 * Advisory: every finding is a warning, and this never throws.
 *
 * @param {string} path Template file to read.
 * @returns {{ok: boolean, path: string, findings: object[], error: string|null}}
 */
export function renderLint(path) {
  const result = { ok: true, path, findings: [], error: null };
  try {
    const doc = scanHtml(readFileSync(path, 'utf-8'));
    for (const { id, rule, detect } of RENDER_RULES) {
      for (const detail of detect(doc)) {
        result.findings.push({ id, rule, severity: 'warning', detail });
      }
    }
  } catch (err) {
    result.error = err?.message || String(err);
  }
  result.ok = result.findings.length === 0 && !result.error;
  return result;
}

// ---- User template audit (#5777) ----

const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;

function placeholdersOf(path) {
  return new Set((readFileSync(path, 'utf-8').match(PLACEHOLDER_RE) || []).map((t) => t.slice(2, -2)));
}

// The slots the shipped templates of one kind all keep: those in the base template
// that every shipped named variant also carries. A slot a shipped variant drops
// (INTERESTS, say) is optional by the project's own example, so a user copy
// dropping it is not drift. With no shipped variant there is nothing to tell
// optional from core, so nothing is judged (null) rather than every slot flagged.
function coreSlots(system) {
  const base = system.get('standard');
  const variants = [...system.values()].filter((e) => e.name !== 'standard');
  if (!base || variants.length === 0) return null;
  let core = placeholdersOf(base.path);
  for (const v of variants) {
    const have = placeholdersOf(v.path);
    core = new Set([...core].filter((slot) => have.has(slot)));
  }
  return core;
}

/**
 * Advisory audit of the user's own templates (those under data/templates/).
 * Returns one finding per template that has a problem, and [] when all is well:
 *   - invalid: it does not resolve (missing required placeholders, or a declared
 *     section with no partial). The message is the resolver's own.
 *   - name: its file name is not in the normalized form the resolver looks for, so
 *     no name selects it.
 *   - drifted: it lacks a slot every shipped variant of its kind keeps.
 * Never throws for a template problem and never blocks a render; callers decide
 * how loudly to report.
 */
export function auditUserTemplates({ dir = DEFAULT_TEMPLATES_DIR, userDir = DEFAULT_USER_TEMPLATES_DIR(), format = 'html' } = {}) {
  assertFormat(format);
  const findings = [];
  for (const kind of Object.keys(KINDS)) {
    const system = discoverIn(kind, { dir, format }, 'system');
    const core = coreSlots(system);
    for (const entry of discoverIn(kind, { dir: userDir, format }, 'user').values()) {
      const problems = [];
      // resolveTemplate() normalizes every name it is given (kebab), and discovery
      // accepts the raw file name, so a file such as cv-template.a--b.html lists as
      // "a--b" yet no name selects it: both "a--b" and "a-b" look for cv-template.a-b.html.
      // Say that, and the name to use, instead of the resolver's "not found".
      const usable = kebab(entry.name);
      if (usable !== entry.name) {
        problems.push({
          type: 'name',
          detail: `no name selects this file: names are normalized to "${usable}". Rename it to ${KINDS[kind].prefix}.${usable}.${format}`,
        });
      } else {
        try {
          resolveTemplate(kind, entry.name, { dir, userDir, format });
        } catch (err) {
          problems.push({ type: 'invalid', detail: err.message });
        }
      }
      if (core) {
        const have = placeholdersOf(entry.path);
        const missing = [...core].filter((slot) => !have.has(slot)).sort();
        if (missing.length) problems.push({ type: 'drifted', missing });
      }
      if (problems.length) findings.push({ kind, name: entry.name, path: entry.path, problems });
    }
  }
  return findings;
}

export function loadProfileDefault(kind, { profilePath = DEFAULT_PROFILE_PATH, strict = false } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  if (!existsSync(profilePath)) return null;
  let doc;
  try {
    doc = loadYaml(readFileSync(profilePath, 'utf-8')) || {};
  } catch (err) {
    if (strict) {
      throw new Error(
        `Failed to parse profile YAML at ${profilePath}. Fix the YAML syntax and retry the update. ${err?.message || err}`,
        { cause: err },
      );
    }
    return null;
  }
  let node = doc;
  for (const key of cfg.profileKey) node = node?.[key];
  return typeof node === 'string' && node.trim() ? node.trim() : null;
}

export function resolveTemplate(kind, name, opts = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  const {
    dir,
    userDir,
    format = 'html',
    profilePath = DEFAULT_PROFILE_PATH,
    fallback = false,
  } = opts;
  assertFormat(format);

  const explicit = Boolean(name && String(name).trim());
  let chosen = kebab(explicit ? name : loadProfileDefault(kind, { profilePath }) || 'standard');
  const fileFor = (n) => (n === 'standard' ? `${cfg.prefix}.${format}` : `${cfg.prefix}.${n}.${format}`);

  // Resolution goes through the same discovery as listTemplates, so a name that
  // lists is a name that resolves. Constructing `dir/fileFor(chosen)` directly
  // would find flat templates only: a pack would list fine and then throw here,
  // which is the failure mode that passes review because the demo path works.
  // Every by-name caller lands here — build-cv-latex.mjs, generate-cover-letter.mjs.
  const found = discover(kind, { dir: dir ?? DEFAULT_TEMPLATES_DIR, format, userDir: userDirFor(dir, userDir) });

  let entry = found.get(chosen);
  if (!entry && fallback && chosen !== 'standard') {
    chosen = 'standard';
    entry = found.get(chosen);
  }
  if (!entry) {
    throw new Error(`Template not found for kind=${kind} name=${chosen} (${fileFor(chosen)})`);
  }
  const path = entry.path;
  if (format === 'html') {
    // Name the file that is actually short, not the flat filename it would
    // have had. For a pack these differ, and the flat name points at nothing.
    const where = entry.pack ? `${entry.pack}/${fileFor(chosen)}` : fileFor(chosen);
    const v = validateTemplate(path, kind);
    if (!v.ok) {
      throw new Error(
        `Template ${where} missing required placeholders: ${v.missing.map((m) => `{{${m}}}`).join(', ')}`
      );
    }
    // A template that declares its sections must ship them (#3852). Checked
    // at resolve for the same reason the placeholders are: every by-name
    // caller lands here, and a name that resolves and then fails to render is
    // the failure that passes review because the demo path works.
    let sections;
    try {
      sections = checkDeclaredSections(path);
    } catch (err) {
      throw new Error(`Template ${where}: ${err.message}`);
    }
    if (sections.missing.length) {
      throw new Error(
        `Template ${where} declares sections it does not ship: `
          + sections.missing.map((n) => `sections/${n}.html`).join(', ')
          + '. A declared section must have a partial — add the file, or drop it from the manifest\'s "sections" list.'
      );
    }
  }
  return path;
}

// ---- CLI ----
const isMain = isMainModule(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const kind = argv[1];
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const positionals = argv.slice(2).filter((a) => !a.startsWith('--'));
  const format = flags.format || 'html';
  try {
    if (cmd === 'list') {
      const items = listTemplates(kind, { format }).map(({ name, displayName }) => ({ name, displayName }));
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    } else if (cmd === 'resolve') {
      const name = positionals[0];
      process.stdout.write(resolveTemplate(kind, name, { format, fallback: Boolean(flags.fallback) }) + '\n');
    } else if (cmd === 'lint') {
      // Advisory by construction: exit 0 whatever it finds. resolveTemplate is
      // deliberately left alone — a lint finding must never block a render.
      //
      // HTML only, and loudly so. Every detector is an HTML pattern, so a .tex
      // template would come back with zero findings — a clean bill of health
      // that means nothing was looked at.
      if (format !== 'html') {
        throw new Error(`lint reads HTML templates only; --format=${format} would report "no findings" without checking anything`);
      }
      const name = positionals[0];
      // No process.exit after the write: on a pipe it can cut the JSON short.
      const path = resolveTemplate(kind, name, { format, fallback: Boolean(flags.fallback) });
      const report = flags.render ? renderLint(path) : atsLint(path, kind);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stderr.write('Usage: node cv-templates.mjs <list|resolve|lint> <cv|cover> [name] [--format=html|tex] [--fallback] [--render]\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

