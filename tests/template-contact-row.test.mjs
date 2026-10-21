// tests/template-contact-row.test.mjs — the header contact separator must never
// be able to start a wrapped line.
//
// The contact row is a list of items (phone, email, LinkedIn, portfolio,
// location) with "|" between them. While each separator was its own element,
// it was its own box on both layout paths the templates use:
//
//   - flex rows (cv-template.html, zh-minimal, resume-template) make every
//     child a flex item, and flex-wrap can place any item first on a new line;
//   - inline rows (compact, executive, jake, leadership, modern) separate the
//     items by markup whitespace, which is a line-break opportunity on both
//     sides of the separator.
//
// Either way a wrap could put a bare "|" at the start of a line. Measured on
// upstream/main at 8 viewport widths: cv-template.modern wraps one onto its own
// line in LTR, and cv-template.html, zh-minimal and resume-template do it at
// every width under html[lang="ar"], where the row is reversed.
//
// The fix is structural rather than a nowrap patch: the separator is generated
// content on the item BEFORE it (`:not(:last-child)::after`). Generated content
// has no whitespace between it and the text it hangs off, so no break
// opportunity exists — the separator leaves with its item or not at all.
//
// `::after` and not `::before`: attaching it to the FOLLOWING item also keeps
// it glued to text, but that item is the one that wraps, so the new line still
// opens with "| Dhaka, Bangladesh" — the exact artifact being fixed. Only a
// separator trailing the preceding item cannot lead a line.
//
// Scope note: this pins the source structure, which is all a bare-checkout
// suite can see (#1440). That a RENDERED line never begins with the separator
// is a separate, browser-backed assertion in
// tests/cv-visual/contact-row-wrap.spec.mjs — a source assertion cannot verify
// renderer behaviour, which is the lesson this pair exists to encode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates } from '../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every HTML template that renders a contact row.
 *
 * listTemplates('cv') discovers the CV templates and packs; resume-template.html
 * is a separate kind but shares this header markup verbatim, and
 * templates/README.md requires it to be kept in sync with cv-template.html — so
 * it is held to the same invariant rather than left as the one place the bug
 * can survive.
 */
function contactRowTemplates() {
  const found = listTemplates('cv')
    .filter((t) => t.format === 'html')
    .map((t) => t.path);
  found.push(join(ROOT, 'templates', 'resume-template.html'));
  return found
    .map((path) => ({ path, rel: relative(ROOT, path).replace(/\\/g, '/'), src: readFileSync(path, 'utf-8') }))
    .filter((t) => t.src.includes('class="contact-row"'));
}

const TEMPLATES = contactRowTemplates();

test('contact-row templates are discovered', () => {
  assert.ok(TEMPLATES.length > 0, 'no HTML templates with a .contact-row were discovered');
});

