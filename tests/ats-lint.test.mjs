// tests/ats-lint.test.mjs — the ATS lint's rules are data, and the data must
// stay tied to the prose it claims to enforce (#3109).
//
// Three things drift here if nothing watches them, and each has a test below:
//
//   1. A rule's citation. The issue that designed this file cited
//      `modes/pdf.md:62-69`, and one bullet inserted by #2504 moved five of the
//      seven anchors. Every `source` entry is now the bullet's own TEXT, and
//      "the doc still says this" is a string search, not a line count.
//   2. The detector map. A rule naming a detector that does not exist would be
//      reported as `skipped` — indistinguishable, to a reader of the output,
//      from a rule that is deliberately unimplemented.
//   3. The must-not-flag contract. Each implemented rule is asserted to fire on
//      a violating fixture AND to stay quiet on the constructs its
//      `must_not_flag` clause names. A rule with only the first half has not
//      been shown to discriminate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { atsLint, loadAtsRules, ATS_DETECTORS } from '../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { rules, cannotCatch, sourceDoc } = loadAtsRules();

/** Write `html` to a throwaway file and lint it. */
function lint(html, kind = 'cv') {
  const dir = mkdtempSync(join(tmpdir(), 'atslint-'));
  const path = join(dir, 'cv-template.html');
  writeFileSync(path, html);
  return atsLint(path, kind);
}

/** Finding ids only — the assertion is about which rules fired, not wording. */
const ids = (result) => result.findings.map((f) => f.id).sort();

