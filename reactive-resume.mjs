#!/usr/bin/env node

/**
 * Turn the existing career-ops CV payload into a managed Reactive Resume copy.
 * cv.md and the fact gate remain authoritative; this file only maps, patches,
 * downloads, and records the resulting provider artifact.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as yaml from 'js-yaml';

const PROVIDER = 'reactive-resume';
const EMPTY_WEBSITE = { url: '', label: '', inlineLink: false };

/** Avoid PDF line-end hyphenation between a number and its Chinese unit. */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replace(/(\d)(?=[\p{Script=Han}])/gu, '$1\u00a0');
}

function paragraph(value) {
  const text = String(value ?? '').trim();
  return text ? `<p>${escapeHtml(text)}</p>` : '';
}

function listHtml(items) {
  const values = (items ?? []).map((item) => String(item ?? '').trim()).filter(Boolean);
  return values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
}

function website(value) {
  const candidate = typeof value === 'string' ? { url: value, label: '' } : (value ?? {});
  const raw = String(candidate.url ?? '').trim();
  if (!raw) return { ...EMPTY_WEBSITE };
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`Invalid resume URL: ${raw}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported resume URL protocol: ${parsed.protocol}`);
  return { url: parsed.href, label: String(candidate.display ?? candidate.label ?? ''), inlineLink: false };
}

function itemBase() {
  return { id: randomUUID(), hidden: false };
}

