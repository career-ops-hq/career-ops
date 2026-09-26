// tests/template-packs.test.mjs — a template pack is discoverable, resolvable,
// and can never be ambiguous (#3202).
//
// career-ops ships seven CV templates that all lay out with flex or grid,
// because they exist to look right as a PDF a human reads. An ATS parser walks
// the DOM instead: hand Workday a two-column flex row holding a job title on
// the left and a date range on the right and the autofill comes back with the
// two strings concatenated or split across the wrong fields. The answer is a
// variant with a different DOM, not plainer CSS on the existing ones.
//
// A different DOM means different section partials, and build-cv-html.mjs
// resolves partials from the `sections/` co-located with the template file.
// Co-location is therefore the whole mechanism: a template in its own
// subdirectory alongside its own `sections/` gets its own DOM without touching
// the `templates/sections/` every flat template shares. That subdirectory is a
// *pack*, and this suite pins what the registry must do with one.
//
// Lives in tests/ because only tests/**/*.test.mjs is discovered by
// test-all.mjs, which is what CI runs. The module's older unit suite sits in
// test/ (singular) and is not gated by anything — see the note at the end of
// this file.

import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, warn } from './helpers.mjs';
import { listTemplates, resolveTemplate } from '../cv-templates.mjs';

console.log('\nCV template packs — discovery, resolution, and name collisions');

const CV_BODY = '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}';

// Every fixture is a fresh mkdtemp; this suite is meant to run constantly, on
// three platforms, so they are tracked and removed in a finally at the end.
const fixtures = [];

// Registered on exit rather than wrapped in a try/finally around the whole
// file: this suite is a sequence of top-level blocks, and an exit hook still
// runs when one of them throws and test-all.mjs contains it — which is exactly
// the run that would otherwise leak every fixture created so far.
process.on('exit', () => {
  for (const dir of fixtures) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture that cannot be removed must not change the suite's verdict.
    }
  }
});

/** A templates/ dir with the flat layout that predates packs. */
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'packs-'));
  fixtures.push(dir);
  writeFileSync(join(dir, 'cv-template.html'), CV_BODY);
  writeFileSync(join(dir, 'cv-template.compact.html'), CV_BODY);
  writeFileSync(join(dir, 'cover-letter-template.html'), '{{NAME}}{{ROLE_TITLE}}{{OPENING}}');
  return dir;
}

/** Add a pack: a subdirectory holding `cv-template.<name>.html` and its sections/. */
function addPack(dir, packName, templateName, { body = CV_BODY, sections = {} } = {}) {
  const packDir = join(dir, packName);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, `cv-template.${templateName}.html`), body);
  if (Object.keys(sections).length) {
    mkdirSync(join(packDir, 'sections'), { recursive: true });
    for (const [name, html] of Object.entries(sections)) {
      writeFileSync(join(packDir, 'sections', `${name}.html`), html);
    }
  }
  return packDir;
}

const names = (dir, opts = {}) => listTemplates('cv', { dir, ...opts }).map((t) => t.name).sort();

/**
 * Create a directory symlink, tolerating only a missing privilege.
 *
 * A blanket catch here would report an unexercised case as a pass: any
 * symlinkSync failure — not just the Windows-without-Developer-Mode one — would
 * land in the same branch and turn broken symlink handling into a green line.
 * Same argument, and the same narrowing, as tests/intake.test.mjs:250.
 *
 * @returns {boolean} true if the link was created, false if the host lacks the privilege.
 */
function trySymlink(target, linkPath) {
  try {
    symlinkSync(target, linkPath, 'dir');
    return true;
  } catch (e) {
    if (e?.code === 'EPERM' && e?.syscall === 'symlink') return false;
    throw e;
  }
}

