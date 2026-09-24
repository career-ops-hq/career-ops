#!/usr/bin/env node

/**
 * Import CV facts into a reviewable, source-backed Master Career Profile.
 * Parsing is deliberately conservative: the CV is evidence, not an instruction.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';

const root = getCareerOpsRoot();
const profilePath = join(root, 'data', 'career-profile.yml');
const STATUS = new Set(['needs_review', 'verified']);
const HELP = `Master Career Profile

  node career-profile.mjs import [cv.md] [--review]
    Preview candidates by default. --review asks you to approve, edit, or skip
    each item; only approved items are saved to data/career-profile.yml.

  node career-profile.mjs validate [profile.yml]
    Check the profile structure and source evidence.
`;

function stableId(kind, value, source) {
  return `${kind}-${createHash('sha256').update(`${source}\0${value}`).digest('hex').slice(0, 12)}`;
}

function classifyHeading(heading) {
  const text = heading.toLowerCase();
  if (/^(experience|work experience|employment|professional experience|pengalaman kerja|pengalaman)$/.test(text)) return 'experiences';
  if (/^(projects?|selected projects|portfolio|proyek|proyek pilihan)$/.test(text)) return 'projects';
  if (/^(education|academic background|pendidikan)$/.test(text)) return 'education';
  if (/^(skills?|technical skills|core competencies|keahlian|keterampilan)$/.test(text)) return 'skills';
  if (/^(certifications?|certificates?|licenses?|sertifikasi|sertifikat)$/.test(text)) return 'certifications';
  if (/^(summary|profile|about|professional summary|ringkasan|profil)$/.test(text)) return 'summary';
  return null;
}

function parseCv(text, source) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const result = { candidate: {}, summary: [], experiences: [], projects: [], education: [], certifications: [], skills: [] };
  let section = null;
  let entity = null;
  const addFact = (collection, value, line) => {
    const fact = { id: stableId(collection, value, `${source}:${line}`), text: value,
      evidence: { source, line, quote: lines[line - 1].trim() }, review_status: 'needs_review' };
    if (collection === 'summary' || collection === 'certifications' || collection === 'skills') result[collection].push(fact);
    else if (entity) entity.facts.push(fact);
    else {
      entity = { id: stableId(collection, `entry:${value}`, `${source}:${line}`), label: value,
        evidence: { source, line, quote: lines[line - 1].trim() }, facts: [] };
      result[collection].push(entity);
    }
  };

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (!line) return;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const title = heading[2].trim();
      const found = classifyHeading(title);
      if (found) { section = found; entity = null; return; }
      if (section && ['experiences', 'projects', 'education'].includes(section)) {
        entity = { id: stableId(section, title, `${source}:${lineNo}`), label: title,
          evidence: { source, line: lineNo, quote: raw.trim() }, facts: [] };
        result[section].push(entity);
      }
      return;
    }
    if (!section) return;
    const value = line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/^\*\*(.+?)\*\*:?\s*/, '$1: ').trim();
    if (!value) return;
    if (section === 'summary') addFact(section, value, lineNo);
    else if (section === 'skills') {
      for (const skill of value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)) addFact(section, skill, lineNo);
    } else if (section === 'certifications') addFact(section, value, lineNo);
    else if (['experiences', 'projects', 'education'].includes(section)) {
      if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(raw) && entity) addFact(section, value, lineNo);
      else {
        entity = { id: stableId(section, value, `${source}:${lineNo}`), label: value,
          evidence: { source, line: lineNo, quote: raw.trim() }, facts: [] };
        result[section].push(entity);
      }
    }
  });
  return result;
}

