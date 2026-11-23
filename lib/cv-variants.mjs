// CV content variants (#6792): data/cv-variants/<name>.md reorder, condense or
// omit what cv.md says and never add a claim. cv.md stays the only fact source.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot, getProfilePath } from '../path-resolver.mjs';
import { kebab } from '../cv-templates.mjs';
import { parseCvExperience, checkTitles } from '../cv-title-check.mjs';
import { findExperienceSections, headingText } from './cv-markdown.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { loadYaml } from './yaml-document.mjs';

const dirOf = (root) => join(root, 'data', 'cv-variants');

// parseCvExperience takes the next line after the title as dates without
// checking it. A dates line has a year (2021, '21), a month/year (03/21) or
// the word present/current/至今, and is not a list item (a bullet means the
// dates line is missing). A bare number ("Built 3 pipelines") is prose, not dates.
const DATE_EXPR = /(?<!\d)(?:19|20)\d{2}(?!\d)|['’]\d{2}(?!\d)|(?<!\d)\d{1,2}\/\d{2,4}(?!\d)|\b(?:present|current)\b|至今/i;
const parseJobs = (text) => parseCvExperience(text).filter((e) => DATE_EXPR.test(e.dates) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(e.dates));

// Companies of present `###` entries that parseCvExperience dropped (lost
// title or dates marker). An omitted job has no heading, so it is not listed.
function unparsedJobs(text) {
  const parsed = parseJobs(text).map((e) => e.company);
  const out = [];
  for (const lines of findExperienceSections(text)) {
    for (const line of lines) {
      const h = headingText(line, 3);
      const company = h === null ? '' : h.split(/\s+[-–—]{1,2}\s+/)[0].trim();
      if (!company) continue;
      const at = parsed.indexOf(company);
      if (at >= 0) parsed.splice(at, 1);
      else out.push(company);
    }
  }
  return out;
}

// Bullets of each `###` entry, keyed by its parsed {company, dates}. Entries
// parseCvExperience dropped have no key, so they are not listed here.
const normBullet = (b) => b.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
function entryBullets(text) {
  const parsed = parseJobs(text);
  const out = [];
  for (const lines of findExperienceSections(text)) {
    let cur = null;
    for (const line of lines) {
      if (/^#{2,3}\s/.test(line)) {
        const h = headingText(line, 3);
        const company = h === null ? '' : h.split(/\s+[-–—]{1,2}\s+/)[0].trim();
        const hit = company && parsed[0]?.company === company ? parsed.shift() : null;
        cur = hit ? { ...hit, bullets: [] } : null;
        if (cur) out.push(cur);
      } else if (cur && /^\s*[-*+]\s+/.test(line)) cur.bullets.push(normBullet(line.replace(/^\s*[-*+]\s+/, '')));
    }
  }
  return out;
}

// A variant bullet that cv.md says word for word under a different employer,
// and not under its own, moved a claim to another job. Reworded bullets are
// the fact gate's business. ponytail: exact-statement match only, no fuzzy.
export function attributionProblems(variantText, cvText) {
  const cv = entryBullets(cvText);
  const out = [];
  for (const v of entryBullets(variantText)) {
    const own = cv.find((c) => c.company === v.company && c.dates === v.dates);
    if (!own) continue; // reported as `added`
    for (const b of v.bullets) {
      if (own.bullets.includes(b)) continue;
      const other = cv.find((c) => c !== own && c.bullets.includes(b));
      if (other) out.push({ type: 'attribution', detail: `${v.company} (${v.dates}): "${b}" is under ${other.company} in cv.md, not here` });
    }
  }
  return out;
}

// cv.variants in config/profile.yml maps a variant name to the archetype names
// it serves. Returns [{name, archetypes (normalised), problem?}]; an unreadable
// profile or no key means no mapping, as for cv.max_pages.
const normArchetype = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
function variantMap(root) {
  let raw;
  try {
    const path = getProfilePath(root);
    raw = existsSync(path) ? loadYaml(readFileSync(path, 'utf-8'))?.cv?.variants : null;
  } catch { return []; }
  if (raw == null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return [{ name: 'cv.variants', archetypes: [], problem: 'must map a variant name to a list of archetype names' }];
  return Object.entries(raw).map(([name, list]) => {
    const ok = Array.isArray(list) && list.length > 0 && list.every((a) => typeof a === 'string' && a.trim());
    const problem = !ok ? 'must be a non-empty list of archetype names'
      : kebab(name) !== name ? `variant name must be kebab-case (${kebab(name) || '<name>'})` : null;
    return { name, archetypes: Array.isArray(list) ? list.filter((a) => typeof a === 'string' && a.trim()).map(normArchetype) : [], problem };
  });
}

// The variant mapped to an archetype (exact after case and whitespace), or
// null. Two variants claiming it is ambiguous and throws, never picks one.
export function variantForArchetype(archetype, { root = getCareerOpsRoot() } = {}) {
  const want = normArchetype(archetype ?? '');
  if (!want) return null;
  const hits = variantMap(root).filter((e) => !e.problem && e.archetypes.includes(want)).map((e) => e.name);
  if (hits.length > 1) throw new Error(`archetype "${archetype}" is mapped by more than one variant (${hits.join(', ')}) in cv.variants: keep one`);
  return hits[0] ?? null;
}

// No name means cv.md. A named variant that is missing or does not parse
// throws: it never falls back silently.
export function resolveVariant(name, { root = getCareerOpsRoot() } = {}) {
  if (!name) return join(root, 'cv.md');
  const path = join(dirOf(root), `${kebab(name)}.md`);
  if (!existsSync(path)) throw new Error(`CV variant "${name}" not found: expected ${path}`);
  const text = readFileSync(path, 'utf-8');
  if (parseJobs(text).length === 0) {
    throw new Error(`CV variant "${name}" could not be parsed: no experience entries found in ${path}`);
  }
  const lost = unparsedJobs(text);
  if (lost.length) throw new Error(`CV variant "${name}" could not be parsed: no title or dates found for ${lost.join(', ')} in ${path}`);
  return path;
}

// Problems: parse (no entries, or a present job that did not parse), ambiguous (title comparison unresolved), title (differs from cv.md), added (an entry cv.md
// lacks), facts (claims cv.md does not support), advisory (warn-only phrases and facts). Omitting cv.md content is allowed, so it is not checked.
export function checkVariant(name, { root = getCareerOpsRoot() } = {}) {
  const path = join(dirOf(root), `${kebab(name)}.md`);
  const text = readFileSync(path, 'utf-8');
  const problems = [];
  const entries = parseJobs(text);
  if (entries.length === 0) {
    problems.push({ type: 'parse', detail: 'no experience entries could be parsed' });
  } else if (unparsedJobs(text).length) {
    problems.push({ type: 'parse', detail: `no title or dates found for ${unparsedJobs(text).join(', ')}` });
  } else {
    const cvPath = join(root, 'cv.md');
    const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf-8') : '';
    const titles = checkTitles(parseCvExperience(cvText), entries);
    for (const m of titles.mismatches) {
      problems.push({ type: 'title', detail: `${m.company} (${m.dates}): cv.md says "${m.cvTitle}", variant says "${m.tailoredTitle}"` });
    }
    for (const a of titles.ambiguous) {
      problems.push({ type: 'ambiguous', detail: `${a.company} (${a.dates}): titles not compared, cv.md has [${a.cvTitles.join('; ')}], variant has [${a.tailoredTitles.join('; ')}]` });
    }
    // An entry with no cv.md {company, dates} counterpart is an added claim (a new job or rewritten dates).
    for (const e of titles.unmatchedTailored) problems.push({ type: 'added', detail: `${e.company} (${e.dates}): no entry with this company and dates in cv.md` });
    problems.push(...attributionProblems(text, cvText));
    // cv.md alone is the source: article-digest.md must not make a claim valid here.
    const r = verifyFacts(text, { sourcePaths: [cvPath], configPath: join(root, 'config', 'cv-facts.json'), cwd: root, strictSource: true });
    const claims = [...r.invented, ...r.forbidden, ...r.unsupportedFacts.map((f) => f.value ?? JSON.stringify(f))];
    if (claims.length) problems.push({ type: 'facts', detail: `not supported by cv.md: ${claims.join('; ')}` });
    if (r.coverage) problems.push({ type: 'facts', detail: `fact check could not cover this variant: ${r.coverage.message}` });
    // Non-blocking: phrases and facts the gate only warns about.
    const advisory = [...r.warnings, ...r.advisoryFacts.map((f) => f.value ?? JSON.stringify(f))];
    if (advisory.length) problems.push({ type: 'advisory', detail: `advisory only: ${advisory.join('; ')}` });
  }
  return { name: kebab(name), path, problems };
}

export function auditCvVariants({ root = getCareerOpsRoot() } = {}) {
  const dir = dirOf(root);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  return [...files
    .map((f) => {
      const base = f.slice(0, -3);
      // checkVariant reads kebab(base).md, which would be another file or none.
      if (kebab(base) === base) {
        // One unreadable file must not hide the findings for the others.
        try {
          return checkVariant(base, { root });
        } catch (err) {
          return { name: base, path: join(dir, f), problems: [{ type: 'read', detail: `could not be read: ${err.message}` }] };
        }
      }
      return { name: base, path: join(dir, f), problems: [{ type: 'name', detail: `--variant cannot select this name: rename it ${kebab(base) || '<name>'}.md` }] };
    })
    .filter((r) => r.problems.length), ...mappingFindings(root, dir)];
}

// cv.variants entries that name a missing file, are malformed, or claim an
// archetype another variant claims. Warn-only, like the file audit.
function mappingFindings(root, dir) {
  const entries = variantMap(root);
  const owners = new Map();
  for (const e of entries.filter((x) => !x.problem)) for (const a of new Set(e.archetypes)) owners.set(a, [...(owners.get(a) ?? []), e.name]);
  return entries.map((e) => {
    const problems = [];
    if (e.problem) problems.push({ type: 'map-invalid', detail: `cv.variants.${e.name}: ${e.problem}` });
    else {
      if (!existsSync(join(dir, `${e.name}.md`))) problems.push({ type: 'map-missing', detail: `cv.variants.${e.name} maps archetypes but data/cv-variants/${e.name}.md does not exist` });
      for (const a of e.archetypes) {
        if (owners.get(a).length > 1) problems.push({ type: 'map-duplicate', detail: `cv.variants: archetype "${a}" is mapped by ${owners.get(a).join(' and ')}` });
      }
    }
    return { name: e.name, path: getProfilePath(root), problems };
  }).filter((r) => r.problems.length);
}