function keywords(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function buildResumePatch(payload) {
  const candidate = payload?.candidate ?? {};
  const sectionTitles = payload?.sections ?? {};
  const profiles = [
    ['LinkedIn', candidate.linkedin],
    ['GitHub', candidate.github],
  ].filter(([, value]) => value?.url).map(([network, value]) => ({
    ...itemBase(), icon: '', iconColor: '', network,
    username: String(value.display ?? '').trim(), website: website(value),
  }));
  const experience = (payload?.experience ?? []).map((entry) => ({
    ...itemBase(), company: String(entry.company ?? '').trim(), position: String(entry.role ?? '').trim(),
    location: String(entry.location ?? '').trim(), period: String(entry.dates ?? '').trim(),
    website: { ...EMPTY_WEBSITE }, description: listHtml(entry.bullets), roles: [],
  }));
  const projects = (payload?.projects ?? []).map((entry) => ({
    ...itemBase(), name: String(entry.name ?? '').trim(), period: '', website: website(entry.url ?? ''),
    description: [entry.badge && paragraph(entry.badge), entry.tech && paragraph(entry.tech),
      listHtml(entry.bullets), entry.description && paragraph(entry.description)].filter(Boolean).join(''),
  }));
  const education = (payload?.education ?? []).map((entry) => ({
    ...itemBase(), school: String(entry.org ?? '').trim(), degree: String(entry.title ?? '').trim(), area: '', grade: '',
    location: '', period: String(entry.year ?? '').trim(), website: { ...EMPTY_WEBSITE }, description: paragraph(entry.description),
  }));
  const certifications = (payload?.certifications ?? []).map((entry) => ({
    ...itemBase(), title: String(entry.title ?? '').trim(), issuer: String(entry.org ?? '').trim(),
    date: String(entry.year ?? '').trim(), website: { ...EMPTY_WEBSITE }, description: '',
  }));
  const awards = (payload?.awards ?? []).map((entry) => ({
    ...itemBase(), title: String(entry.title ?? '').trim(), awarder: String(entry.org ?? '').trim(),
    date: String(entry.year ?? '').trim(), website: { ...EMPTY_WEBSITE }, description: '',
  }));
  const skills = [
    ...(payload?.competencies?.length ? [{ category: sectionTitles.competencies || 'Core Competencies', items: payload.competencies }] : []),
    ...(payload?.skills ?? []),
  ].map((entry) => ({
    ...itemBase(), icon: '', iconColor: '', name: String(entry.category ?? '').trim(),
    proficiency: '', level: 0, keywords: keywords(entry.items),
  }));
  const sectionData = {
    profiles, experience, projects, education, certifications, awards, skills,
    languages: [], interests: [], publications: [], volunteer: [], references: [],
  };
  const operations = [
    ['replace', '/basics/name', String(candidate.name ?? '').trim()],
    ['replace', '/basics/headline', String(payload?.headline ?? '').trim()],
    ['replace', '/basics/email', String(candidate.email ?? '').trim()],
    ['replace', '/basics/phone', String(candidate.phone ?? '').trim()],
    ['replace', '/basics/location', String(candidate.location ?? '').trim()],
    ['replace', '/basics/website', website(candidate.portfolio)],
    ['replace', '/basics/customFields', []],
    ['replace', '/summary/content', paragraph(payload?.summary)],
    ['replace', '/summary/hidden', !String(payload?.summary ?? '').trim()],
    ['replace', '/customSections', []],
    ['replace', '/metadata/notes', ''],
  ];
  if (['a4', 'letter'].includes(payload?.page_format)) operations.push(['replace', '/metadata/page/format', payload.page_format]);
  if (sectionTitles.summary) operations.push(['replace', '/summary/title', String(sectionTitles.summary)]);
  for (const [section, items] of Object.entries(sectionData)) {
    operations.push(['replace', `/sections/${section}/items`, items]);
    operations.push(['replace', `/sections/${section}/hidden`, items.length === 0]);
    if (sectionTitles[section]) operations.push(['replace', `/sections/${section}/title`, String(sectionTitles[section])]);
  }
  return operations.map(([op, path, value]) => ({ op, path, value }));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('CV payload must be an object');
  if (!String(payload.candidate?.name ?? '').trim()) throw new Error('CV payload candidate.name is required');
  if (typeof payload.summary !== 'string') throw new Error('CV payload summary must be a string');
  for (const key of ['competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) throw new Error(`CV payload ${key} must be an array`);
  }
  if (payload.projects_start_on_new_page !== undefined && typeof payload.projects_start_on_new_page !== 'boolean') {
    throw new Error('CV payload projects_start_on_new_page must be a boolean');
  }
}

function assertLocalApiBase(value) {
  const url = new URL(String(value ?? ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('cv.reactive_resume.api_base_url must point to localhost');
  }
  return url.href.replace(/\/$/, '');
}

async function request(fetchImpl, baseUrl, apiKey, path, init = {}) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: { 'x-api-key': apiKey, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500).replace(/\s+/g, ' ').trim();
    const error = new Error(`Reactive Resume ${init.method ?? 'GET'} ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.arrayBuffer();
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function defaultMetadataPath(inputPath) {
  const versionRoot = dirname(resolve(inputPath));
  return resolve(versionRoot, '..', '..', 'reactive-resume.json');
}

function isOutputArtifact(pathValue) {
  const outputRoot = resolve('output');
  const rel = relative(outputRoot, resolve(pathValue));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
}

async function recordPdf(report, pdfPath, inputPath) {
  const manifest = resolve('data/pdf-index.tsv');
  const toRelative = (value) => relative(process.cwd(), value).split(sep).join('/');
  const pdf = toRelative(pdfPath);
  const lines = existsSync(manifest)
    ? (await readFile(manifest, 'utf8')).split('\n').filter((line) => line && !line.startsWith('#') && !line.startsWith(`${report}\t`) && line.split('\t')[1] !== pdf)
    : [];
  lines.push([report, pdf, toRelative(inputPath), PROVIDER, new Date().toISOString().slice(0, 10)].join('\t'));
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(manifest, '# report\tpdf\tsource\tprovider\tdate\n' + lines.join('\n') + '\n');
}

export async function renderReactiveResume({
  payload, inputPath, outputPath, metadataPath = defaultMetadataPath(inputPath), reportNum, taskId,
  company, role, version = 1, baseResumeId, apiBaseUrl, apiKey, fetchImpl = fetch,
  recordManifest = true,
}) {
  if (taskId ? !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(taskId) : !/^\d+$/.test(String(reportNum ?? '')))
    throw new Error('A numeric --report or UUID --task-id is required');
  if (!baseResumeId) throw new Error('cv.reactive_resume.base_resume_id is required');
  if (!apiKey) throw new Error('REACTIVE_RESUME_API_KEY is required');
  if (!/^\d+$/.test(String(version)) || Number(version) < 1) throw new Error('--version must be a positive integer');
  validatePayload(payload);
  const baseUrl = assertLocalApiBase(apiBaseUrl);
  const report = taskId ? null : String(reportNum).padStart(3, '0');
  const slug = taskId ? `career-ops-workflow-${taskId}` : `career-ops-r${report}`;
  const displayName = `Career Ops ${taskId ? 'workflow' : `#${report}`}${company ? ` — ${company}` : ''}${role ? ` — ${role}` : ''}`;
  const tags = ['career-ops', taskId ? 'workflow' : `report-${report}`];
  let metadata = null;
  if (existsSync(metadataPath)) metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata && (metadata.provider !== PROVIDER || metadata.base_resume_id !== baseResumeId || metadata.slug !== slug)) {
    throw new Error(`Existing Reactive Resume metadata does not match configured base resume: ${metadataPath}`);
  }

  let resumeId = metadata?.resume_id;
  if (!resumeId) {
    const resumes = await request(fetchImpl, baseUrl, apiKey, '/resumes');
    resumeId = resumes.find((resume) => resume.slug === slug)?.id;
    if (!resumeId) {
      resumeId = await request(fetchImpl, baseUrl, apiKey, `/resumes/${encodeURIComponent(baseResumeId)}/duplicate`, {
        method: 'POST', body: JSON.stringify({ name: displayName, slug, tags }),
      });
    }
  }

  const current = await request(fetchImpl, baseUrl, apiKey, `/resumes/${encodeURIComponent(resumeId)}`);
  const linkedAt = metadata?.linked_at ?? new Date().toISOString();
  metadata = {
    schema_version: 1, provider: PROVIDER, resume_id: resumeId, base_resume_id: baseResumeId,
    report_num: report, name: current.name ?? displayName, slug: current.slug ?? slug,
    linked_at: linkedAt, updated_at: new Date().toISOString(), last_artifact_version: Number(version),
  };
  const operations = buildResumePatch(payload);
  if (taskId) operations.push(
    { op: 'replace', path: '/sections/projects/startOnNewPage', value: payload.projects_start_on_new_page === true },
    { op: 'replace', path: '/sections/profiles/columns', value: 2 },
    { op: 'replace', path: '/metadata/typography/body/lineHeight', value: 1.3 },
    { op: 'replace', path: '/metadata/typography/heading/lineHeight', value: 1.3 },
    { op: 'replace', path: '/metadata/page/gapY', value: 4 },
    { op: 'replace', path: '/metadata/page/marginY', value: 12 },
  );
  await request(fetchImpl, baseUrl, apiKey, `/resumes/${encodeURIComponent(resumeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedUpdatedAt: current.updatedAt, operations }),
  });
  const pdf = await request(fetchImpl, baseUrl, apiKey, `/resumes/${encodeURIComponent(resumeId)}/pdf`);
  const pdfPath = resolve(outputPath);
  await mkdir(dirname(pdfPath), { recursive: true });
  const temporary = `${pdfPath}.${process.pid}.tmp`;
  await writeFile(temporary, Buffer.from(pdf));
  await rename(temporary, pdfPath);
  await writeJsonAtomic(metadataPath, metadata);
  if (recordManifest) await recordPdf(report, pdfPath, resolve(inputPath));
  return { resumeId, metadataPath: resolve(metadataPath), outputPath: pdfPath };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      report: { type: 'string' }, 'task-id': { type: 'string' }, 'artifact-root': { type: 'string' },
      company: { type: 'string' }, role: { type: 'string' }, version: { type: 'string', default: '1' },
      metadata: { type: 'string' }, profile: { type: 'string', default: 'config/profile.yml' },
    },
  });
  if (positionals.length !== 2) throw new Error('Usage: node reactive-resume.mjs <cv.json> <cv.pdf> --report=N | --task-id=UUID --artifact-root=DIR');
  dotenv.config({ path: resolve('.env'), quiet: true });
  const profile = yaml.load(await readFile(resolve(values.profile), 'utf8'));
  const config = profile?.cv?.reactive_resume ?? {};
  const inputPath = resolve(positionals[0]);
  const outputPath = resolve(positionals[1]);
  const artifactRoot = values['task-id'] && values['artifact-root'] ? resolve(values['artifact-root']) : null;
  const isWithin = (root, target) => { const rel = relative(root, target); return rel && rel !== '..' && !rel.startsWith(`..${sep}`); };
  const metadataPath = values.metadata ? resolve(values.metadata) : artifactRoot ? resolve(artifactRoot, 'reactive-resume.json') : undefined;
  if (values['task-id'] ? !artifactRoot || !isWithin(artifactRoot, inputPath) || !isWithin(artifactRoot, outputPath) || !isWithin(artifactRoot, metadataPath)
    : !isOutputArtifact(inputPath) || !isOutputArtifact(outputPath)) {
    throw new Error('Reactive Resume artifacts must stay inside their output root');
  }
  const result = await renderReactiveResume({
    payload: JSON.parse(await readFile(inputPath, 'utf8')), inputPath, outputPath,
    metadataPath, reportNum: values.report, taskId: values['task-id'],
    company: values.company, role: values.role, version: values.version,
    baseResumeId: config.base_resume_id, apiBaseUrl: config.api_base_url, apiKey: process.env.REACTIVE_RESUME_API_KEY,
    recordManifest: !values['task-id'],
  });
  if (values['task-id']) console.log(JSON.stringify(result));
  else {
    console.log(`✅ Reactive Resume PDF: ${relative(process.cwd(), result.outputPath)}`);
    console.log(`🔗 Resume: ${String(config.api_base_url).replace(/\/api\/openapi\/?$/, '')}/builder/${result.resumeId}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`reactive-resume: ${error.message}`);
    process.exitCode = 1;
  });
}
