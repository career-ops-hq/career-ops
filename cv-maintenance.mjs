#!/usr/bin/env node
// Previews and applies sourced CV proposals through one explicit confirmation gate.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { applyAdd, normalizeKey } from './add-entry.mjs';

const { positionals, values } = parseArgs({ args: process.argv.slice(2), options: { confirm: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
const usage = 'Usage: node cv-maintenance.mjs preview|apply <proposal.json> [--confirm approved]';
const sources = new Set(['user-stated', 'local-document', 'external-discovery']);
const primaryRefs = /^(cv\.md|config\/profile\.yml|article-digest\.md|user-stated:\d{4}-\d{2}-\d{2})$/;
const claimPatterns = { number: /\d/, scope: /\b(led|managed|owned|headed|drove|delivered)\b/i, authorship: /\b(authored|built|created|founded|invented|developed)\b/i };

function proposal(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Proposal must be an object');
  for (const key of ['source', 'sourceRef', 'exactEvidence', 'targetSection', 'proposedWording', 'dedupKey', 'provenance', 'provenanceRef']) if (!String(raw[key] || '').trim()) throw new Error(`Proposal requires ${key}`);
  if (!sources.has(raw.source)) throw new Error('source must be user-stated, local-document, or external-discovery');
  if (!['verified', 'unverified'].includes(raw.provenance)) throw new Error('provenance must be verified or unverified');
  if (!Array.isArray(raw.claimKinds) || raw.claimKinds.some(kind => !['number', 'scope', 'authorship'].includes(kind))) throw new Error('claimKinds must contain only number, scope, or authorship');
  const inferred = Object.keys(claimPatterns).filter(kind => claimPatterns[kind].test(raw.proposedWording));
  if (inferred.some(kind => !raw.claimKinds.includes(kind))) throw new Error('claimKinds must declare claims present in proposedWording');
  if (raw.provenance === 'verified' && !primaryRefs.test(raw.provenanceRef)) throw new Error('Verified proposals require a primary provenanceRef');
  if (raw.provenanceRef.startsWith('user-stated:') && raw.source !== 'user-stated') throw new Error('user-stated provenance requires a user-stated source');
  if (raw.provenance === 'verified' && !raw.provenanceRef.startsWith('user-stated:') && !readFileSync(raw.provenanceRef, 'utf8').includes(raw.exactEvidence)) throw new Error('Verified exactEvidence must appear in provenanceRef');
  if (raw.provenance === 'unverified' && raw.claimKinds.length) throw new Error('Unverified numbers, scope, and authorship claims cannot be promoted');
  return raw;
}
function proposals(raw) {
  const list = Array.isArray(raw) ? raw : raw?.proposals || [raw];
  if (!Array.isArray(list) || !list.length) throw new Error('Proposal list must not be empty');
  const seen = new Set();
  return list.map(proposal).map(item => {
    const key = normalizeKey(item.dedupKey);
    if (seen.has(key)) throw new Error(`Duplicate proposal dedupKey: ${item.dedupKey}`);
    seen.add(key);
    return item;
  });
}
if (values.help || !['preview', 'apply'].includes(positionals[0]) || !positionals[1]) {
  console.log(usage);
  process.exitCode = values.help ? 0 : 1;
} else {
  try {
    const input = proposals(JSON.parse(readFileSync(positionals[1], 'utf8')));
    if (positionals[0] === 'apply' && values.confirm !== 'approved') throw new Error('Apply requires --confirm approved');
    if (positionals[0] === 'apply' && input.some(item => item.provenance === 'unverified')) throw new Error('Unverified proposals are preview-only; resubmit confirmed facts as user-stated');
    const cvPath = process.env.CAREER_OPS_CV || 'cv.md';
    const articlePath = process.env.CAREER_OPS_ARTICLE_DIGEST || 'article-digest.md';
    let cv = existsSync(cvPath) ? readFileSync(cvPath, 'utf8') : null;
    let articleDigest = existsSync(articlePath) ? readFileSync(articlePath, 'utf8') : null;
    const preview = input.map(item => {
      const next = applyAdd({ cv: { section: item.targetSection, dedupKey: item.dedupKey, entry: item.proposedWording }, ...(item.articleDigest ? { articleDigest: { dedupKey: item.dedupKey, entry: item.articleDigest } } : {}) }, { cvText: cv, articleText: articleDigest });
      cv = next.cv; articleDigest = next.articleDigest;
      return { proposal: item, result: next.result };
    });
    const changed = preview.some(item => item.result.cv.status === 'added' || ['added', 'created'].includes(item.result.articleDigest?.status));
    if (positionals[0] === 'apply' && changed) {
      writeFileSync(cvPath, cv);
      if (articleDigest !== null) writeFileSync(articlePath, articleDigest);
    }
    console.log(JSON.stringify({ preview, applied: positionals[0] === 'apply' && changed, reactiveResume: 'cv.md remains the one-way source; no resume import performed' }, null, 2));
  } catch (error) { console.error(`cv-maintenance: ${error.message}`); process.exitCode = 1; }
}
