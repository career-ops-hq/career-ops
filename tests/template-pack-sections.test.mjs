// tests/template-pack-sections.test.mjs — a template pack can declare the
// sections it owns, and a declared section never falls back silently (#3852).
//
// build-cv-html.mjs walks seven section names and renders each from the
// pack's sections/<name>.html when one exists, otherwise from its built-in
// builder. Before the manifest key pinned here, that fallback was the only
// contract: a pack that shipped three partials got the other four from the
// builders — the DOM it was written to avoid — and a typo in a partial it did
// ship degraded the same way, with nothing in the output saying so.
//
// `sections: all` (or a list) in the <!-- career-ops-template --> block turns
// ownership into a checkable claim. A declared section must exist at resolve
// (cv-templates.mjs) and parse at render (build-cv-html.mjs); a pack that
// declares nothing keeps the old behaviour, which is what keeps every pack
// written before the key on its existing contract.
//
// Lives in tests/ because only tests/**/*.test.mjs is discovered by
// test-all.mjs.

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';
import {
  PARTIAL_SECTIONS, parseMeta, declaredSections, checkDeclaredSections, listTemplates, resolveTemplate,
} from '../cv-templates.mjs';

console.log('\nCV template packs — declared sections and completeness (#3852)');

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture that cannot be removed must not change the suite's verdict.
    }
  }
});

const VALID_ENTRY = '<!--ENTRY--><div class="pack-job">{{ROLE}} at {{COMPANY}}</div><!--/ENTRY-->';
const MALFORMED_ENTRY = '<div class="pack-job">{{ROLE}}</div>'; // no ENTRY zone
const EMPTY_ENTRY = '<!--ENTRY-->   <!--/ENTRY-->';