/** Assert `fn` throws with a message matching every pattern. */
function throws(label, fn, ...patterns) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) return fail(`${label}: expected a throw, got none`);
  const missed = patterns.filter((p) => !p.test(err.message));
  if (missed.length) return fail(`${label}: message missed ${missed.join(', ')} — got "${err.message}"`);
  pass(label);
}

// ── Discovery ───────────────────────────────────────────────────────────────

{
  const dir = fixtureDir();
  addPack(dir, 'ats', 'ats');
  const found = names(dir);
  if (found.includes('ats')) pass('a pack one level down is discovered by name');
  else fail(`pack not discovered — listTemplates returned ${found.join(', ')}`);

  // Optional chaining on both the assertion and its message: `entry` is
  // undefined exactly when the assertion fails, so dereferencing it to report
  // the failure throws and takes the rest of the file with it.
  const entry = listTemplates('cv', { dir }).find((t) => t.name === 'ats');
  if (entry?.pack === 'ats') pass('a pack entry reports the directory holding it');
  else fail(`expected pack "ats", got ${JSON.stringify(entry?.pack)}`);

  const flat = listTemplates('cv', { dir }).find((t) => t.name === 'compact');
  if (flat?.pack === null) pass('a flat template reports pack: null');
  else fail(`expected pack null for a flat template, got ${JSON.stringify(flat?.pack)}`);
}

{
  // One naming rule, not two: a template is named by its file everywhere.
  const dir = fixtureDir();
  addPack(dir, 'whatever-i-called-it', 'ats');
  const found = names(dir);
  if (found.includes('ats') && !found.includes('whatever-i-called-it')) {
    pass('the template name comes from the filename, never the directory name');
  } else {
    fail(`expected "ats" from the filename — got ${found.join(', ')}`);
  }
}

{
  // A pack's own sections/ must never be walked as if it were a nested pack.
  const dir = fixtureDir();
  addPack(dir, 'ats', 'ats', { sections: { experience: '<!--ENTRY--><div></div><!--/ENTRY-->' } });
  mkdirSync(join(dir, 'ats', 'sections', 'deep'), { recursive: true });
  writeFileSync(join(dir, 'ats', 'sections', 'deep', 'cv-template.sneaky.html'), CV_BODY);
  // The positive half is the point: without it this passes against a module
  // that discovers no packs at all, and cannot tell "the boundary holds" from
  // "nothing happened".
  const found = names(dir);
  if (found.includes('ats') && !found.includes('sneaky')) {
    pass('discovery is one level deep — the pack is found, its sections/ is not');
  } else {
    fail(`expected the pack and not its sections/ — got ${found.join(', ')}`);
  }
}

{
  // The shared partial directory sits in templates/ and holds no template file.
  const dir = fixtureDir();
  mkdirSync(join(dir, 'sections'), { recursive: true });
  writeFileSync(join(dir, 'sections', 'experience.html'), '<!--ENTRY--><div></div><!--/ENTRY-->');
  const found = names(dir);
  if (found.length === 2) pass('the shared templates/sections/ is not mistaken for a pack');
  else fail(`shared sections/ perturbed discovery — got ${found.join(', ')}`);
}

{
  // A pack kept outside the repo and linked in is a supported setup: career-ops
  // sanctions a symlinked user layer (#524), and refusing the link would drop
  // the template from the registry silently. Skipping buys no protection
  // either — whoever can create the link can create a real directory instead.
  const dir = fixtureDir();
  const outside = mkdtempSync(join(tmpdir(), 'packs-outside-'));
  fixtures.push(outside);
  writeFileSync(join(outside, 'cv-template.linked.html'), CV_BODY);
  const linked = trySymlink(outside, join(dir, 'linked-pack'));
  if (!linked) {
    warn('symlinked-pack case skipped: no symlink privilege on this host');
  } else if (!names(dir).includes('linked')) {
    fail('a symlinked pack directory was skipped — an out-of-repo pack must still be discoverable');
  } else {
    // resolveTemplate throws by design on a name that does not resolve, so a
    // bare call here would abort the file rather than fail one check.
    let resolved = null;
    try {
      resolved = resolveTemplate('cv', 'linked', { dir });
    } catch (e) {
      resolved = `threw: ${e.message}`;
    }
    if (String(resolved).endsWith('cv-template.linked.html')) {
      pass('a symlinked pack directory is followed, and resolves by name');
    } else {
      fail(`a symlinked pack listed but did not resolve to its template (${resolved})`);
    }
  }
}