function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || profile.schema_version !== 1) errors.push('schema_version must be 1');
  if (!profile?.candidate || typeof profile.candidate !== 'object') errors.push('candidate must be a mapping');
  const ids = new Set();
  const checkFact = (fact, path) => {
    if (!fact || typeof fact !== 'object') { errors.push(`${path} must be a mapping`); return; }
    if (typeof fact.id !== 'string' || !fact.id.trim()) errors.push(`${path}.id is required`);
    else if (ids.has(fact.id)) errors.push(`duplicate id: ${fact.id}`);
    else ids.add(fact.id);
    if (typeof fact.text !== 'string' || !fact.text.trim()) errors.push(`${path}.text is required`);
    if (!STATUS.has(fact.review_status)) errors.push(`${path}.review_status must be needs_review or verified`);
    if (!fact.evidence || typeof fact.evidence.source !== 'string' || !fact.evidence.source.trim() ||
        !Number.isInteger(fact.evidence.line) || fact.evidence.line < 1 ||
        typeof fact.evidence.quote !== 'string' || !fact.evidence.quote.trim()) errors.push(`${path}.evidence requires source, positive line, and quote`);
  };
  const arrays = ['summary', 'experiences', 'projects', 'education', 'certifications', 'skills'];
  for (const key of arrays) if (!Array.isArray(profile?.[key])) errors.push(`${key} must be a list`);
  for (const key of ['summary', 'certifications', 'skills']) {
    (Array.isArray(profile?.[key]) ? profile[key] : []).forEach((fact, i) => checkFact(fact, `${key}[${i}]`));
  }
  for (const key of ['experiences', 'projects', 'education']) {
    (Array.isArray(profile?.[key]) ? profile[key] : []).forEach((entry, i) => {
      const path = `${key}[${i}]`;
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) errors.push(`${path}.label is required`);
      checkFact({ ...entry, text: entry?.label, review_status: entry?.review_status ?? 'verified' }, path);
      if (!Array.isArray(entry?.facts)) errors.push(`${path}.facts must be a list`);
      else entry.facts.forEach((fact, j) => checkFact(fact, `${path}.facts[${j}]`));
    });
  }
  return errors;
}

function readProfile(file) {
  if (!existsSync(file)) return { schema_version: 1, candidate: {}, summary: [], experiences: [], projects: [], education: [], certifications: [], skills: [] };
  const parsed = yaml.load(readFileSync(file, 'utf8'));
  const errors = validateProfile(parsed);
  if (errors.length) throw new Error(`Existing profile is invalid:\n- ${errors.join('\n- ')}`);
  return parsed;
}

function ask(question) {
  return new Promise((resolveAnswer) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.once('data', (data) => resolveAnswer(String(data).trim()));
  });
}

async function reviewFact(fact, label) {
  process.stdout.write(`\n${label}: ${fact.text}\n  Evidence: ${fact.evidence.source}:${fact.evidence.line} — ${fact.evidence.quote}\n`);
  while (true) {
    const answer = (await ask('  [y] approve / [e] edit / [n] skip / [q] finish: ')).toLowerCase();
    if (answer === 'y') { fact.review_status = 'verified'; return fact; }
    if (answer === 'n') return null;
    if (answer === 'q') return 'quit';
    if (answer === 'e') {
      const edited = await ask('  Revised wording (blank cancels): ');
      if (edited) { fact.text = edited; fact.review_status = 'verified'; return fact; }
    }
  }
}

