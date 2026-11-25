// tests/cv-unresolved-placeholders.test.mjs — renderHtml must not ship a
// literal {{token}} from a template or section partial into a rendered CV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function payload(extra = {}) {
  return {
    lang: 'en',
    page_format: 'letter',
    candidate: { name: 'Test Candidate', email: 't@example.com' },
    summary: 'Backend engineer.',
    competencies: ['Cloud'],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    skills: [{ category: 'Languages', items: ['Go'] }],
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: ['Did a thing'] }],
    ...extra,
  };
}

function run(body, template, partials = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-placeholder-'));
  try {
    const input = join(dir, 'p.json');
    const out = join(dir, 'out.html');
    const args = [join(ROOT, 'build-cv-html.mjs'), input, out];
    writeFileSync(input, JSON.stringify(body));
    if (template != null) {
      const tpl = join(dir, 'template.html');
      writeFileSync(tpl, template);
      args.push(tpl);
    }
    for (const [section, partial] of Object.entries(partials)) {
      const sections = join(dir, 'sections');
      mkdirSync(sections, { recursive: true });
      writeFileSync(join(sections, `${section}.html`), partial);
    }
    const res = spawnSync(process.execPath, args, {
      cwd: dir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_DATA_DIR: dir,
        CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml'),
        CAREER_OPS_TRACKER: join(dir, 'applications.md'),
      },
    });
    const html = res.status === 0 ? readFileSync(out, 'utf-8') : '';
    // Keep the spawn fields (error, signal, status, streams) so exitedNonZero
    // can tell a chosen non-zero exit from a timeout kill.
    return { ...res, html, outputWritten: existsSync(out) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a template token in any double-brace shape that does not resolve fails and names the token', () => {
  const tpl = `<!DOCTYPE html><html lang="{{LANG}}"><body>
    <h1>{{NAME}}</h1>
    <p>{{SUMMARY_TEXT}}</p>
    <p>{{role_title}}</p>
    <p>{{ COMPANY }}</p>
    <p>{{}}</p>
    <p>{{format({key: "value"})}}</p>
    <p>{{format({key: {}})}}</p>
    <p>{{{NAME}}}</p>
    <p>{{{PHOTO}}}</p>
    <p>{{wrapper(
    {{TITLE_BLOCK}}
    )}}</p>
  </body></html>`;
  const res = run(payload(), tpl);
  assert.ok(exitedNonZero(res), describeSpawn(res, 'an unresolved template token must fail the build'));
  assert.equal(res.outputWritten, false);
  assert.ok(res.stderr.includes('Unresolved placeholders: {{role_title}}, {{ COMPANY }}, {{}}, '
    + '{{format({key: "value"})}}, {{format({key: {}})}}, {{{NAME}}}, {{{PHOTO}}}, '
    + '{{wrapper(\n    {{TITLE_BLOCK}}\n    )}}'), res.stderr);
});

test('unresolved tokens in an emitted section partial fail and name the tokens', () => {
  const tpl = '<h1>{{NAME}}</h1><p>{{SUMMARY_TEXT}}</p>{{EXPERIENCE}}{{SKILLS}}';
  const res = run(payload(), tpl, {
    experience: '<!--ENTRY--><p>{{COMPANY}} {{{ROLE}}} {{role_title}} {{SKILLS}} {{}}</p><!--/ENTRY-->',
  });
  assert.ok(exitedNonZero(res), describeSpawn(res, 'an unresolved partial token must fail the build'));
  assert.equal(res.outputWritten, false);
  assert.ok(res.stderr.includes('Unresolved placeholders: {{{ROLE}}}, {{role_title}}, {{SKILLS}}, {{}}'), res.stderr);
});

test('an emitted conditional branch is checked and unused partial markup is ignored', () => {
  const tpl = '<h1>{{NAME}}</h1><p>{{SUMMARY_TEXT}}</p>{{EXPERIENCE}}';
  const partials = {
    experience: `<!-- documentation: {{doc_example}} -->
      <!--ENTRY-->
      <p>{{COMPANY}} {{LOCATION_BLOCK}}</p>
      <!--LOCATION_BLOCK--><span>{{LOCATION}}</span><!--/LOCATION_BLOCK-->
      <!--LOCATION_BLOCK_EMPTY--><span>{{fallback_location}}</span><!--/LOCATION_BLOCK_EMPTY-->
      <!--/ENTRY-->`,
  };
  const invalid = run(payload(), tpl, partials);
  assert.ok(exitedNonZero(invalid), describeSpawn(invalid, 'an unresolved fallback token must fail the build'));
  assert.match(invalid.stderr, /Unresolved placeholders: \{\{fallback_location\}\}/);

  const withLocation = payload();
  withLocation.experience[0].location = 'Athens';
  const valid = run(withLocation, tpl, partials);
  assert.equal(valid.status, 0, describeSpawn(valid, 'a valid partial branch must render'));
  assert.match(valid.html, /Acme <span>Athens<\/span>/);
});

test('a CV that quotes {{ .Values.x }} still builds', () => {
  const quote = 'Tuned the chart with {{ .Values.x }} overrides.';
  const res = run(payload({
    summary: quote,
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: [quote] }],
  }));
  assert.equal(res.status, 0, describeSpawn(res, 'a CV quoting {{ .Values.x }} must still build'));
  assert.equal(res.html.match(/Tuned the chart with &#123;&#123; \.Values\.x &#125;&#125; overrides\./g)?.length, 2);
  assert.match(res.html, /Test Candidate/);
});