for (const t of TEMPLATES) {
  // The bug class itself: a separator that is its own element is a box the line
  // breaker can move on its own. Holds for every template including one that
  // renders no separator at all — it simply has nothing to match.
  test(`${t.rel}: renders no separator as its own element`, () => {
    assert.doesNotMatch(
      t.src,
      /<[a-z]+[^>]*class="[^"]*\bseparator\b[^"]*"/i,
      'a separator element is an independent box that a wrap can place first on a '
        + 'new line; generate it with `.contact-row > *:not(:last-child)::after` instead'
    );
  });

  // Direction of attachment, and that there IS one.
  //
  // `generates` used to gate the assertion below and nothing else, so a template
  // that lost its separator rule entirely made the gate false and the assertion
  // vanished — the suite accepted a contact row with no separators at all, which
  // is the same silently-skipped check this PR exists to remove. The premise is
  // now asserted instead of assumed: a row template MUST generate a separator,
  // and the one template that legitimately does not is named here with its
  // reason, so a NEW template that forgets the rule fails rather than opting
  // itself out.
  //
  // templates/ats lays .contact-row out as a column — one item per line, so
  // there is no wrap, nothing to separate, and a separator would be noise in an
  // ATS parse. That exemption follows the layout, not the filename, and the
  // column rule is asserted here so the exemption cannot outlive its reason.
  const COLUMN_ROW_TEMPLATES = new Map([
    ['templates/ats/cv-template.ats.html', /\.contact-row\s*\{[^}]*flex-direction:\s*column/],
  ]);

  const generates = /\.contact-row\s*>\s*\*:not\(:(first|last)-child\)::(before|after)/.test(t.src);
  const exemption = COLUMN_ROW_TEMPLATES.get(t.rel);

  if (exemption) {
    test(`${t.rel}: exempt from separators because its .contact-row is a column`, () => {
      assert.match(t.src, exemption,
        'this template is on the separator exemption list, but its .contact-row is no longer '
          + 'a column — so it now wraps, needs separators, and must come off the list');
      assert.equal(generates, false,
        'a column row needs no separator; remove it or take this template off the exemption list');
    });
  } else {
    test(`${t.rel}: generates a separator between contact items`, () => {
      assert.equal(generates, true,
        'no `.contact-row > *:not(:last-child)::after` rule, so this template renders a contact '
          + 'row with no separators at all. Add the rule, or — if its row is a column and needs '
          + 'none — add it to COLUMN_ROW_TEMPLATES with that reason');
    });

    test(`${t.rel}: hangs the generated separator off the PRECEDING item`, () => {
      assert.match(
        t.src,
        /\.contact-row\s*>\s*\*:not\(:last-child\)::after/,
        '`:not(:first-child)::before` moves the separator to the item that wraps, so a '
          + 'wrapped line still opens with it; `:not(:last-child)::after` leaves it on the line above'
      );
      assert.doesNotMatch(
        t.src,
        /\.contact-row\s*>\s*\*:not\(:first-child\)::before/,
        'leads a wrapped line with the separator'
      );
    });
  }
}

// Behavioural, and the half a source assertion cannot reach without a browser:
// run the real builder and look at the markup it emits. The builder owns the
// contact row outright — build-cv-html.mjs replaces the whole block via
// CONTACT_ROW_RE — so a template's own markup is only a structural reference and
// this is the output that actually reaches Chromium.
test('the builder emits contact items with no separator elements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-contact-row-'));
  try {
    const payload = join(dir, 'payload.json');
    const html = join(dir, 'cv.html');
    writeFileSync(payload, JSON.stringify({
      lang: 'en',
      page_format: 'a4',
      candidate: {
        name: 'Jordan Lee',
        phone: '+1 555 010 2048',
        email: 'candidate@example.com',
        linkedin: { url: 'https://linkedin.com/in/candidate', display: 'linkedin.com/in/candidate' },
        portfolio: { url: 'https://candidate.example.com', display: 'candidate.example.com' },
        location: 'Toronto, Canada',
      },
      summary: 'Sample summary for layout testing; it describes no real candidate.',
      competencies: ['Sample Competency A'],
      experience: [],
      projects: [],
      education: [{ title: 'Example Degree', org: 'Example Institution', year: '2025' }],
      certifications: [],
      skills: [{ category: 'Sample Skills', items: ['Tool A'] }],
    }));
    execFileSync(process.execPath, ['build-cv-html.mjs', payload, html,
      join(ROOT, 'templates', 'cv-template.html')], { cwd: ROOT, stdio: 'pipe' });

    const row = readFileSync(html, 'utf-8').match(/<div class="contact-row">([\s\S]*?)<\/div>/);
    assert.ok(row, 'builder emitted no .contact-row');

    assert.doesNotMatch(row[1], /class="[^"]*\bseparator\b/i,
      'the builder still emits separator elements');
    // Five contact fields in, five items out: the separator is not an item, and
    // an absent field must drop its whole item rather than leave a dangling one.
    const items = row[1].match(/<\/a>|<\/span>/g) || [];
    assert.equal(items.length, 5,
      `expected one item per contact field, got ${items.length}: ${row[1].trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
