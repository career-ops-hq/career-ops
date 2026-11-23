// CV content variants (#6792): data/cv-variants/<name>.md reorder, condense or
// omit what cv.md says and never add a claim. cv.md stays the only fact source.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { kebab } from '../cv-templates.mjs';
import { parseCvExperience, checkTitles } from '../cv-title-check.mjs';
import { findExperienceSections, headingText } from './cv-markdown.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';

const dirOf = (root) => join(root, 'data', 'cv-variants');

// parseCvExperience takes the next line after the title as dates without
// checking it. Loose check: a dates line has a digit or present/current/至今,
// and is not a list item (a bullet means the dates line is missing).
const parseJobs = (text) => parseCvExperience(text).filter((e) => /\d|present|current|至今/i.test(e.dates) && !/^\s*(?:[-*+]|\d+\.)\s/.test(e.dates));

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
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => {
      const base = f.slice(0, -3);
      // checkVariant reads kebab(base).md, which would be another file or none.
      if (kebab(base) === base) return checkVariant(base, { root });
      return { name: base, path: join(dir, f), problems: [{ type: 'name', detail: `--variant cannot select this name: rename it ${kebab(base) || '<name>'}.md` }] };
    })
    .filter((r) => r.problems.length);
}