test('ats-rules.yml: every rule carries the fields the contract promises', () => {
  assert.ok(rules.length >= 7, `expected the seven documented rules, got ${rules.length}`);
  const seen = new Set();
  for (const rule of rules) {
    assert.ok(rule.id, 'every rule needs an id');
    assert.ok(!seen.has(rule.id), `duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
    assert.ok(rule.rule, `${rule.id}: needs a human-readable rule name`);
    assert.equal(rule.severity, 'warning', `${rule.id}: atsLint is advisory; every rule is a warning`);
    assert.ok(Array.isArray(rule.source) && rule.source.length > 0, `${rule.id}: needs at least one source quote`);
    assert.ok(rule.must_not_flag, `${rule.id}: the must-not-flag contract is the half that decides whether a rule is worth having`);
    if (rule.detect === null) {
      assert.ok(rule.unimplemented_because, `${rule.id}: an unimplemented rule must say what has to be settled first`);
    }
  }
});

test('ats-rules.yml: every source quote still appears verbatim in modes/pdf.md', () => {
  assert.equal(sourceDoc, 'modes/pdf.md');
  const doc = readFileSync(join(ROOT, sourceDoc), 'utf-8');
  for (const rule of rules) {
    for (const quote of rule.source) {
      assert.ok(
        doc.includes(quote),
        `${rule.id}: ${sourceDoc} no longer contains its cited rule text.\n  quote: ${quote}\n`
          + '  Either the doc was reworded (update the quote) or the rule is no longer project policy (remove it).'
      );
    }
  }
});

test('ats-rules.yml: no accepted section header is invented past the doc', () => {
  const rule = rules.find((r) => r.id === 'standard-section-headers');
  const cited = rule.source.join('\n');
  for (const header of rule.headers) {
    assert.ok(cited.includes(header), `"${header}" is accepted by the lint but is named in no cited modes/pdf.md bullet`);
  }
});

test('detector map and rules file name exactly the same detectors', () => {
  const named = new Set(rules.map((r) => r.detect).filter(Boolean));
  const registered = new Set(Object.keys(ATS_DETECTORS));
  for (const name of named) {
    assert.ok(registered.has(name), `ats-rules.yml names detector "${name}" but nothing registers it — it would report as skipped, which reads as deliberate`);
  }
  for (const name of registered) {
    assert.ok(named.has(name), `detector "${name}" is registered but no rule dispatches it — dead code, or a rule that was dropped`);
  }
});

test('unimplemented rules report as skipped, never as a pass', () => {
  const result = lint('<html><body><p>nothing to see</p></body></html>');
  const unimplemented = rules.filter((r) => r.detect === null).map((r) => r.id).sort();
  assert.deepEqual(result.skipped.map((s) => s.id).sort(), unimplemented);
  assert.ok(unimplemented.length > 0, 'the judgment rules are meant to be present and unimplemented');
  for (const s of result.skipped) assert.ok(s.reason, `${s.id}: a skipped rule must say why`);
});

test('atsLint surfaces the ceiling it cannot check', () => {
  const result = lint('<html><body></body></html>');
  assert.ok(result.cannotCatch.length >= 2, 'both measured classes must reach the caller');
  for (const entry of result.cannotCatch) {
    assert.ok(entry.id && entry.summary && entry.needs);
  }
  assert.deepEqual(
    cannotCatch.map((c) => c.id).sort(),
    ['css-generated-content-positioned', 'glyph-run-fragmentation']
  );
});

// ── no-nested-tables ────────────────────────────────────────────────

test('no-nested-tables: fires on a table inside a table', () => {
  const result = lint('<body><table><tr><td><table><tr><td>x</td></tr></table></td></tr></table></body>');
  assert.deepEqual(ids(result), ['no-nested-tables']);
  assert.equal(result.ok, false);
});

test('no-nested-tables: must not flag a single flat table, however many', () => {
  const flat = '<table><tr><td>a</td><td>b</td></tr></table>';
  const result = lint(`<body>${flat}<p>text</p>${flat}${flat}</body>`);
  assert.deepEqual(ids(result), []);
  assert.equal(result.ok, true);
});

test('no-nested-tables: a table written inside a comment is prose, not markup', () => {
  const result = lint('<body><!-- <table><table> --><table><tr><td>a</td></tr></table></body>');
  assert.deepEqual(ids(result), []);
});

// ── no-hidden-text ──────────────────────────────────────────────────

test('no-hidden-text: fires on each inline hiding trick', () => {
  for (const decl of ['display:none', 'visibility:hidden', 'font-size:0', 'color:#fff', 'color: white', 'color:rgb(255, 255, 255)']) {
    const result = lint(`<body><span style="${decl}">Kubernetes Terraform</span></body>`);
    assert.deepEqual(ids(result), ['no-hidden-text'], `expected a finding for style="${decl}"`);
  }
});

test('no-hidden-text: single-quoted style attributes are not a bypass', () => {
  const result = lint("<body><span style='display:none'>stuffed</span></body>");
  assert.deepEqual(ids(result), ['no-hidden-text']);
});

test('no-hidden-text: must not flag a stylesheet rule (the shipped ats template hides a separator that way)', () => {
  const result = lint(
    '<html><head><style>.contact-row .separator { display: none; }\n'
      + '@media print { .screen-only { display: none; } }\n'
      + '.badge { color: #fff; background: #1f3864; }</style></head>'
      + '<body><span class="separator">·</span><span aria-hidden="true">•</span></body></html>'
  );
  assert.deepEqual(ids(result), []);
  assert.equal(result.ok, true);
});

test('no-hidden-text: font-size:0 must not swallow a legitimate 0.9em', () => {
  const result = lint('<body><span style="font-size:0.9em">visible</span></body>');
  assert.deepEqual(ids(result), []);
});

// ── standard-section-headers ────────────────────────────────────────

test('standard-section-headers: fires on a literal heading the doc does not sanction', () => {
  const result = lint('<body><div class="section-title">Career Highlights</div></body>');
  assert.deepEqual(ids(result), ['standard-section-headers']);
  assert.match(result.findings[0].detail, /Career Highlights/);
});

test('standard-section-headers: must not flag a placeholder heading', () => {
  // Every shipped template writes these, and the rendered wording — and its
  // language, via lang="{{LANG}}" — belongs to the payload, not the template.
  const result = lint(
    '<html lang="{{LANG}}"><body>'
      + '<h1>{{NAME}}</h1>'
      + '<div class="section-title">{{SECTION_SUMMARY}}</div>'
      + '<div class="section-title">{{SECTION_EXPERIENCE}}</div>'
      + '</body></html>'
  );
  assert.deepEqual(ids(result), []);
});

test('standard-section-headers: must not flag the standard or additive headers', () => {
  const headers = rules.find((r) => r.id === 'standard-section-headers').headers;
  const html = `<body>${headers.map((h) => `<div class="section-title">${h}</div>`).join('')}</body>`;
  assert.deepEqual(ids(lint(html)), []);
  // Case is not a rename.
  assert.deepEqual(ids(lint('<body><div class="section-title">WORK EXPERIENCE</div></body>')), []);
});

test('standard-section-headers: does not run for cover letters', () => {
  const html = '<body><h1>Dear Hiring Manager</h1></body>';
  assert.deepEqual(ids(lint(html, 'cv')), ['standard-section-headers']);
  assert.deepEqual(ids(lint(html, 'cover')), []);
});

// ── contract ────────────────────────────────────────────────────────

test('atsLint never throws, and an unreadable template is not a silent pass', () => {
  const result = atsLint(join(ROOT, 'templates', 'does-not-exist.html'), 'cv');
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT|no such file/i);
  assert.deepEqual(result.findings, []);
});

test('atsLint never throws on an unreadable rules file either', () => {
  const result = atsLint(join(ROOT, 'templates', 'cv-template.html'), 'cv', { rulesPath: '/nonexistent/ats-rules.yml' });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('the CLI refuses a non-HTML template rather than reporting it clean', () => {
  // Every detector is an HTML pattern, so a .tex template lints to zero
  // findings — a pass that checked nothing. That must be an error, not JSON.
  const cli = (args) => spawnSync(process.execPath, ['cv-templates.mjs', ...args], { cwd: ROOT, encoding: 'utf-8' });

  const tex = cli(['lint', 'cv', '--format=tex']);
  assert.notEqual(tex.status, 0, 'a .tex lint must fail rather than print findings');
  assert.match(tex.stderr, /HTML templates only/);
  assert.equal(tex.stdout.trim(), '', 'nothing that looks like a clean result may be printed');

  const html = cli(['lint', 'cv']);
  assert.equal(html.status, 0, `the html path must still work: ${html.stderr}`);
  assert.equal(JSON.parse(html.stdout).ok, true);
});