async function doImport(args) {
  const review = args.includes('--review');
  const sourceArg = args.find((arg) => !arg.startsWith('--')) || 'cv.md';
  const sourcePath = resolve(root, sourceArg);
  if (!existsSync(sourcePath)) throw new Error(`CV file not found: ${sourcePath}`);
  const source = sourcePath.startsWith(root) ? sourcePath.slice(root.length + 1).replaceAll('\\', '/') : sourcePath;
  const extracted = parseCv(readFileSync(sourcePath, 'utf8'), source);
  const candidates = [];
  for (const key of ['summary', 'experiences', 'projects', 'education', 'certifications', 'skills']) {
    for (const item of extracted[key]) {
      if ('facts' in item) {
        candidates.push({ key, item, label: `${key} heading` });
        item.facts.forEach((fact) => candidates.push({ key, item, fact, label: `${key}: ${item.label}` }));
      } else candidates.push({ key, fact: item, label: key });
    }
  }
  process.stdout.write(`Found ${candidates.length} review candidates in ${source}.\n`);
  if (!review) {
    for (const { fact, item, label } of candidates) process.stdout.write(`- ${label}: ${fact?.text ?? item.label}\n`);
    process.stdout.write('Preview only; rerun with --review to approve items and save.\n');
    return;
  }

  const approved = { ...extracted, candidate: { ...extracted.candidate }, summary: [], experiences: [], projects: [], education: [], certifications: [], skills: [] };
  let quit = false;
  for (const entry of candidates) {
    if (quit) break;
    const target = entry.fact ?? { id: entry.item.id, text: entry.item.label, evidence: entry.item.evidence, review_status: 'needs_review' };
    const result = await reviewFact(target, entry.label);
    if (result === 'quit') { quit = true; break; }
    if (!result) continue;
    if (entry.fact) {
      if ('facts' in entry.item) {
        const kept = approved[entry.key].find((x) => x.id === entry.item.id);
        if (kept) kept.facts.push(result);
        else approved[entry.key].push({ ...entry.item, review_status: 'needs_review', facts: [result] });
      } else approved[entry.key].push(result);
    } else approved[entry.key].push({ ...entry.item, label: result.text, review_status: 'verified', facts: [] });
  }

  const existing = readProfile(profilePath);
  const merged = { ...existing, schema_version: 1, candidate: { ...existing.candidate, ...approved.candidate } };
  for (const key of ['summary', 'experiences', 'projects', 'education', 'certifications', 'skills']) {
    const byId = new Map((existing[key] ?? []).map((item) => [item.id, item]));
    for (const item of approved[key]) {
      if (!byId.has(item.id)) byId.set(item.id, item);
      else if ('facts' in item) {
        const old = byId.get(item.id);
        const facts = new Map((old.facts ?? []).map((fact) => [fact.id, fact]));
        for (const fact of item.facts ?? []) if (!facts.has(fact.id)) facts.set(fact.id, fact);
        byId.set(item.id, { ...old, facts: [...facts.values()] });
      }
    }
    merged[key] = [...byId.values()];
  }
  const errors = validateProfile(merged);
  if (errors.length) throw new Error(`Import rejected:\n- ${errors.join('\n- ')}`);
  const count = Object.values(approved).filter(Array.isArray).reduce((n, items) => n + items.length, 0);
  if (!count) { process.stdout.write('No approved items; profile was not changed.\n'); return; }
  mkdirSync(dirname(profilePath), { recursive: true });
  const tmpPath = `${profilePath}.tmp`;
  writeFileSync(tmpPath, yaml.dump(merged, { noRefs: true, lineWidth: 100 }), { encoding: 'utf8', flag: 'w' });
  renameSync(tmpPath, profilePath);
  process.stdout.write(`Saved ${profilePath}. Approved items are marked verified; existing entries were preserved.\n`);
}

function doValidate(args) {
  const pathArg = args.find((arg) => !arg.startsWith('--'));
  const file = pathArg ? resolve(root, pathArg) : profilePath;
  if (!existsSync(file)) throw new Error(`Profile not found: ${file}`);
  const errors = validateProfile(yaml.load(readFileSync(file, 'utf8')));
  if (errors.length) { process.stderr.write(`Invalid profile:\n- ${errors.join('\n- ')}\n`); process.exitCode = 1; }
  else process.stdout.write(`Valid Master Career Profile: ${file}\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === '--help' || command === '-h') process.stdout.write(HELP);
  else if (command === 'import') await doImport(args);
  else if (command === 'validate') doValidate(args);
  else throw new Error(`Unknown command: ${command}\n\n${HELP}`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
