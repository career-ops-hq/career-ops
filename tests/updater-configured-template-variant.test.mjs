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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import {
  staleSystemFiles,
  isUserConfiguredTemplateVariant,
  configuredTemplateVariantPathsToPreserve,
  loadConfiguredTemplateVariants,
  configuredTemplateVariantsFromProfileSource,
  snapshotConfiguredTemplateVariants,
  REEXEC_FALLBACK_FILES,
} from '../update-system.mjs';

console.log('\n🧪 Testing user-configured template-variant carve-out...');

const zeroDependencyConfigured = configuredTemplateVariantsFromProfileSource(
  'cv:\n  output_format: html\n  template: "BW" # active\ncover_letter:\n  template: concise\n',
);
if (zeroDependencyConfigured.cv === 'bw' && zeroDependencyConfigured.cover === 'concise') {
  pass('self-reexec can read configured variants before js-yaml is installed');
} else {
  fail(`zero-dependency profile reader returned ${JSON.stringify(zeroDependencyConfigured)}`);
}
let zeroDependencyMalformedRejected = false;
try {
  configuredTemplateVariantsFromProfileSource('cv:\n  template: [unterminated\n');
} catch {
  zeroDependencyMalformedRejected = true;
}
if (zeroDependencyMalformedRejected) {
  pass('zero-dependency profile reader rejects ambiguous template syntax');
} else {
  fail('zero-dependency profile reader accepted malformed template syntax');
}

if (REEXEC_FALLBACK_FILES.includes('cv-templates.mjs')
    && REEXEC_FALLBACK_FILES.includes('lib/is-main-module.mjs')
    && REEXEC_FALLBACK_FILES.includes('path-resolver.mjs')) {
  pass('self-reexec checks out configured-template loading and data-root dependencies before apply');
} else {
  fail('self-reexec fallback omits a configured-template dependency needed before normal checkout');
}

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
    ['templates/cv-template.standard.html', false], // standard resolves to the unsuffixed base file
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

  // No configured template at all (default profile or a missing profile.yml)
  // must never exempt anything.
  if (!isUserConfiguredTemplateVariant('templates/cv-template.bw.html', {})) {
    pass('an unconfigured install exempts nothing (safe default)');
  } else {
    fail('a file was exempted with no configured variant at all');
  }
  if (!isUserConfiguredTemplateVariant('templates/cv-template.standard.html', { cv: 'standard' })) {
    pass('the standard template selection does not exempt a suffixed standard variant');
  } else {
    fail('a suffixed standard variant was incorrectly exempted from stale pruning');
  }
}

// ── 4. Exercise the same data-root snapshot that apply() uses ─────────────
// Use a temporary user data root and an upstream same-name/different-content
// blob. This verifies the runtime path reaches checkout preservation without
// relying on source-text regular expressions.
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-configured-variant-'));
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv:\n  template: BW\ncover_letter:\n  template: Concise\n');
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), readFileSync(profile, 'utf8'));
  mkdirSync(join(dir, 'templates'), { recursive: true });
  writeFileSync(join(dir, 'templates', 'cv-template.bw.html'), '<h1>user variant</h1>\n');
  try {
    const configured = await loadConfiguredTemplateVariants({ profilePath: profile });
    if (configured.cv === 'bw' && configured.cover === 'concise') {
      pass('apply helper resolves configured variants through cv-templates.mjs lazy wiring');
    } else {
      fail(`lazy wiring returned ${JSON.stringify(configured)}`);
    }
    const snapshot = await snapshotConfiguredTemplateVariants({
      dataRoot: dir,
      remoteFiles: ['templates/cv-template.bw.html'],
      readRemoteContent: () => '<h1>upstream variant</h1>\n',
    });
    if (snapshot.preservedPaths.length === 1 && snapshot.preservedPaths[0] === 'templates/cv-template.bw.html') {
      pass('apply snapshot reads the configured variant from the temporary data root and preserves it before checkout');
    } else {
      fail(`apply snapshot did not preserve the data-root variant: ${JSON.stringify(snapshot.preservedPaths)}`);
    }
    const unreadableSnapshot = await snapshotConfiguredTemplateVariants({
      dataRoot: dir,
      remoteFiles: ['templates/cv-template.bw.html'],
      readRemoteContent: () => { throw new Error('upstream blob unavailable'); },
    });
    if (unreadableSnapshot.preservedPaths.length === 1
      && unreadableSnapshot.preservedPaths[0] === 'templates/cv-template.bw.html') {
      pass('an unreadable upstream blob fails closed and preserves the configured local variant');
    } else {
      fail(`unreadable upstream blob did not preserve the variant: ${JSON.stringify(unreadableSnapshot.preservedPaths)}`);
    }
    let unreadableLocalRejected = false;
    try {
      await snapshotConfiguredTemplateVariants({
        dataRoot: dir,
        remoteFiles: ['templates/cv-template.bw.html'],
        readLocalContent: () => { throw new Error('local template unavailable'); },
        localPathExists: () => true,
      });
    } catch (err) {
      unreadableLocalRejected = err.message.includes('Refusing to update');
    }
    if (unreadableLocalRejected) {
      pass('an unreadable existing local variant aborts before checkout can overwrite it');
    } else {
      fail('an unreadable existing local variant did not abort the update snapshot');
    }

    writeFileSync(join(dir, 'config', 'profile.yml'), 'cv:\n  template: [unterminated\n');
    let malformedProfileRejected = false;
    try {
      await snapshotConfiguredTemplateVariants({
        dataRoot: dir,
        remoteFiles: ['templates/cv-template.bw.html'],
      });
    } catch {
      malformedProfileRejected = true;
    }
    if (malformedProfileRejected) {
      pass('a malformed existing profile aborts before checkout or stale pruning');
    } else {
      fail('a malformed existing profile silently disabled configured-variant protection');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. checkout protection: a same-named upstream file with different ───────
// ──    content must not overwrite the user's configured local variant       ──
{
  const path = 'templates/cv-template.bw.html';
  const configured = { cv: 'bw' };
  const local = { [path]: '<h1>my configured template</h1>\n' };
  const remote = { [path]: '<h1>upstream template</h1>\n' };
  const preserved = configuredTemplateVariantPathsToPreserve(
    [path], [path], configured, local, remote,
  );
  if (preserved.length === 1 && preserved[0] === path) {
    pass('a configured variant with same-named but different upstream content is preserved before checkout');
  } else {
    fail(`same-name overwrite protection returned ${JSON.stringify(preserved)}`);
  }

  const sameContent = configuredTemplateVariantPathsToPreserve(
    [path], [path], configured, local, { [path]: local[path].replace(/\n/g, '\r\n') },
  );
  if (sameContent.length === 0) {
    pass('identical local/upstream content does not create an unnecessary preserve rule');
  } else {
    fail('identical content was incorrectly treated as a local overwrite risk');
  }

  const absentUpstream = configuredTemplateVariantPathsToPreserve(
    [path], [], configured, local, {},
  );
  if (absentUpstream.length === 0) {
    pass('an upstream-absent configured variant remains handled by stale-file exemption');
  } else {
    fail('an upstream-absent variant was incorrectly routed through checkout protection');
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