{
  // A link pointing nowhere is not a pack, and must not throw the whole listing.
  const dir = fixtureDir();
  const linked = trySymlink(join(tmpdir(), 'packs-no-such-target-' + Date.now()), join(dir, 'broken'));
  if (!linked) {
    warn('broken-symlink case skipped: no symlink privilege on this host');
  } else {
    try {
      // Asserting what still lists, not merely that nothing threw: a bare
      // did-not-throw check is green against a module that finds nothing.
      const found = names(dir);
      if (found.includes('standard') && found.includes('compact')) {
        pass('a broken symlink is skipped and the rest of the directory still lists');
      } else {
        fail(`a broken symlink perturbed discovery — got ${found.join(', ')}`);
      }
    } catch (e) {
      fail(`a broken symlink broke discovery: ${e.message}`);
    }
  }
}

{
  const dir = fixtureDir();
  const packDir = addPack(dir, 'ats', 'ats');
  writeFileSync(join(packDir, 'cv-template.atstex.tex'), '{{NAME}}');
  const html = names(dir);
  const tex = names(dir, { format: 'tex' });
  if (html.includes('ats') && !html.includes('atstex') && tex.includes('atstex') && !tex.includes('ats')) {
    pass('a pack respects the format filter the same way a flat template does');
  } else {
    fail(`format filter leaked across packs — html=${html.join(',')} tex=${tex.join(',')}`);
  }
}

{
  // KINDS is generic, so packs are not a CV-only concept.
  const dir = fixtureDir();
  mkdirSync(join(dir, 'brief'), { recursive: true });
  writeFileSync(join(dir, 'brief', 'cover-letter-template.brief.html'), '{{NAME}}{{ROLE_TITLE}}{{OPENING}}');
  const found = listTemplates('cover', { dir }).map((t) => t.name).sort();
  if (found.includes('brief')) pass('cover-letter packs are discovered on the same rule');
  else fail(`cover pack not discovered — got ${found.join(', ')}`);
}

// ── Resolution ──────────────────────────────────────────────────────────────
//
// The gap the issue's own proposal understated. Discovery alone would let a
// pack list and then throw on resolve: resolveTemplate() built dir/<file>
// directly and never consulted the listing. Every by-name caller lands there
// (build-cv-latex.mjs, generate-cover-letter.mjs), so the demo path — handing
// build-cv-html.mjs an explicit path — would keep working while selecting the
// same template by name failed.

{
  const dir = fixtureDir();
  addPack(dir, 'ats', 'ats');
  let path;
  try {
    path = resolveTemplate('cv', 'ats', { dir });
  } catch (e) {
    path = `threw: ${e.message}`;
  }
  if (String(path).endsWith(join('ats', 'cv-template.ats.html'))) pass('a pack template resolves by name to its pack path');
  else fail(`resolved to the wrong path: ${path}`);
}

{
  const dir = fixtureDir();
  addPack(dir, 'ats', 'ats');
  // resolveTemplate throws by design on a name it cannot resolve, and a name
  // that lists but does not resolve is precisely the regression this pins — so
  // the throw has to be caught and counted, not allowed to abort the file.
  const mismatched = listTemplates('cv', { dir }).filter((t) => {
    try {
      return resolveTemplate('cv', t.name, { dir }) !== t.path;
    } catch {
      return true;
    }
  });
  if (mismatched.length === 0) pass('every name that lists resolves, to the same path it listed');
  else fail(`${mismatched.map((t) => t.name).join(', ')} listed but did not resolve to the listed path`);
}

