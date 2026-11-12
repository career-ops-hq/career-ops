#!/usr/bin/env node
/**
 * check-output-names.mjs — read-only audit of artifact filenames in `output/`
 * against the one filename standard (career-ops-hq/career-ops#6667):
 *
 *   {NNN}-{company-slug}-{kind}-{candidate-slug}-{YYYY-MM-DD}[-{variant}].{ext}
 *
 * Zero-LLM, zero-network, never writes. Only names that claim to be standard
 * (they lead with a report number and carry a date) are judged; legacy names with no
 * report number or no date (`cv-jane-acme-2026-01-01.pdf`, `acme-engineer-cover.pdf`) are
 * valid and ignored, because the standard only names what has a report.
 *
 * Findings (all soft, the script never exits non-zero for them):
 *   not-standard   leads with a report number and a date but does not parse
 *   unknown-report no reports/NNN-*.md carries that number
 *   slug-mismatch  the company slug is neither equal to the report filename's slug
 *                  nor a hyphen-delimited leading part of it (or the reverse): the
 *                  report number is the key, so the role may be left out of the name
 *   unexpected-subdir  a subdirectory of output/ other than `diagnostics/`
 *                  (report only: nothing is renamed, moved or deleted)
 *
 * Usage:
 *   node check-output-names.mjs [--json] [--summary]
 *   node check-output-names.mjs --self-test
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOutputName, slugFromReport } from './lib/output-names.mjs';

// Agent working files that are not deliverables live in this one subdirectory.
const ALLOWED_SUBDIR = 'diagnostics';
// The single named exception: scan outputs of github-evidence.mjs. Both it and
// evidence-freshness.mjs find the newest scan by directory + this filename shape,
// so it must not be renamed or moved. Exact shape only; near-misses are judged normally.
const EXEMPT_NAME = /^github-evidence-\d{4}-\d{2}-\d{2}\.(json|md)$/;
const ARTIFACT_EXT = /\.(pdf|html|tex|md)$/i;
// A name claims the standard when it leads with a report number AND carries a
// date. Earlier report-led names had no date (`921-acme-cv-jane.html`); those
// are legacy and are not judged.
const CLAIMS_STANDARD = /^\d+-.*\d{4}-\d{2}-\d{2}/;

/**
 * Report filenames glue the role onto the company with no delimiter
 * (`024-zep-head-of-fde-...`, `330-veeva-systems-...`), so the company part of
 * an output name cannot be derived exactly. The report number is the real key;
 * this only catches a name that points at a different company. The two slugs
 * match when they are equal or one is a hyphen-delimited leading part of the
 * other (`veeva` / `veeva-systems`, `rapidsos` / `rapidsos-senior-...`).
 * `zep` does not match `zeppelin`.
 */
export function companyMatches(outputCompany, reportSlug) {
  if (outputCompany === reportSlug) return true;
  return reportSlug.startsWith(`${outputCompany}-`) || outputCompany.startsWith(`${reportSlug}-`);
}

/**
 * @param {string} outputDir  Absolute path to `output/`.
 * @param {string} reportsDir Absolute path to `reports/`.
 * @returns {{checked: number, findings: {file: string, code: string, message: string}[]}}
 */
