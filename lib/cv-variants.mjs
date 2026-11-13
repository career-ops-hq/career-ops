// CV content variants (#6792): data/cv-variants/<name>.md reorder, condense or
// omit what cv.md says and never add a claim. cv.md stays the only fact source.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { kebab } from '../cv-templates.mjs';
import { parseCvExperience, checkTitles } from '../cv-title-check.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';

const dirOf = (root) => join(root, 'data', 'cv-variants');

// No name means cv.md. A named variant that is missing or does not parse
// throws: it never falls back silently.
export function resolveVariant(name, { root = getCareerOpsRoot() } = {}) {
  if (!name) return join(root, 'cv.md');
  const path = join(dirOf(root), `${kebab(name)}.md`);
  if (!existsSync(path)) throw new Error(`CV variant "${name}" not found: expected ${path}`);
  if (parseCvExperience(readFileSync(path, 'utf-8')).length === 0) {
    throw new Error(`CV variant "${name}" could not be parsed: no experience entries found in ${path}`);
  }
  return path;
}

// Problems: parse (no entries), title (differs from cv.md), facts (claims cv.md
// does not support). Omitting cv.md content is allowed, so it is not checked.
export function checkVariant(name, { root = getCareerOpsRoot() } = {}) {
  const path = join(dirOf(root), `${kebab(name)}.md`);
  const text = readFileSync(path, 'utf-8');
  const problems = [];
  const entries = parseCvExperience(text);
  if (entries.length === 0) {
    problems.push({ type: 'parse', detail: 'no experience entries could be parsed' });
  } else {
    const cvPath = join(root, 'cv.md');
    const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf-8') : '';
    for (const m of checkTitles(parseCvExperience(cvText), entries).mismatches) {
      problems.push({ type: 'title', detail: `${m.company} (${m.dates}): cv.md says "${m.cvTitle}", variant says "${m.tailoredTitle}"` });
    }
    // cv.md alone is the source: article-digest.md must not make a claim valid here.
    const r = verifyFacts(text, { sourcePaths: [cvPath], configPath: join(root, 'config', 'cv-facts.json'), cwd: root });
    const claims = [...r.invented, ...r.forbidden, ...r.unsupportedFacts.map((f) => f.value ?? JSON.stringify(f))];
    if (claims.length) problems.push({ type: 'facts', detail: `not supported by cv.md: ${claims.join('; ')}` });
  }
  return { name: kebab(name), path, problems };
}

export function auditCvVariants({ root = getCareerOpsRoot() } = {}) {
  const dir = dirOf(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => checkVariant(f.slice(0, -3), { root }))
    .filter((r) => r.problems.length);
}
