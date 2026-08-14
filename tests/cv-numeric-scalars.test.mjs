// tests/cv-numeric-scalars.test.mjs — a numeric scalar in the CV payload must
// render its value, not be silently dropped.
//
// escapeHtml() used to `return ''` for anything that was not a string, so a
// machine-authored payload with `year: 2024` (a number, not "2024") rendered an
// EMPTY edu-year / cert-year / job-period while `present` stayed true — the CV
// shipped with employment dates and graduation/certification years missing, and
// the builder still exited 0 with `"valid": true`. Coercing scalars via String()
// fixes it. End-to-end through the real builder and the shipped default template,
// because build-cv-html.mjs exports nothing.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';

console.log('\nbuild-cv-html.mjs — numeric year/date scalars render instead of vanishing');

// Numbers on purpose: year and dates as JSON numbers, not strings.
const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Numeric Scalars', email: 'num@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{ company: 'Corp', role: 'Engineer', dates: 2024, bullets: ['Did a thing'] }],
  education: [{ title: 'BSc Computing', year: 2019 }],
  certifications: [{ title: 'AWS SAA', year: 2025 }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-numeric-'));
try {
  const input = join(dir, 'num.json');
  const output = join(dir, 'num.html');
  writeFileSync(input, JSON.stringify(PAYLOAD));

  if (run(NODE, [join(ROOT, 'build-cv-html.mjs'), input, output]) === null) {
    const f = lastRunFailure();
    fail(`build-cv-html.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else if (!existsSync(output)) {
    fail('build-cv-html.mjs exited 0 but wrote no output file');
  } else {
    const html = readFileSync(output, 'utf-8');
    const cell = (cls) => {
      const m = html.match(new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>|<div class="${cls}">([\\s\\S]*?)</div>`));
      return m ? (m[1] ?? m[2] ?? '').trim() : null;
    };
    const cases = [
      ['edu-year', '2019'],
      ['cert-year', '2025'],
      ['job-period', '2024'],
    ];
    for (const [cls, want] of cases) {
      const got = cell(cls);
      if (got === want) pass(`${cls} renders ${want} from a numeric payload value`);
      else fail(`${cls}: expected "${want}", got ${got === null ? '(no such cell)' : `"${got}"`}`);
    }
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
