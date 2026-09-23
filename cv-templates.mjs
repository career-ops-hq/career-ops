#!/usr/bin/env node
// cv-templates.mjs — discover, resolve, and validate CV / cover-letter templates.
// Single source of truth for "which template file, and is it usable?".
// Backward-compatible: with no config and no named files, resolves the base
// templates/cv-template.html (name "standard"), identical to prior behavior.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { isMainModule } from './lib/is-main-module.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES_DIR = resolve(__dirname, 'templates');
const DEFAULT_PROFILE_PATH =
  process.env.CAREER_OPS_PROFILE || resolve(__dirname, 'config', 'profile.yml');

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
    const kv = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2];
  }
  return meta;
}

// Build the entry a discovered template file contributes.
function entryFor(parsed, path, pack) {
  const meta = parseMeta(path);
  return {
    name: parsed.name,
    displayName: meta.name || prettify(parsed.name),
    path,
    format: parsed.format,
    meta,
    pack,
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
function discover(kind, { dir, format }) {
  const cfg = KINDS[kind];
  const found = new Map();
  if (!existsSync(dir)) return found;

  const claim = (parsed, path, pack) => {
    if (parsed.format !== format) return;
    const prior = found.get(parsed.name);
    if (prior) assertNoCollision(parsed.name, prior.path, path, dir);
    found.set(parsed.name, entryFor(parsed, path, pack));
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

export function listTemplates(kind, { dir = DEFAULT_TEMPLATES_DIR, format = 'html' } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  assertFormat(format);
  return [...discover(kind, { dir, format }).values()].sort((a, b) => a.name.localeCompare(b.name));
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

export function loadAtsRules(path = DEFAULT_ATS_RULES_PATH) {
  const doc = yaml.load(readFileSync(path, 'utf-8')) || {};
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
  for (const m of stripNonContent(html).matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const decl = m[1] ?? m[2];
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
  const attr = /([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
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
            reason: `document language is "${lang}"; the accepted-header list is English only`,
          });
          continue;
        }
      }

      const detector = rule.detect ? ATS_DETECTORS[rule.detect] : null;
      if (!detector) {
        result.skipped.push({
          id: rule.id,
          rule: rule.rule,
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

export function loadProfileDefault(kind, { profilePath = DEFAULT_PROFILE_PATH } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  if (!existsSync(profilePath)) return null;
  let doc;
  try {
    doc = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
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
    dir = DEFAULT_TEMPLATES_DIR,
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
  const found = discover(kind, { dir, format });

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
    const v = validateTemplate(path, kind);
    if (!v.ok) {
      // Name the file that is actually short, not the flat filename it would
      // have had. For a pack these differ, and the flat name points at nothing.
      const where = entry.pack ? `${entry.pack}/${fileFor(chosen)}` : fileFor(chosen);
      throw new Error(
        `Template ${where} missing required placeholders: ${v.missing.map((m) => `{{${m}}}`).join(', ')}`
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
      process.stdout.write(JSON.stringify(atsLint(resolveTemplate(kind, name, { format }), kind), null, 2) + '\n');
    } else {
      process.stderr.write('Usage: node cv-templates.mjs <list|resolve|lint> <cv|cover> [name] [--format=html|tex] [--fallback]\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
