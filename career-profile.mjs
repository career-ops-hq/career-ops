#!/usr/bin/env node

/**
 * Import CV facts into a reviewable, source-backed Master Career Profile.
 * Parsing is deliberately conservative: the CV is evidence, not an instruction.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { createInterface } from 'readline';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';

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

function normalizeKey(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function stableId(kind, value, source, parent = '') {
  let normalizedSource = source.replaceAll('\\', '/').replace(/\/+/g, '/');
  if (process.platform === 'win32') normalizedSource = normalizedSource.toLocaleLowerCase('en-US');
  const identity = [kind, normalizedSource, normalizeKey(parent), normalizeKey(value)].join('\0');
  return `${kind}-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function evidenceKey(item) {
  return `${item?.evidence?.source ?? ''}\0${normalizeKey(item?.evidence?.quote ?? '')}`;
}

function entityEvidenceKey(entry) {
  const facts = (entry.facts ?? []).map(evidenceKey).sort();
  return `${evidenceKey(entry)}\0${facts.join('\0')}`;
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
    const fact = { id: stableId(collection, value, source, entity?.label ?? ''), text: value,
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
        entity = { id: stableId(section, title, source), label: title,
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
        entity = { id: stableId(section, value, source), label: value,
          evidence: { source, line: lineNo, quote: raw.trim() }, facts: [] };
        result[section].push(entity);
      }
    }
  });
  for (const key of ['summary', 'certifications', 'skills']) {
    const unique = new Map();
    for (const fact of result[key]) if (!unique.has(fact.id)) unique.set(fact.id, fact);
    result[key] = [...unique.values()];
  }
  for (const key of ['experiences', 'projects', 'education']) {
    const groups = new Map();
    for (const entry of result[key]) {
      const labelKey = normalizeKey(entry.label);
      const factKeys = new Set();
      entry.facts = entry.facts.filter((fact) => {
        const factKey = normalizeKey(fact.text);
        if (factKeys.has(factKey)) return false;
        factKeys.add(factKey);
        return true;
      });
      const signature = `${labelKey}\0${[...factKeys].sort().join('\0')}`;
      if (!groups.has(labelKey)) groups.set(labelKey, new Map());
      const entriesBySignature = groups.get(labelKey);
      if (entriesBySignature.has(signature)) continue;
      entriesBySignature.set(signature, entry);
    }
    const uniqueEntries = [];
    for (const [labelKey, entriesBySignature] of groups) {
      const signatures = [...entriesBySignature.keys()].sort();
      const baseSignature = signatures[0];
      for (const signature of signatures) {
        const entry = entriesBySignature.get(signature);
        const baseId = stableId(key, entry.label, source);
        if (signature !== baseSignature) {
          entry.id = stableId(key, `entry:${signature}`, source);
          for (const fact of entry.facts) fact.id = stableId(key, fact.text, source, entry.id);
        } else entry.id = baseId;
        uniqueEntries.push(entry);
      }
    }
    result[key] = uniqueEntries;
  }
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

async function ask(lines, question) {
  process.stdout.write(question);
  const answer = await lines.next();
  return answer.done ? null : answer.value.trim();
}

async function reviewFact(fact, label, lines) {
  process.stdout.write(`\n${label}: ${fact.text}\n  Evidence: ${fact.evidence.source}:${fact.evidence.line} — ${fact.evidence.quote}\n`);
  while (true) {
    const response = await ask(lines, '  [y] approve / [e] edit / [n] skip / [q] finish: ');
    if (response === null) return { quit: true };
    const answer = response.toLowerCase();
    if (answer === 'y') { fact.review_status = 'verified'; return { fact, edited: false }; }
    if (answer === 'n') return { fact: null, edited: false };
    if (answer === 'q') return { quit: true };
    if (answer === 'e') {
      const edited = await ask(lines, '  Revised wording (blank cancels): ');
      if (edited === null) return { quit: true };
      if (edited) { fact.text = edited; fact.review_status = 'verified'; return { fact, edited: true }; }
    }
  }
}

async function doImport(args) {
  const review = args.includes('--review');
  const sourceArg = args.find((arg) => !arg.startsWith('--')) || 'cv.md';
  const sourcePath = resolve(root, sourceArg);
  if (!existsSync(sourcePath)) throw new Error(`CV file not found: ${sourcePath}`);
  const relativeSource = relative(root, sourcePath);
  const outsideRoot = relativeSource === '..' || relativeSource.startsWith(`..${sep}`) || isAbsolute(relativeSource);
  const source = outsideRoot ? sourcePath : relativeSource.split(sep).join('/');
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
  const skippedEntities = new Set();
  const editedIds = new Set();
  let quit = false;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  try {
    for (const entry of candidates) {
      if (quit) break;
      if (entry.fact && entry.item && skippedEntities.has(entry.item.id)) continue;
      const target = entry.fact ?? { id: entry.item.id, text: entry.item.label, evidence: entry.item.evidence, review_status: 'needs_review' };
      const decision = await reviewFact(target, entry.label, lines);
      if (decision.quit) { quit = true; break; }
      if (!decision.fact) {
        if (!entry.fact) skippedEntities.add(entry.item.id);
        continue;
      }
      const result = decision.fact;
      if (decision.edited) editedIds.add(result.id);
      if (entry.fact) {
        if (entry.item && 'facts' in entry.item) {
          const kept = approved[entry.key].find((x) => x.id === entry.item.id);
          if (kept) kept.facts.push(result);
          else approved[entry.key].push({ ...entry.item, review_status: 'verified', facts: [result] });
        } else approved[entry.key].push(result);
      } else approved[entry.key].push({ ...entry.item, label: result.text, review_status: 'verified', facts: [] });
    }
  } finally {
    input.close();
  }

  const count = Object.values(approved).filter(Array.isArray).reduce((n, items) => n + items.length, 0);
  if (!count) { process.stdout.write('No approved items; profile was not changed.\n'); return; }
  await withPipelineLock(profilePath, () => {
    const existing = readProfile(profilePath);
    const merged = { ...existing, schema_version: 1, candidate: { ...existing.candidate, ...approved.candidate } };
    for (const key of ['summary', 'experiences', 'projects', 'education', 'certifications', 'skills']) {
      const existingItems = existing[key] ?? [];
      const reidentified = new Map();
      const migratedIds = new Set();
      for (const item of approved[key]) {
        if (!('facts' in item)) continue;
        const identity = entityEvidenceKey(item);
        const prior = existingItems.find((candidate) => !migratedIds.has(candidate.id) && 'facts' in candidate && entityEvidenceKey(candidate) === identity);
        if (!prior) continue;
        reidentified.set(item.id, prior);
        migratedIds.add(prior.id);
      }
      const byId = new Map(existingItems.filter((item) => !migratedIds.has(item.id)).map((item) => [item.id, item]));
      for (const [id, prior] of reidentified) {
        const incoming = approved[key].find((item) => item.id === id);
        const incomingFactsByEvidence = new Map((incoming?.facts ?? []).map((fact) => [evidenceKey(fact), fact]));
        const facts = (prior.facts ?? []).map((fact) => {
          const fresh = incomingFactsByEvidence.get(evidenceKey(fact));
          return fresh ? { ...fact, id: fresh.id } : fact;
        });
        byId.set(id, { ...prior, id, facts });
      }
      for (const item of approved[key]) {
        if (!byId.has(item.id)) byId.set(item.id, item);
        else if ('facts' in item) {
          const old = byId.get(item.id);
          const facts = new Map((old.facts ?? []).map((fact) => [fact.id, fact]));
          for (const fact of item.facts ?? []) {
            const existingFact = facts.get(fact.id);
            facts.set(fact.id, existingFact
              ? { ...existingFact, ...(editedIds.has(fact.id) ? { text: fact.text } : {}), evidence: fact.evidence, review_status: fact.review_status }
              : fact);
          }
          byId.set(item.id, { ...old, ...(editedIds.has(item.id) ? { label: item.label } : {}), evidence: item.evidence, review_status: item.review_status, facts: [...facts.values()] });
        }
        else byId.set(item.id, {
          ...byId.get(item.id),
          ...(editedIds.has(item.id) ? { text: item.text } : {}),
          evidence: item.evidence,
          review_status: item.review_status,
        });
      }
      merged[key] = [...byId.values()];
    }
    const errors = validateProfile(merged);
    if (errors.length) throw new Error(`Import rejected:\n- ${errors.join('\n- ')}`);
    mkdirSync(dirname(profilePath), { recursive: true });
    const tmpPath = `${profilePath}.tmp`;
    try {
      writeFileSync(tmpPath, yaml.dump(merged, { noRefs: true, lineWidth: 100 }), { encoding: 'utf8', flag: 'w' });
      renameSync(tmpPath, profilePath);
    } catch (error) {
      try { rmSync(tmpPath, { force: true }); } catch { /* keep the save error, not the cleanup one */ }
      throw error;
    }
    process.stdout.write(`Saved ${profilePath}. Approved items are marked verified; existing entries were preserved.\n`);
  });
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