/** A templates/ dir holding the base template plus one pack, "mine". */
function fixture({ manifest = '', sections = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-sections-'));
  fixtures.push(dir);
  const body = `<!DOCTYPE html>\n<!-- career-ops-template\nname: Mine\n${manifest}\n-->\n`
    + '<html><body>{{NAME}}{{EXPERIENCE}}{{EDUCATION}}</body></html>\n';
  writeFileSync(join(dir, 'cv-template.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  const packDir = join(dir, 'mine');
  mkdirSync(join(packDir, 'sections'), { recursive: true });
  writeFileSync(join(packDir, 'cv-template.mine.html'), body);
  for (const [name, html] of Object.entries(sections)) {
    writeFileSync(join(packDir, 'sections', `${name}.html`), html);
  }
  return { dir, template: join(packDir, 'cv-template.mine.html') };
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

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Pack Tester', email: 'pack@example.com' },
  summary: 'Summary.',
  experience: [{ company: 'Corp', role: 'Engineer', dates: '2024 - Present', bullets: ['Did a thing'] }],
  education: [{ title: 'BSc', org: 'University', year: '2020' }],
};

/**
 * Run build-cv-html.mjs against a template path. Returns { html } on a zero
 * exit or { stderr, status } on a non-zero one, so each check can assert the
 * outcome it expects instead of treating a crash as a suite abort.
 */
function build(dir, template) {
  const input = join(dir, 'payload.json');
  const output = join(dir, 'out.html');
  writeFileSync(input, JSON.stringify(PAYLOAD));
  if (run(NODE, [join(ROOT, 'build-cv-html.mjs'), input, output, template]) === null) {
    const f = lastRunFailure();
    return { status: f?.status ?? null, stderr: f?.stderr || '' };
  }
  if (!existsSync(output)) return { status: 0, stderr: 'exited 0 but wrote no output file' };
  return { status: 0, html: readFileSync(output, 'utf-8') };
}

// ── declaredSections: the manifest vocabulary ───────────────────────────────

{
  if (declaredSections({}) === null && declaredSections({ name: 'X' }) === null) {
    pass('a manifest with no "sections" key declares nothing (null)');
  } else {
    fail('a silent manifest must return null, not an empty set');
  }

  const all = declaredSections({ sections: 'all' });
  if (all instanceof Set && all.size === PARTIAL_SECTIONS.length && PARTIAL_SECTIONS.every((n) => all.has(n))) {
    pass('"sections: all" declares every section in PARTIAL_SECTIONS');
  } else {
    fail(`"all" declared ${[...(all || [])].join(', ')}`);
  }

  const some = declaredSections({ sections: 'Experience, education skills' });
  if (some?.size === 3 && some.has('experience') && some.has('education') && some.has('skills')) {
    pass('a list splits on commas and whitespace, case-insensitively');
  } else {
    fail(`list declared ${[...(some || [])].join(', ')}`);
  }

  throws(
    'an unknown section name is an error naming it and the vocabulary',
    () => declaredSections({ sections: 'experience, references' }),
    /unknown section/, /references/, /competencies/
  );
  throws('an empty declaration is an error', () => declaredSections({ sections: ' , ' }), /empty/);
  throws('a blank string declaration is an error', () => declaredSections({ sections: '' }), /empty/);
}

// ── A bare `sections:` reaches the empty-declaration error ──────────────────
//
// parseMeta records a key written with a blank value as '' rather than
// dropping the line. It matched `(.+?)` once, so `sections:` parsed as no key
// at all, declaredSections returned null, and the template fell silently back
// to the built-in builders — the exact silence this key exists to remove, and
// reachable by the most natural way to write an empty declaration.

{
  const { dir, template } = fixture({ manifest: 'sections:', sections: { experience: VALID_ENTRY } });

  const meta = parseMeta(template);
  if (meta.sections === '') pass('parseMeta records a bare `sections:` as an empty value, not an absent key');
  else fail(`parseMeta read sections as ${JSON.stringify(meta.sections)} — a typed key must not vanish`);

  throws('a bare `sections:` is an empty declaration, not a silent fallback', () => declaredSections(meta), /empty/);
  throws(
    'and it fails at resolve, naming the pack',
    () => resolveTemplate('cv', 'mine', { dir }),
    /mine[/\\]cv-template\.mine\.html/, /empty/
  );

  const r = build(dir, template);
  if (r.status !== 0 && /empty/.test(r.stderr)) {
    pass('and it fails the render rather than falling back to the built-in builders');
  } else {
    fail(`bare "sections:" rendered: exit ${r.status}, ${(r.stderr || '').trim()}`);
  }
}

{
  // The regex is shared by every manifest key, so the widening must not change
  // what a blank `name:` means: displayName reads it through `meta.name || …`,
  // and an empty value still falls back to the prettified filename.
  const { dir, template } = fixture({ manifest: 'name:\nsections: experience', sections: { experience: VALID_ENTRY } });
  if (parseMeta(template).name === '') {
    const entry = listTemplates('cv', { dir }).find((t) => t.name === 'mine');
    if (entry?.displayName === 'Mine') pass('a blank `name:` still falls back to the prettified filename');
    else fail(`blank name: produced displayName ${JSON.stringify(entry?.displayName)}`);
  } else {
    fail('blank `name:` was dropped by parseMeta — the widening is not applied uniformly');
  }
}

// ── Resolution: a declared section must exist ───────────────────────────────

{
  const { dir } = fixture({ manifest: 'sections: all', sections: { experience: VALID_ENTRY } });
  const listed = listTemplates('cv', { dir }).map((t) => t.name);
  if (listed.includes('mine')) pass('an incomplete pack still lists — listing is not the gate');
  else fail(`incomplete pack vanished from the listing: ${listed.join(', ')}`);

  throws(
    'resolving a pack that declares "all" but ships one partial names every missing file',
    () => resolveTemplate('cv', 'mine', { dir }),
    /mine[/\\]cv-template\.mine\.html/,
    /declares sections it does not ship/,
    /sections\/education\.html/, /sections\/skills\.html/
  );
  const { missing } = checkDeclaredSections(join(dir, 'mine', 'cv-template.mine.html'));
  if (missing.length === PARTIAL_SECTIONS.length - 1 && !missing.includes('experience')) {
    pass('checkDeclaredSections reports exactly the declared sections with no partial');
  } else {
    fail(`checkDeclaredSections reported ${missing.join(', ')}`);
  }
}

{
  const { dir, template } = fixture({
    manifest: 'sections: experience, education',
    sections: { experience: VALID_ENTRY, education: '<!--ENTRY--><div class="pack-edu">{{TITLE}}</div><!--/ENTRY-->' },
  });
  let resolved;
  try {
    resolved = resolveTemplate('cv', 'mine', { dir });
  } catch (e) {
    resolved = `threw: ${e.message}`;
  }
  if (resolved === template) pass('a pack that ships every section it declares resolves by name');
  else fail(`complete pack did not resolve: ${resolved}`);
}

{
  const { dir } = fixture({ manifest: 'sections: experience, references', sections: { experience: VALID_ENTRY } });
  throws(
    'a manifest naming an unknown section fails at resolve, naming the pack',
    () => resolveTemplate('cv', 'mine', { dir }),
    /mine[/\\]cv-template\.mine\.html/, /unknown section/, /references/
  );
}

{
  // The pre-#3852 contract, unchanged: no key, no check.
  const { dir, template } = fixture({ sections: { experience: MALFORMED_ENTRY } });
  let resolved;
  try {
    resolved = resolveTemplate('cv', 'mine', { dir });
  } catch (e) {
    resolved = `threw: ${e.message}`;
  }
  if (resolved === template) pass('a pack that declares nothing resolves with a malformed partial, as before');
  else fail(`silent pack no longer resolves: ${resolved}`);
}

// ── Rendering: a declared section must parse, and never falls back ──────────
//
// build-cv-html.mjs accepts a template path directly, so the render is a
// second gate rather than a redundant one: a caller can bypass resolveTemplate
// entirely, and parse errors are only detectable here anyway.

{
  const { dir, template } = fixture({ manifest: 'sections: experience', sections: { experience: MALFORMED_ENTRY } });
  const r = build(dir, template);
  if (r.status !== 0 && /sections\/experience\.html/.test(r.stderr) && /malformed/.test(r.stderr)) {
    pass('a declared partial that does not parse fails the build, naming the file');
  } else {
    fail(`malformed declared partial: exit ${r.status}, stderr "${(r.stderr || '').trim()}"`);
  }
}

{
  const { dir, template } = fixture({ manifest: 'sections: experience', sections: { experience: EMPTY_ENTRY } });
  const r = build(dir, template);
  if (r.status !== 0 && /sections\/experience\.html/.test(r.stderr) && /ENTRY zone is empty/.test(r.stderr)) {
    pass('a declared partial with an empty ENTRY zone fails the build — an empty section is not ownership');
  } else {
    fail(`empty declared partial: exit ${r.status}, stderr "${(r.stderr || '').trim()}"`);
  }
}

{
  const { dir, template } = fixture({ manifest: 'sections: all', sections: { experience: VALID_ENTRY } });
  const r = build(dir, template);
  const named = ['education', 'skills', 'awards'].every((n) => new RegExp(`sections/${n}\\.html`).test(r.stderr || ''));
  if (r.status !== 0 && named && !/sections\/experience\.html/.test(r.stderr)) {
    pass('rendering an incomplete pack by path fails and lists every missing partial in one run');
  } else {
    fail(`incomplete pack by path: exit ${r.status}, stderr "${(r.stderr || '').trim()}"`);
  }
}

{
  const { dir, template } = fixture({ manifest: 'sections: experience', sections: { experience: VALID_ENTRY } });
  const r = build(dir, template);
  if (r.status === 0 && r.html.includes('class="pack-job"') && !r.html.includes('class="job-header"')) {
    pass('a declared partial that parses renders the pack DOM, not the built-in one');
  } else {
    fail(`valid declared partial: exit ${r.status}, ${r.html ? 'built-in DOM leaked' : (r.stderr || '').trim()}`);
  }
}

{
  // Same broken file, no declaration: today's silent fallback survives intact.
  const { dir, template } = fixture({ sections: { experience: MALFORMED_ENTRY } });
  const r = build(dir, template);
  if (r.status === 0 && r.html.includes('class="job-header"')) {
    pass('an undeclared malformed partial still falls back to the built-in builder');
  } else {
    fail(`undeclared malformed partial: exit ${r.status}, ${(r.stderr || '').trim()}`);
  }
}

{
  // Declaring one section must not make the others strict.
  const { dir, template } = fixture({
    manifest: 'sections: experience',
    sections: { experience: VALID_ENTRY, education: MALFORMED_ENTRY },
  });
  const r = build(dir, template);
  if (r.status === 0 && r.html.includes('class="pack-job"') && r.html.includes('class="edu-item"')) {
    pass('an undeclared section keeps its fallback even when a sibling is declared');
  } else {
    fail(`mixed pack: exit ${r.status}, ${(r.stderr || '').trim()}`);
  }
}

// ── The shipped packs ───────────────────────────────────────────────────────
//
// The ATS pack is the case the issue was filed over: it shipped three partials
// and inherited four sections from the built-in builders, which was fine only
// because none of the inherited wrapper classes happened to be styled in its
// CSS. It now declares all seven and ships all seven, so that coincidence is a
// checked claim — and every pack that declares anything must be complete.

{
  const shipped = listTemplates('cv').filter((t) => t.pack);
  const ats = shipped.find((t) => t.name === 'ats');
  if (!ats) {
    fail('the shipped ATS pack (templates/ats/) is missing');
  } else {
    const declared = declaredSections(ats.meta);
    if (declared && declared.size === PARTIAL_SECTIONS.length) pass('the ATS pack declares every section');
    else fail(`the ATS pack declares ${declared ? [...declared].join(', ') : 'nothing'} — it must own its whole DOM`);
  }

  for (const t of shipped) {
    let report;
    try {
      report = checkDeclaredSections(t.path);
    } catch (e) {
      fail(`shipped pack ${t.pack}/ has a bad manifest: ${e.message}`);
      continue;
    }
    if (report.declared === null) {
      pass(`shipped pack ${t.pack}/ declares no sections (silent fallback, by choice)`);
    } else if (report.missing.length === 0) {
      pass(`shipped pack ${t.pack}/ ships every section it declares`);
    } else {
      fail(`shipped pack ${t.pack}/ declares sections it does not ship: ${report.missing.join(', ')}`);
    }
  }

  if (ats) {
    const dir = mkdtempSync(join(tmpdir(), 'pack-sections-ats-'));
    fixtures.push(dir);
    const r = build(dir, ats.path);
    if (r.status === 0 && !r.html.includes('class="job-header"')) {
      pass('the ATS pack renders through its own partials with no built-in experience DOM');
    } else {
      fail(`ATS pack render: exit ${r.status}, ${r.html ? 'built-in job-header leaked' : (r.stderr || '').trim()}`);
    }
  }
}
