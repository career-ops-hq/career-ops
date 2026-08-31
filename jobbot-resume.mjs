#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { findMatches, parseTrackerRows } from './find.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CONTRACT_VERSION = 'careerops.resume.request@1';
const RESULT_VERSION = 'resume.tailoring.result@1';
const RECEIPT_VERSION = 'careerops.resume.render.receipt@1';
const RULES_VERSION = 'careerops.pdf.rules@1';
const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_CV_BYTES = 128 * 1024;
const MAX_ROLE_CONTEXT_BYTES = 16 * 1024;

export function listResumeCandidates({ workspace = ROOT } = {}) {
  const root = realpathSync(workspace);
  const trackerPath = join(root, 'data', 'applications.md');
  if (!existsSync(trackerPath)) throw new Error('required Career Ops file is missing: data/applications.md');
  return {
    version: 'careerops.resume.candidates@1',
    candidates: parseTrackerRows(readFileSync(trackerPath, 'utf8'))
      .filter(row => row.reportPath && row.reportNum)
      .map(row => ({ report_id: row.reportNum, company: row.company, role: row.role, status: row.status })),
  };
}

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readBounded(path, maxBytes, label) {
  const bytes = readFileSync(path);
  if (bytes.length === 0) throw new Error(`${label} is empty`);
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  return { content: bytes.toString('utf8'), hash: sha256(bytes) };
}

function projectedRoleContext(path) {
  const bytes = readFileSync(path);
  if (bytes.length === 0) throw new Error('evaluation report is empty');
  const projected = bytes.subarray(0, MAX_ROLE_CONTEXT_BYTES);
  return {
    content: projected.toString('utf8'),
    content_hash: sha256(projected),
    source_hash: sha256(bytes),
    truncated: bytes.length > projected.length,
    trust: 'external_untrusted',
  };
}

function candidateFromProfile(profile) {
  const candidate = profile?.candidate;
  if (!candidate || typeof candidate !== 'object') throw new Error('profile candidate is missing');
  const name = String(candidate.full_name ?? candidate.name ?? '').trim();
  const email = String(candidate.email ?? '').trim();
  if (!name || !email) throw new Error('profile candidate name and email are required');
  const link = (value) => {
    const url = String(value ?? '').trim();
    return url ? { url, display: url.replace(/^https?:\/\//, '').replace(/\/$/, '') } : undefined;
  };
  return Object.fromEntries(Object.entries({
    name,
    email,
    phone: String(candidate.phone ?? '').trim(),
    location: String(candidate.location ?? '').trim(),
    linkedin: link(candidate.linkedin),
    github: link(candidate.github),
    portfolio: link(candidate.portfolio_url ?? candidate.portfolio),
  }).filter(([, value]) => value !== undefined));
}

function resolveReport(workspace, reportPath) {
  if (!reportPath) throw new Error('selected application has no evaluation report');
  const root = realpathSync(workspace);
  const path = realpathSync(resolve(root, reportPath));
  const child = relative(root, path);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('evaluation report escapes the workspace');
  return path;
}

function defaultFormat(report) {
  const location = report.match(/^\| Location \| ([^|]+) \|$/m)?.[1]?.toLowerCase() ?? '';
  return /\b(united states|usa|u\.s\.|canada|california|new york|texas|washington)\b/.test(location) ? 'letter' : 'a4';
}

export function buildResumeRequest({ workspace = ROOT, query = null, reportId = null, pageFormat = null }) {
  const root = realpathSync(workspace);
  const trackerPath = join(root, 'data', 'applications.md');
  const cvPath = join(root, 'cv.md');
  const profilePath = join(root, 'config', 'profile.yml');
  const rulesPath = join(root, 'modes', 'pdf.md');
  for (const path of [trackerPath, cvPath, profilePath, rulesPath]) {
    if (!existsSync(path)) throw new Error(`required Career Ops file is missing: ${path.slice(root.length + 1)}`);
  }
  const rows = parseTrackerRows(readFileSync(trackerPath, 'utf8'));
  const matches = reportId === null
    ? findMatches(rows, query)
    : rows.filter(row => String(row.reportNum) === String(reportId));
  if (matches.length !== 1) throw new Error(matches.length ? 'resume query is ambiguous' : 'resume query matched no evaluated application');
  const selected = matches[0];
  const reportPath = resolveReport(root, selected.reportPath);
  const cv = readBounded(cvPath, MAX_CV_BYTES, 'cv.md');
  const profileBytes = readFileSync(profilePath);
  const profile = yaml.load(profileBytes.toString('utf8'));
  const roleContext = projectedRoleContext(reportPath);
  const format = pageFormat ?? defaultFormat(roleContext.content);
  if (!['a4', 'letter'].includes(format)) throw new Error('page format must be a4 or letter');
  const request = {
    version: CONTRACT_VERSION,
    rules_version: RULES_VERSION,
    rules_hash: sha256(readFileSync(rulesPath)),
    opportunity: {
      report_id: selected.reportNum,
      tracker_id: String(selected.trackerNum),
      company: selected.company,
      role: selected.role,
      status: selected.status,
    },
    candidate: candidateFromProfile(profile),
    cv: { content: cv.content, content_hash: cv.hash },
    role_context: roleContext,
    render_policy: { template: 'ats', page_format: format, max_pages: 2 },
    source_hashes: {
      cv: cv.hash,
      profile: sha256(profileBytes),
      report: roleContext.source_hash,
    },
  };
  return { ...request, manifest_hash: sha256(canonicalJson(request)) };
}

function assertExactKeys(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...required].sort())) throw new Error(`${label} fields do not match the contract`);
}