{
  const dir = fixtureDir();
  let path;
  try {
    path = resolveTemplate('cv', 'nonexistent', { dir, fallback: true });
  } catch (e) {
    path = `threw: ${e.message}`;
  }
  if (String(path).endsWith('cv-template.html')) pass('fallback still reaches standard from an unknown name');
  else fail(`fallback landed on ${path}`);
}

{
  const dir = fixtureDir();
  addPack(dir, 'ats', 'ats', { body: '{{NAME}}' });
  throws(
    'a pack failing validation names its real path, not the flat name it never had',
    () => resolveTemplate('cv', 'ats', { dir }),
    /ats[/\\]cv-template\.ats\.html/,
    /\{\{EXPERIENCE\}\}/
  );
}

// ── Collisions ──────────────────────────────────────────────────────────────
//
// A name resolves to one file, enforced at discovery rather than by precedence.
// Precedence has to pick a winner while both files exist and both look correct
// — during a migration from a flat template to a pack, say — and the loser just
// stops rendering, with nothing in the output naming the file that won.

{
  const dir = fixtureDir();
  writeFileSync(join(dir, 'cv-template.ats.html'), CV_BODY);
  addPack(dir, 'ats', 'ats');
  throws(
    'a flat template and a pack claiming one name is an error from listTemplates',
    () => listTemplates('cv', { dir }),
    /claimed by two files/,
    /cv-template\.ats\.html/,
    /ats[/\\]cv-template\.ats\.html/
  );
  throws(
    'and the same error from resolveTemplate — neither entry point picks a winner',
    () => resolveTemplate('cv', 'ats', { dir }),
    /claimed by two files/
  );
}

{
  const dir = fixtureDir();
  addPack(dir, 'ats-a', 'ats');
  addPack(dir, 'ats-b', 'ats');
  throws('two packs claiming one name is an error', () => listTemplates('cv', { dir }), /claimed by two files/);
}

{
  // An unnamed cv-template.html inside a pack claims "standard".
  const dir = fixtureDir();
  mkdirSync(join(dir, 'mine'), { recursive: true });
  writeFileSync(join(dir, 'mine', 'cv-template.html'), CV_BODY);
  throws('a pack claiming "standard" collides with the base template', () => listTemplates('cv', { dir }), /claimed by two files/);
}

{
  // readdir order is not guaranteed; the message must not depend on it.
  const dir = fixtureDir();
  writeFileSync(join(dir, 'cv-template.ats.html'), CV_BODY);
  addPack(dir, 'ats', 'ats');
  const grab = () => { try { listTemplates('cv', { dir }); return null; } catch (e) { return e.message; } };
  if (grab() === grab()) pass('the collision message is stable across runs, whatever the read order');
  else fail('collision message varies between identical runs');
}

// ── The real pack, if one is checked in ─────────────────────────────────────

{
  const shipped = listTemplates('cv').filter((t) => t.pack);
  if (shipped.length === 0) {
    pass('no packs shipped yet — mechanism lands ahead of the first template (#3209)');
  } else {
    for (const t of shipped) {
      let resolved;
      try {
        resolved = resolveTemplate('cv', t.name, {});
      } catch (e) {
        resolved = `threw: ${e.message}`;
      }
      if (resolved === t.path) pass(`shipped pack ${t.pack}/ resolves by name "${t.name}"`);
      else fail(`shipped pack ${t.pack}/ does not resolve by its own name (${resolved})`);
    }
  }
}

// NOTE: cv-templates.mjs also has a node:test suite at test/cv-templates.test.mjs
// (singular). Nothing runs it: test-all.mjs discovers tests/**/*.test.mjs only,
// CI runs `node test-all.mjs --quick`, and root package.json declares no `test`
// script. Worth its own issue; not fixed here.
