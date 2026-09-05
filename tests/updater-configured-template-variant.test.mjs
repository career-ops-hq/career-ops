/**
 * updater-configured-template-variant.test.mjs — a user-authored named CV/
 * cover-letter template variant, created per cv-templates.mjs's own naming
 * convention (`templates/cv-template.{name}.html`, `templates/cover-letter-
 * template.{name}.html` — see its KINDS/parseFilename) and pointed at from
 * config/profile.yml (`cv.template` / `cover_letter.template`), must survive
 * the stale-file prune in `apply()` even though it never exists upstream.
 *
 * Distinct from #3636 / PR #3638 (generated PER-APPLICATION output such as
 * `templates/cv-jane-doe-acme-corp.html`): this covers a genuinely authored
 * template VARIANT, whose filename is, by design, indistinguishable from a
 * real shipped variant (`cv-template.zh-minimal.html`) on shape alone. The
 * only signal that separates "my personal variant" from "a shipped variant
 * upstream has since removed, prune it" is whether config/profile.yml itself
 * names this variant as the active default — exactly what cv-templates.mjs's
 * resolveTemplate() already relies on to pick it for CV generation.
 *
 * Also pins the two-cycle failure mode that makes this a genuinely distinct
 * bug from what #2337's generic locally-modified-file protection already
 * covers: on the FIRST apply() after the file is created, it differs from
 * both the pre-update baseline and upstream, so locallyModifiedSystemFiles()
 * flags it as "at risk" and apply() preserves it (with a .bak) via
 * preservedPaths. But that protection is baseline-relative — the very next
 * "chore: auto-update system files" commit re-baselines to a tree that
 * already contains the (untouched) variant file, so on every SUBSEQUENT
 * apply() run it no longer differs from baseline, drops out of
 * locallyModifiedSystemFiles()'s result, and — being permanently absent
 * upstream — falls straight into the stale-file prune with nothing left to
 * protect it. staleSystemFiles() must therefore carry its own, baseline-
 * independent exemption instead of relying on the preservedPaths detour.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  staleSystemFiles,
  isUserConfiguredTemplateVariant,
  loadConfiguredTemplateVariants,
} from '../update-system.mjs';

console.log('\n🧪 Testing user-configured template-variant carve-out...');

// ── 1. isUserConfiguredTemplateVariant: name-matching classification ──
{
  const configured = { cv: 'bw', cover: 'concise' };

  const shouldMatch = [
    ['templates/cv-template.bw.html', true],
    ['templates/cover-letter-template.concise.html', true],
    ['templates/cv-template.bw.tex', true],
  ];
  const shouldNotMatch = [
    ['templates/cv-template.zh-minimal.html', false], // real shipped variant, not the configured one
    ['templates/cv-template.html', false], // base file — never a "named variant"
    ['templates/cover-letter-template.html', false],
    ['templates/cv-template.bw.png', false], // wrong extension, not html/tex
    ['output/cv-template.bw.html', false], // right basename shape, wrong directory
    ['templates/resume-template.bw.html', false], // not one of the two recognized prefixes
  ];

  const wrong = [...shouldMatch, ...shouldNotMatch].filter(
    ([file, expected]) => isUserConfiguredTemplateVariant(file, configured) !== expected,
  );
  if (wrong.length === 0) {
    pass('a configured variant file is recognized by name; unrelated/unconfigured files are not');
  } else {
    fail(`misclassified: ${JSON.stringify(wrong.map(([f]) => f))}`);
  }

  // No configuration at all (default profile, or profile.yml missing/unreadable)
  // must never exempt anything — this is the "fall back to prior behavior" path.
  if (!isUserConfiguredTemplateVariant('templates/cv-template.bw.html', {})) {
    pass('an unconfigured install exempts nothing (safe default)');
  } else {
    fail('a file was exempted with no configured variant at all');
  }
}

// ── 4. Exercise the same lazy-import wiring that apply() uses ─────────────
// A pure staleSystemFiles() test cannot catch a renamed/missing cv-templates.mjs
// export if apply()'s broad compatibility catch swallows the import failure.
// Use a fixture profile through the helper's explicit path, then pin that
// apply() calls the helper and passes its result into the prune call.
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-configured-variant-'));
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv:\n  template: BW\ncover_letter:\n  template: Concise\n');
  try {
    const configured = await loadConfiguredTemplateVariants({ profilePath: profile });
    if (configured.cv === 'bw' && configured.cover === 'concise') {
      pass('apply helper resolves configured variants through cv-templates.mjs lazy wiring');
    } else {
      fail(`lazy wiring returned ${JSON.stringify(configured)}`);
    }
    const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
    const callsHelper = /const configuredTemplateVariants = await loadConfiguredTemplateVariants\(\);/.test(source);
    const passesToPrune = /staleSystemFiles\([\s\S]*configuredTemplateVariants/.test(source);
    if (callsHelper && passesToPrune) pass('apply() passes lazy-resolved variants into staleSystemFiles()');
    else fail('apply() lazy variant wiring is missing or disconnected from staleSystemFiles()');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. staleSystemFiles: the configured variant survives; an unconfigured or ──
// ──    differently-named cv-template.*.html is still pruned as before        ──
{
  const local = [
    'templates/cv-template.bw.html', // configured — must survive
    'templates/cv-template.other.html', // NOT configured — regression guard
    'templates/cv-template.html', // still shipped upstream — never stale anyway
    'templates/cv-template.zh-minimal.html', // shipped variant upstream just removed — still pruned
  ];
  const remote = ['templates/cv-template.html'];
  const system = ['templates/'];
  const configuredVariants = { cv: 'bw' };

  const stale = staleSystemFiles(local, remote, system, undefined, configuredVariants);

  if (!stale.includes('templates/cv-template.bw.html')) {
    pass('the configured template variant survives the prune even though it has no upstream counterpart');
  } else {
    fail('the configured template variant was pruned as stale');
  }
  if (stale.includes('templates/cv-template.other.html')) {
    pass('a differently-named cv-template.*.html (not the configured one) is still pruned — no blanket exemption');
  } else {
    fail('the carve-out over-widened: an unconfigured cv-template.*.html variant survived too');
  }
  if (stale.includes('templates/cv-template.zh-minimal.html')) {
    pass('a real shipped variant upstream removed is still pruned when it is not the configured one');
  } else {
    fail('a genuinely-removed-upstream shipped variant was incorrectly kept');
  }
  if (!stale.includes('templates/cv-template.html')) {
    pass('the base template file, still shipped upstream, is never treated as stale');
  } else {
    fail('templates/cv-template.html was incorrectly flagged as stale');
  }
}

// ── 3. staleSystemFiles: with NO configured variant at all, prior behavior ──
// ──    is unchanged — every absent-upstream cv-template.*.html is pruned    ──
{
  const local = ['templates/cv-template.bw.html', 'templates/cv-template.html'];
  const remote = ['templates/cv-template.html'];
  const system = ['templates/'];

  // Called with the 5-arg default ({}) — mirrors every pre-existing call site
  // that never passes configuredVariants at all (backward compatibility).
  const stale = staleSystemFiles(local, remote, system);
  if (stale.includes('templates/cv-template.bw.html')) {
    pass('with no configured variant, an absent-upstream cv-template.*.html is pruned exactly as before this fix');
  } else {
    fail('the fix changed behavior even when config/profile.yml sets no template — should be a no-op by default');
  }
}
