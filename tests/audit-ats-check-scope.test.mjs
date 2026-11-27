// tests/audit-ats-check-scope.test.mjs — every auditAts issue names its check
// and says whether that check needs rendered output (#5940, follow-up to #4798).
//
// auditAts pushed { severity, message } and nothing else, so a caller could not
// tell a check that is valid on an unrendered template (a nested table) from one
// that is not (the contact email, which a template carries as {{EMAIL}}). The
// same two scopes templates/ats-rules.yml gives atsLint's rules apply here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditAts } from '../verify-ats.mjs';

const CLEAN = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>body{font-family:Arial}</style></head><body>
<h1>Jane Doe</h1><p><a href="mailto:jane@example.com">jane@example.com</a> 555-010-0100</p>
<div class="section"><div class="section-title">Work Experience</div><p>Staff Engineer, Acme Corp (2020-present). Built and operated the core payments platform, reducing incident rates and improving deployment cadence across multiple engineering teams.</p></div>
<div class="section"><div class="section-title">Education</div><p>B.S. Computer Science, State University, 2018. Graduated with honors.</p></div>
<div class="section"><div class="section-title">Skills</div><p>Python, Kubernetes, Docker, PostgreSQL, distributed systems, CI/CD pipelines.</p></div>
</body></html>`;

const byId = (result) => Object.fromEntries(result.issues.map((i) => [i.id, i]));

test('every issue carries an id and a scope of structural or content', () => {
  const messy = CLEAN
    .replace('<meta charset="UTF-8">', '')
    .replace('Arial', 'Comic Sans MS')
    .replace('</body>', '<table><tr><td>x</td></tr></table><img src="a.png"><span style="display:none">k</span></body>');
  const noContact = messy.replace(/<p><a href[^]*?<\/p>/, '<p>nowhere</p>');
  const result = auditAts(noContact);
  assert.ok(result.issues.length >= 5, 'the fixture is meant to trip many checks');
  for (const issue of result.issues) {
    assert.ok(issue.id, `an issue has no id: ${issue.message}`);
    assert.ok(['structural', 'content'].includes(issue.scope), `${issue.id}: scope is ${JSON.stringify(issue.scope)}`);
  }
});

test('the contact email is content-dependent and a table is structural', () => {
  const noEmail = byId(auditAts(CLEAN.replace(/<p><a href[^]*?<\/p>/, '<p>nowhere</p>')));
  assert.equal(noEmail['email-missing'].scope, 'content');
  const table = auditAts(CLEAN.replace('</body>', '<table><tr><td>x</td></tr></table></body>'));
  assert.deepEqual(table.issues, [{
    id: 'layout-tables',
    scope: 'structural',
    severity: 'critical',
    message: 'Found 1 <table> element(s). Table-based layouts scramble the reading order ATS extractors follow; use a single-column flow.',
  }]);
});

test('a baked-in image is content-dependent: the verdict turns on how much text surrounds it', () => {
  // The critical branch fires only when the page text is short, so it cannot be
  // judged on a template whose text is still {{PLACEHOLDER}}s. Counting the
  // images alone is structural.
  const sparse = byId(auditAts('<html><head><meta charset="utf-8"></head><body><img src="resume.png"><p>Resume</p></body></html>'));
  assert.equal(sparse['images-text-baked'].scope, 'content');
  const filler = `<p>${'Delivered the platform migration on schedule and under budget. '.repeat(30)}</p>`;
  const plenty = byId(auditAts(CLEAN.replace('</body>', `${filler}<img src="chart.png"></body>`)));
  assert.equal(plenty['images-non-photo'].scope, 'structural');
});

test('ids are unique per check, so a caller can key on them', () => {
  const result = auditAts(CLEAN.replace('</body>', '<table></table><div style="position:absolute">a</div></body>').replace('<meta charset="UTF-8">', ''));
  const seen = result.issues.map((i) => i.id);
  assert.equal(new Set(seen).size, seen.length);
});

test('adding id and scope leaves severity, message and score unchanged', () => {
  const result = auditAts(CLEAN);
  // 95 and 83 are what unmodified upstream/main scores these two inputs.
  assert.equal(result.score, 95);
  assert.deepEqual(result.issues, []);
  const bad = auditAts(CLEAN.replace('</body>', '<table></table></body>'));
  assert.equal(bad.score, 83);
  assert.ok(bad.issues.every((i) => i.severity && i.message));
});