function boundedString(value, label, max, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error(`${label} is invalid`);
}

function boundedArray(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} is invalid`);
}

export function validateTailoringResult(value, request) {
  const keys = ['version', 'manifest_hash', 'opportunity', 'summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills'];
  assertExactKeys(value, keys, 'tailoring result');
  if (value.version !== RESULT_VERSION || value.manifest_hash !== request.manifest_hash) throw new Error('tailoring result is not bound to the request manifest');
  assertExactKeys(value.opportunity, ['report_id', 'company', 'role'], 'tailoring opportunity');
  const expected = { report_id: request.opportunity.report_id, company: request.opportunity.company, role: request.opportunity.role };
  if (canonicalJson(value.opportunity) !== canonicalJson(expected)) throw new Error('tailoring opportunity does not match');
  boundedString(value.summary, 'summary', 1200);
  boundedArray(value.competencies, 'competencies', 12);
  value.competencies.forEach((item, index) => boundedString(item, `competencies[${index}]`, 100));
  const specs = [
    ['experience', 12, ['company', 'role', 'location', 'dates', 'bullets']],
    ['projects', 12, ['name', 'url', 'badge', 'tech', 'description', 'bullets']],
    ['education', 8, ['title', 'org', 'year', 'description']],
    ['certifications', 12, ['title', 'org', 'year']],
    ['awards', 12, ['title', 'org', 'year']],
    ['skills', 12, ['category', 'items']],
  ];
  for (const [field, max, allowed] of specs) {
    boundedArray(value[field], field, max);
    for (const [index, item] of value[field].entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !allowed.includes(key))) throw new Error(`${field}[${index}] fields are invalid`);
      if (field === 'experience') {
        for (const key of ['company', 'role', 'dates']) boundedString(item[key], `${field}[${index}].${key}`, 200);
        boundedString(item.location ?? '', `${field}[${index}].location`, 200, { empty: true });
        boundedArray(item.bullets, `${field}[${index}].bullets`, 12);
        item.bullets.forEach((text, bullet) => boundedString(text, `${field}[${index}].bullets[${bullet}]`, 500));
      } else if (field === 'skills') {
        boundedString(item.category, `${field}[${index}].category`, 100);
        if (Array.isArray(item.items)) item.items.forEach((text, itemIndex) => boundedString(text, `${field}[${index}].items[${itemIndex}]`, 100));
        else boundedString(item.items, `${field}[${index}].items`, 500);
      } else {
        const primary = field === 'projects' ? 'name' : 'title';
        boundedString(item[primary], `${field}[${index}].${primary}`, 200);
        for (const [key, text] of Object.entries(item)) {
          if (key === primary || key === 'bullets') continue;
          boundedString(text, `${field}[${index}].${key}`, 800, { empty: true });
        }
        if (item.bullets !== undefined) {
          boundedArray(item.bullets, `${field}[${index}].bullets`, 12);
          item.bullets.forEach((text, bullet) => boundedString(text, `${field}[${index}].bullets[${bullet}]`, 500));
        }
      }
    }
  }
  return value;
}

function verifyRequestSources(workspace, request) {
  const root = realpathSync(workspace);
  // Report filenames can carry normalized wording that differs from tracker text.
  const rows = parseTrackerRows(readFileSync(join(root, 'data', 'applications.md'), 'utf8')).filter(row =>
    row.reportNum === request.opportunity.report_id
    && row.company === request.opportunity.company
    && row.role === request.opportunity.role);
  if (rows.length !== 1) throw new Error('approved report can no longer be resolved exactly');
  const paths = {
    cv: join(root, 'cv.md'),
    profile: join(root, 'config', 'profile.yml'),
    report: resolveReport(root, rows[0].reportPath),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (sha256(readFileSync(path)) !== request.source_hashes[name]) throw new Error(`${name} changed after the resume request was created`);
  }
  if (sha256(readFileSync(join(root, 'modes', 'pdf.md'))) !== request.rules_hash) throw new Error('PDF rules changed after the resume request was created');
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim().slice(0, 1000));
  return result;
}

export function renderResume({ workspace = ROOT, request, tailoring, outputRoot, outputKey = randomUUID(), run = runCommand }) {
  assertExactKeys(request, ['version', 'rules_version', 'rules_hash', 'opportunity', 'candidate', 'cv', 'role_context', 'render_policy', 'source_hashes', 'manifest_hash'], 'resume request');
  if (request.version !== CONTRACT_VERSION || request.rules_version !== RULES_VERSION) throw new Error('unsupported resume request contract');
  assertExactKeys(request.render_policy, ['template', 'page_format', 'max_pages'], 'resume render policy');
  if (request.render_policy.template !== 'ats' || !['a4', 'letter'].includes(request.render_policy.page_format) || request.render_policy.max_pages !== 2) throw new Error('resume render policy is invalid');
  const manifest = { ...request };
  delete manifest.manifest_hash;
  if (sha256(canonicalJson(manifest)) !== request.manifest_hash) throw new Error('resume request manifest hash is invalid');
  validateTailoringResult(tailoring, request);
  verifyRequestSources(workspace, request);
  const profile = yaml.load(readFileSync(join(realpathSync(workspace), 'config', 'profile.yml'), 'utf8'));
  const expectedCandidate = candidateFromProfile(profile);
  if (canonicalJson(request.candidate) !== canonicalJson(expectedCandidate)) throw new Error('resume candidate no longer matches the verified profile');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(outputKey)) throw new Error('output key must be an opaque UUID');
  const root = realpathSync(workspace);
  if (!outputRoot) throw new Error('caller-controlled output root is required');
  const outputBase = realpathSync(outputRoot);
  if (!statSync(outputBase).isDirectory()) throw new Error('output root must be a directory');
  const outputDir = resolve(outputBase, outputKey);
  if (existsSync(outputDir)) throw new Error('output key already exists');
  mkdirSync(outputDir, { mode: 0o700 });
  const inputPath = join(outputDir, 'resume-input.json');
  const htmlPath = join(outputDir, 'resume.html');
  const pdfPath = join(outputDir, 'resume.pdf');
  const templatePath = join(root, 'templates', 'ats', 'cv-template.ats.html');
  const payload = {
    lang: 'en',
    page_format: request.render_policy.page_format,
    candidate: Object.fromEntries(Object.entries(expectedCandidate).filter(([, value]) => value !== undefined)),
    summary: tailoring.summary,
    competencies: tailoring.competencies,
    experience: tailoring.experience,
    projects: tailoring.projects,
    education: tailoring.education,
    certifications: tailoring.certifications,
    awards: tailoring.awards,
    skills: tailoring.skills,
  };
  writeFileSync(inputPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  run(process.execPath, [join(root, 'build-cv-html.mjs'), inputPath, htmlPath, templatePath], root);
  const fact = run(process.execPath, [join(root, 'verify-cv-facts.mjs'), htmlPath, '--json'], root);
  const factResult = JSON.parse(fact.stdout);
  if (!['pass', 'warn'].includes(factResult.verdict)) throw new Error('Career Ops fact gate did not pass');
  const rendered = run(process.execPath, [join(root, 'generate-pdf.mjs'), htmlPath, pdfPath, `--format=${request.render_policy.page_format}`, '--allow-reorder', `--max-pages=${request.render_policy.max_pages}`, '--strict-pages', `--jobbot-staging-root=${outputBase}`], root);
  const pdf = readFileSync(pdfPath);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('renderer did not produce a PDF');
  const pageCount = Number(rendered.stdout.match(/Pages:\s*(\d+)/)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('renderer did not report a valid page count');
  return {
    version: RECEIPT_VERSION,
    artifact_key: `${outputKey}/resume.pdf`,
    manifest_hash: request.manifest_hash,
    tailoring_hash: sha256(canonicalJson(tailoring)),
    fact_gate: factResult.verdict,
    renderer_version: 'careerops.generate-pdf@1',
    template_hash: sha256(readFileSync(templatePath)),
    page_count: pageCount,
    byte_count: statSync(pdfPath).size,
    mime_type: 'application/pdf',
    content_hash: sha256(pdf),
  };
}

function usage() {
  return 'Usage: node jobbot-resume.mjs candidates\n       node jobbot-resume.mjs request (--query <report-or-role>|--report <id>) [--format a4|letter]\n       node jobbot-resume.mjs render --request <json> --tailoring <json> --output-root <dir> --output-key <uuid>';
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(args = process.argv.slice(2)) {
  try {
    if (args[0] === 'candidates') {
      console.log(JSON.stringify(listResumeCandidates()));
      return;
    }
    if (args[0] === 'request') {
      const query = option(args, '--query');
      const reportId = option(args, '--report');
      if ((query ? 1 : 0) + (reportId ? 1 : 0) !== 1) throw new Error('exactly one of --query or --report is required');
      console.log(JSON.stringify(buildResumeRequest({ query, reportId, pageFormat: option(args, '--format') ?? null })));
      return;
    }
    if (args[0] === 'render') {
      const requestPath = option(args, '--request');
      const tailoringPath = option(args, '--tailoring');
      const outputRoot = option(args, '--output-root');
      const outputKey = option(args, '--output-key');
      if (!requestPath || !tailoringPath || !outputRoot || !outputKey) throw new Error('--request, --tailoring, --output-root, and --output-key are required');
      const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
      const tailoring = JSON.parse(readFileSync(resolve(tailoringPath), 'utf8'));
      console.log(JSON.stringify(renderResume({ request, tailoring, outputRoot, outputKey })));
      return;
    }
    throw new Error(usage());
  } catch (error) {
    console.error(JSON.stringify({ version: 'careerops.resume.error@1', error: String(error.message ?? error).slice(0, 1000) }));
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) main();