export function checkOutputNames(outputDir, reportsDir) {
  const findings = [];
  if (!existsSync(outputDir)) return { checked: 0, findings };
  let checked = 0;
  for (const entry of readdirSync(outputDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = entry.name;
    if (entry.isDirectory()) {
      if (file !== ALLOWED_SUBDIR) {
        findings.push({
          file,
          code: 'unexpected-subdir',
          message: `output/ holds deliverables plus one "${ALLOWED_SUBDIR}/" subdirectory; "${file}/" is neither`,
        });
      }
      continue;
    }
    if (EXEMPT_NAME.test(file)) continue;
    if (file.startsWith('github-evidence')) {
      findings.push({
        file,
        code: 'not-standard',
        message: 'looks like a github-evidence scan output but is not exactly github-evidence-{YYYY-MM-DD}.json|md',
      });
      continue;
    }
    if (!ARTIFACT_EXT.test(file) || !CLAIMS_STANDARD.test(file)) continue;
    checked++;
    const parsed = parseOutputName(file);
    if (!parsed) {
      findings.push({
        file,
        code: 'not-standard',
        message: 'leads with a report number and a date but is not {NNN}-{company}-{kind}-{candidate}-{YYYY-MM-DD}[-ats|-canva]',
      });
      continue;
    }
    const slug = slugFromReport(parsed.report, reportsDir);
    if (slug === null) {
      findings.push({ file, code: 'unknown-report', message: `no report numbered ${parsed.report} in reports/` });
    } else if (!companyMatches(parsed.company, slug)) {
      findings.push({
        file,
        code: 'slug-mismatch',
        message: `company slug "${parsed.company}" does not match the report's "${slug}"`,
      });
    }
  }
  return { checked, findings };
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-check-output-names-'));
  let failed = 0;
  const expect = (cond, label) => {
    if (!cond) { failed++; console.error(`FAIL ${label}`); }
  };
  try {
    mkdirSync(join(dir, 'reports'));
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'reports', '024-zep-2026-11-07.md'), '# r\n');
    writeFileSync(join(dir, 'reports', '330-veeva-systems-2026-11-01.md'), '# r\n');
    const files = [
      '330-veeva-cv-david-gitman-2026-11-01.pdf',        // ok: shorter than the report slug
      '330-veeva-systems-cv-david-gitman-2026-11-01.pdf', // ok: equal
      '024-zep-cv-david-gitman-2026-11-07.pdf',   // ok
      '024-zep-cover-david-gitman-2026-11-07.pdf', // ok
      '024-zep-cv-david-gitman-2026-11-07-ats.html', // ok
      '024-acme-cv-david-gitman-2026-11-07.pdf',  // slug mismatch
      '099-zep-cv-david-gitman-2026-11-07.pdf',   // unknown report
      '024-zep-resume-2026-11-07.pdf',            // not standard
      '024-zep-cv-david-gitman.html',             // earlier undated form: legacy, ignored
      'cv-david-gitman-zep-2026-11-07.pdf',       // legacy, ignored
      'zep-engineer-cover.pdf',                   // legacy, ignored
      'notes.txt',                                // not an artifact
      'github-evidence-2026-11-07.json',          // the one exempt name
      'github-evidence-2026-11-07.md',            // the one exempt name
      'github-evidence-2026-1-07.json',           // near-miss: flagged
    ];
    for (const f of files) writeFileSync(join(dir, 'output', f), 'x');
    mkdirSync(join(dir, 'output', 'diagnostics'));  // allowed
    mkdirSync(join(dir, 'output', 'scratch'));      // flagged
    const { checked, findings } = checkOutputNames(join(dir, 'output'), join(dir, 'reports'));
    const codes = Object.fromEntries(findings.map((f) => [f.file, f.code]));
    expect(checked === 8, `checked=${checked}`);
    expect(findings.length === 5, `findings=${findings.length}`);
    expect(codes['scratch'] === 'unexpected-subdir', 'unexpected-subdir');
    expect(!('diagnostics' in codes), 'diagnostics allowed');
    expect(codes['024-acme-cv-david-gitman-2026-11-07.pdf'] === 'slug-mismatch', 'slug-mismatch');
    expect(codes['099-zep-cv-david-gitman-2026-11-07.pdf'] === 'unknown-report', 'unknown-report');
    expect(codes['024-zep-resume-2026-11-07.pdf'] === 'not-standard', 'not-standard');
    expect(!('github-evidence-2026-11-07.json' in codes) && !('github-evidence-2026-11-07.md' in codes), 'github-evidence exempt');
    expect(codes['github-evidence-2026-1-07.json'] === 'not-standard', 'github-evidence near-miss');
    expect(checkOutputNames(join(dir, 'missing'), join(dir, 'reports')).checked === 0, 'missing dir');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed) { console.error(`${failed} self-test check(s) failed`); process.exit(1); }
  console.log('check-output-names self-test: ok');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const { getCareerOpsRoot } = await import('./path-resolver.mjs');
  const root = getCareerOpsRoot();
  const result = checkOutputNames(join(root, 'output'), join(root, 'reports'));
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.findings.length === 0) {
    console.log(`output names: ${result.checked} report-numbered artifact(s), all standard`);
    return;
  }
  const lines = args.includes('--summary') ? [] : result.findings.map((f) => `  ${f.code}: ${f.file} — ${f.message}`);
  console.log(`output names: ${result.findings.length} of ${result.checked} report-numbered artifact(s) need attention`);
  for (const l of lines) console.log(l);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
