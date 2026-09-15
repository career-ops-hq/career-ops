#!/usr/bin/env node
/** Prepare one scoring packet and publish validated results under the existing pipeline lock. */
import { readScanJd, captureScanJds } from './lib/scan-jd.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';
import { normalizeUrl } from './url-key.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { loadBlacklist } from './scan.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { reserveReportNumbers, releaseReportNumbers, formatReportNumber } from './reserve-report-num.mjs';
import { evaluatePrescreen } from './lib/prescreen-core.mjs';
import { writePrescreenCache } from './lib/prescreen-cache.mjs';
import { readShortlist, classifyOpportunity } from './scoring-decisions.mjs';
import { SCORING_HEADINGS, calculateAttractiveness, scoreLabel, validateReport, validateReviewedReport } from './scoring-report.mjs';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OPPORTUNITY_DB = process.env.CAREER_OPS_OPPORTUNITY_DB;
export const hash = value => createHash('sha256').update(value).digest('hex');
export function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, value);
  renameSync(temp, path);
}
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => atomicWrite(path, JSON.stringify(value, null, 2) + '\n');

/** Only current scoring rules and primary candidate sources enter a model packet. */
export function candidateSources(root) {
  const custom = readFileSync(resolve(root, 'modes/_custom.md'), 'utf8');
  const sections = custom.split(/(?=^### )/m).filter(s => /^### (Scoring Rules|Review and decision gate)/.test(s));
  if (sections.length !== 3) throw new Error('Expected the three authoritative scoring rule sections');
  const sources = {
    rules: sections.map(s => s.split(/^<!--|^## /m)[0].trim()).join('\n\n'),
    cv: readFileSync(resolve(root, 'cv.md'), 'utf8'),
    profile: readFileSync(resolve(root, 'config/profile.yml'), 'utf8'),
    targeting: readFileSync(resolve(root, 'modes/_profile.md'), 'utf8'),
  };
  if (existsSync(resolve(root, 'article-digest.md'))) sources.articles = readFileSync(resolve(root, 'article-digest.md'), 'utf8');
  return sources;
}

export function queueRows(text) {
  let section = '';
  const rows = [];
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) section = line.slice(3);
    const url = line.match(/https?:\/\/[^\s|]+/)?.[0];
    if (url && /^- \[[ !~]\]/.test(line) && /^(Pending|Pendientes|Scored)/.test(section)) {
      rows.push({ row: line, url, key: normalizeUrl(url), section, number: line.match(/#(\d+)/)?.[1] });
    }
  }
  return rows;
}

/** A failed first attempt yields to all untouched roles; a second failure is parked. */
export function selectJob(rows, states) {
  const unique = [...new Map([...rows].reverse().map(r => [r.key, r])).values()].reverse();
  return unique.filter(r => (states[r.key]?.attempts ?? 0) < 2 && states[r.key]?.status !== 'published')
    .sort((a, b) => (states[a.key]?.attempts ?? 0) - (states[b.key]?.attempts ?? 0))[0];
}

export async function prepare(root = ROOT, selectedUrl = null) {
  const sources = candidateSources(root);
  const fingerprint = hash(JSON.stringify(sources));
  if (OPPORTUNITY_DB) {
    const store = await openOpportunityStore(resolve(root, OPPORTUNITY_DB));
    try {
      const job = selectedUrl
        ? store.claimUrl(selectedUrl, 'hermes-score')
        : store.resume('hermes-score') ?? store.claimNext('hermes-score');
      if (!job) return null;
      const opportunity = store.opportunity(job.id);
      const directory = resolve(root, 'data/pipeline-runs/score', `opportunity-${job.id}`, fingerprint.slice(0, 16));
      const statePath = resolve(directory, 'state.json');
      const previous = existsSync(statePath) ? json(statePath) : {};
      for (const [id, content] of Object.entries(sources)) {
        const path = resolve(directory, `${id}.txt`);
        if (!existsSync(path)) atomicWrite(path, content);
        if (readFileSync(path, 'utf8') !== content) throw new Error(`Modified frozen source: ${id}`);
      }
      const state = { ...previous, attempts: (previous.attempts ?? 0) + 1, status: 'running', started_at: new Date().toISOString(), opportunity_id: job.id };
      save(resolve(directory, 'state.json'), state);
      store.saveCheckpoint(job.id, 'prepare', fingerprint, hash(JSON.stringify(state)));
      const scanSnapshot = opportunity.evidence.map(item => item.payload).find(payload => payload?.description)
        ? { url: opportunity.url, text: opportunity.evidence.map(item => item.payload).find(payload => payload?.description).description }
        : null;
      const packet = { ...job, opportunity_id: job.id, directory, root, fingerprint, sources, scan_snapshot: scanSnapshot };
      save(resolve(directory, 'packet.json'), packet);
      return packet;
    } finally { store.close(); }
  }
  const pipeline = resolve(root, 'data/pipeline.md');
  return withPipelineLock(pipeline, () => {
    const text = readFileSync(pipeline, 'utf8');
    const profile = load(sources.profile);
    const historical = new Set(readShortlist(text, { root, profile }).needs_review.map(r => r.row));
    const rows = queueRows(text).filter(r => (/^(Pending|Pendientes)/.test(r.section) || historical.has(r.row))
      && (!selectedUrl || r.key === normalizeUrl(selectedUrl)));
    rows.sort((a, b) => Number(a.section.startsWith('Scored')) - Number(b.section.startsWith('Scored')));
    const states = {};
    for (const r of rows) {
      r.directory = resolve(root, 'data/pipeline-runs/score', hash(r.key).slice(0, 24), fingerprint.slice(0, 16));
      const statePath = resolve(r.directory, 'state.json');
      if (existsSync(statePath)) {
        states[r.key] = json(statePath);
        if (states[r.key].status === 'running') {
          states[r.key].status = states[r.key].attempts >= 2 ? 'needs_attention' : 'retry';
          states[r.key].outcome = 'interrupted';
          save(statePath, states[r.key]);
        }
      }
    }
    const job = selectedUrl ? rows.find(r => states[r.key]?.status !== 'published') : selectJob(rows, states);
    if (!job) return null;
    const previous = states[job.key] ?? {};
    for (const [id, content] of Object.entries(sources)) {
      const path = resolve(job.directory, `${id}.txt`);
      if (!existsSync(path)) atomicWrite(path, content);
      if (readFileSync(path, 'utf8') !== content) throw new Error(`Modified frozen source: ${id}`);
    }
    const state = { ...previous, attempts: (previous.attempts ?? 0) + 1, status: 'running', started_at: new Date().toISOString() };
    save(resolve(job.directory, 'state.json'), state);
    const packet = { ...job, root, fingerprint, sources, scan_snapshot: readScanJd(job.url, root), attempt: state.attempts };
    save(resolve(job.directory, 'packet.json'), packet);
    return packet;
  }, { timeoutMs: 1000, maxWaitMs: 1000 });
}

/** Serialize judgments and restore citation casing/whitespace from frozen sources before strict validation. */
export function renderReport(packet, evidence, assessment) {
  assessment = structuredClone(assessment);
  const { root, directory } = packet;
  if (evidence.complete_jd !== true || evidence.liveness !== 'active' || !evidence.jd?.trim()) throw new Error('Complete live JD required');
  const files = Object.fromEntries(Object.keys(packet.sources).map(id => [id, resolve(directory, `${id}.txt`)]));
  files.jd = resolve(directory, 'jd.txt');
  atomicWrite(files.jd, evidence.jd);
  if (existsSync(resolve(directory, 'browser-snapshot.json'))) files.browser = resolve(directory, 'browser-snapshot.json');
  for (const [i, source] of (assessment.sources ?? []).entries()) {
    if (source.id !== `web${i + 1}` || typeof source.text !== 'string' || !source.text.trim()) throw new Error('External sources must be sequential web1, web2, ... with text');
    files[source.id] = resolve(directory, `${source.id}.txt`);
    atomicWrite(files[source.id], source.text);
  }
  for (const citation of [...Object.values(assessment.dimensions).flatMap(d => d.evidence), ...assessment.research.findings]) {
    if (!citation?.quote || !files[citation.source]) continue;
    const source = readFileSync(files[citation.source], 'utf8');
    const pattern = citation.quote.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    citation.quote = source.match(new RegExp(pattern, 'i'))?.[0] ?? citation.quote;
  }
  files.research = resolve(directory, 'research.json');
  save(files.research, assessment.research);
  const profile = load(packet.sources.profile);
  const summary = {
    report_format: 'scoring-v2', scoring_model: 'attractiveness-v1', score: null,
    company: evidence.company, role: evidence.role, complete_jd: true, jd_source: 'jd',
    sources: Object.entries(files).map(([id, path]) => ({ id, path: relative(root, path), sha256: hash(readFileSync(path)) })),
    dimensions: assessment.dimensions,
    attractiveness: calculateAttractiveness(assessment.dimensions, profile.attractiveness.weights),
  };
  const table = '| 维度 | 分数 | 权重 |\n|---|---|---|\n' + Object.entries(summary.dimensions).map(([key, d]) =>
    `| ${key} | ${d.score ?? 'Unknown'} | ${Number((profile.attractiveness.weights[key] * 100).toFixed(6))}% |`).join('\n');
  const research = assessment.research;
  const researchText = `### 外部研究记录\n\n${research.findings.map(f => `- ${f.id} ${f.url} ${f.entity}`).join('\n') || '- 无外部研究发现'}`;
  const sections = assessment.sections ?? {};
  const bodies = new Map([
    ['A. 岗位概览', sections.overview], ['B. 能力竞争力', sections.capabilities],
    ['C. 入职吸引力', `${scoreLabel(summary.attractiveness)}\n\n${table}`],
    ['D. 薪酬与需求', sections.compensation], ['E. 补证问题', `${sections.questions ?? ''}\n\n${researchText}`],
    ['G. 岗位真实性', sections.legitimacy], ['Risk Summary', sections.risks],
    ['Evaluation Checklist', `${sections.checklist ?? ''}\n\n联网研究：完成；记录见 E. 补证问题。`],
    ['Machine Summary', `\`\`\`yaml\n${dump(summary, { lineWidth: -1, noRefs: true })}\`\`\``],
  ]);
  if ([...bodies.values()].some(body => typeof body !== 'string' || body.trim().length < 20 || /^## /m.test(body))) throw new Error('Report section missing or contains extra level-two headings');
  const report = SCORING_HEADINGS.map(h => `## ${h}\n\n${bodies.get(h)}`).join('\n\n') + '\n';
  validateReport(report, { root });
  atomicWrite(resolve(directory, 'report.md'), report);
  return { report, report_sha256: hash(report), sources: Object.fromEntries(Object.entries(files).map(([id, path]) => [id, readFileSync(path, 'utf8')])) };
}

/** Re-read under the scanner's lock and change only matching rows, preserving concurrent discoveries. */
export async function publish(packet, { discard = null } = {}) {
  const { root, directory } = packet;
  if (hash(JSON.stringify(candidateSources(root))) !== packet.fingerprint) throw new Error('Candidate sources or rules changed; retry with new packet');
  if (packet.opportunity_id) {
    const store = await openOpportunityStore(resolve(root, OPPORTUNITY_DB));
    try {
      const state = json(resolve(directory, 'state.json'));
      if (discard) {
        store.discard(packet.opportunity_id, { evidence: { reason: discard }, checkpoint: { phase: 'discard', inputHash: packet.fingerprint, outputHash: hash(discard) } });
        const result = { status: 'discarded', reason: discard };
        save(resolve(directory, 'state.json'), { ...state, ...result, completed_at: new Date().toISOString() });
        return result;
      }
      const report = readFileSync(resolve(directory, 'report.md'), 'utf8');
      const review = json(resolve(directory, 'report.md.review.json'));
      const score = validateReviewedReport(report, review, { root });
      if (review.gates.liveness !== 'Pass') throw new Error('Live posting verification required');
      const profile = load(packet.sources.profile);
      const reportPath = `reports/opportunity-${packet.opportunity_id}-${hash(report).slice(0, 12)}.md`;
      atomicWrite(resolve(root, reportPath), report);
      save(resolve(root, `${reportPath}.review.json`), review);
      store.publish(packet.opportunity_id, {
        eligibility: review.gates,
        evaluation: { lower: score.lower, upper: score.upper, coverage: score.coverage, reportHash: hash(report) },
        artifact: { kind: 'report', path: reportPath, sha256: hash(report) },
        checkpoint: { phase: 'publish', inputHash: packet.fingerprint, outputHash: hash(report) },
      });
      const result = { status: 'published', report: reportPath, action: classifyOpportunity(score, review.gates, profile.attractiveness.alert_line) };
      save(resolve(directory, 'state.json'), { ...state, ...result, completed_at: new Date().toISOString() });
      return result;
    } finally { store.close(); }
  }
  const pipeline = resolve(root, 'data/pipeline.md');
  return withPipelineLock(pipeline, async () => {
    const text = readFileSync(pipeline, 'utf8');
    const matches = queueRows(text).filter(r => r.key === packet.key);
    const state = json(resolve(directory, 'state.json'));
    if (!matches.length) throw new Error('Job removed or processed concurrently');
    if (matches.some(r => r.row !== packet.row && r.section.startsWith('Scored'))) throw new Error('Job scored concurrently; preserve current report');
    const fields = [...new Set(matches.flatMap(r => r.row.replace(/^- \[[ !~]\]\s*/, '').split('|').map(s => s.trim())))]
      .filter(s => s && !/^#\d+$/.test(s) && !/^https?:\/\//.test(s));
    let row, section, result;
    if (discard) {
      const safeReason = String(discard).replace(/[\r\n\t|]/g, ' ');
      row = `- [x] ${packet.number ? `#${packet.number} | ` : ''}${packet.url} | ${[...fields, safeReason].join(' | ')}`;
      section = 'Processed';
      result = { status: 'discarded', reason: safeReason };
    } else {
      const report = readFileSync(resolve(directory, 'report.md'), 'utf8');
      const review = json(resolve(directory, 'report.md.review.json'));
      const score = validateReviewedReport(report, review, { root });
      if (review.gates.liveness !== 'Pass') throw new Error('Live posting verification required');
      const profile = load(packet.sources.profile);
      const action = classifyOpportunity(score, review.gates, profile.attractiveness.alert_line);
      let reservation;
      if (!state.report_number) {
        if (packet.number) state.report_number = packet.number;
        else {
          reservation = await reserveReportNumbers(1, { rootDir: root, lockOptions: { timeoutMs: 1000, maxWaitMs: 1000 } });
          state.report_number = formatReportNumber(reservation[0]);
        }
        save(resolve(directory, 'state.json'), state);
      }
      const companySlug = score.company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'company';
      const path = `reports/${state.report_number}-${companySlug}-${hash(report).slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.md`;
      atomicWrite(resolve(root, path), report);
      save(resolve(root, `${path}.review.json`), review);
      if (reservation) await releaseReportNumbers(reservation, { rootDir: root });
      const clean = value => value.replace(/[\r\n|]/g, ' ');
      const annotations = fields.filter(s => ![score.company, score.role].includes(s)
        && !/^Report:/.test(s) && !/^吸引力\s/.test(s) && !/^\d(?:\.\d+)?\/5/.test(s));
      row = `- [~] #${state.report_number} | ${packet.url} | ${clean(score.company)} | ${clean(score.role)}${annotations.length ? ' | ' + annotations.join(' | ') : ''} | 吸引力 ${score.lower.toFixed(2)}–${score.upper.toFixed(2)}/5（覆盖率${Number((score.coverage * 100).toFixed(4))}%） | Report: ${path}`;
      section = 'Scored';
      result = { status: 'published', report: path, action };
    }
    const remove = new Set(matches.map(r => r.row));
    let updated = text.split('\n').filter(line => !remove.has(line)).join('\n');
    const marker = new RegExp(`^## ${section}[^\\n]*$`, 'm');
    if (marker.test(updated)) updated = updated.replace(marker, heading => `${heading}\n\n${row}`);
    else updated += `\n\n## ${section}\n\n${row}\n`;
    atomicWrite(pipeline, updated);
    if (discard) {
      const log = resolve(root, 'data/discard.log');
      atomicWrite(log, (existsSync(log) ? readFileSync(log, 'utf8') : '') + `${new Date().toISOString()}\t${packet.url}\t${result.reason}\n`);
    }
    save(resolve(directory, 'state.json'), { ...state, ...result, completed_at: new Date().toISOString() });
    return result;
  }, { timeoutMs: 1000, maxWaitMs: 1000 });
}

export async function claimDiscordDelivery(packet) {
  if (!packet.opportunity_id) return { claimed: true };
  const store = await openOpportunityStore(resolve(packet.root, OPPORTUNITY_DB));
  try {
    const report = readFileSync(resolve(packet.directory, 'report.md'), 'utf8');
    return { claimed: store.claimDelivery(packet.opportunity_id, 'discord', hash(report)) };
  } finally { store.close(); }
}

export async function releaseDiscordDelivery(packet) {
  if (!packet.opportunity_id) return { released: false };
  const store = await openOpportunityStore(resolve(packet.root, OPPORTUNITY_DB));
  try {
    const report = readFileSync(resolve(packet.directory, 'report.md'), 'utf8');
    return { released: store.releaseDelivery(packet.opportunity_id, 'discord', hash(report)) };
  } finally { store.close(); }
}

export async function completeDiscordDelivery(packet) {
  if (!packet.opportunity_id) return { completed: true };
  const store = await openOpportunityStore(resolve(packet.root, OPPORTUNITY_DB));
  try {
    const report = readFileSync(resolve(packet.directory, 'report.md'), 'utf8');
    return { completed: store.completeDelivery(packet.opportunity_id, 'discord', hash(report)) };
  } finally { store.close(); }
}

/** Browser handoffs append discoveries through the same short lock as the scanner and scorer. */
export async function appendPending(lines, root = ROOT) {
  const additions = lines.split('\n').filter(s => s.trim());
  if (additions.some(s => !/^- \[ \] https?:\/\/[^\s|]+(?:\s*\|.*)?$/.test(s))) throw new Error('Expected Pending rows only');
  const path = resolve(root, 'data/pipeline.md');
  return withPipelineLock(path, () => {
    const text = readFileSync(path, 'utf8');
    const seen = new Set([...text.matchAll(/https?:\/\/[^\s|]+/g)].map(m => normalizeUrl(m[0])));
    const fresh = additions.filter(s => {
      const key = normalizeUrl(s.match(/https?:\/\/[^\s|]+/)[0]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!/^## Pending[^\n]*$/m.test(text)) throw new Error('Missing Pending section');
    if (fresh.length) atomicWrite(path, text.replace(/^## Pending[^\n]*$/m, h => `${h}\n\n${fresh.join('\n')}`));
    return { added: fresh.length };
  }, { timeoutMs: 1000, maxWaitMs: 1000 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, path] = process.argv.slice(2);
    const packet = path && !['append-pending', 'prepare'].includes(command) ? json(resolve(path, 'packet.json')) : null;
    let result;
    if (command === 'prepare') result = await prepare(ROOT, path);
    else if (command === 'append-pending') {
      const lines = readFileSync(path, 'utf8');
      const existing = new Set([...readFileSync(resolve(ROOT, 'data/pipeline.md'), 'utf8').matchAll(/https?:\/\/[^\s|]+/g)].map(m => normalizeUrl(m[0])));
      const offers = lines.split('\n').filter(line => /^- \[ \] https?:\/\/[^\s|]+(?:\s*\|.*)?$/.test(line))
        .map(line => ({ url: line.match(/https?:\/\/[^\s|]+/)[0] })).filter(offer => !existing.has(normalizeUrl(offer.url)));
      await captureScanJds(offers, ROOT);
      result = await appendPending(lines);
    }
    else if (command === 'render') result = renderReport(packet, json(resolve(path, 'evidence.json')), json(resolve(path, 'assessment.json')));
    else if (command === 'prescreen') {
      const evidence = json(resolve(path, 'evidence.json'));
      const blacklisted = loadBlacklist(resolve(packet.root, 'data/blacklist.md')).get(normalizeCompany(evidence.company ?? ''));
      if (blacklisted) throw new Error(`Blacklisted company requires user decision: ${blacklisted.company}: ${blacklisted.reason}`);
      result = evaluatePrescreen(evidence.prescreen);
      writePrescreenCache(packet.url, evidence.prescreen, result, resolve(packet.root, 'data/prescreen-cache'));
    } else if (command === 'publish') result = await publish(packet);
    else if (command === 'claim-discord') result = await claimDiscordDelivery(packet);
    else if (command === 'release-discord') result = await releaseDiscordDelivery(packet);
    else if (command === 'complete-discord') result = await completeDiscordDelivery(packet);
    else if (command === 'discard') {
      const evidence = json(resolve(path, 'evidence.json'));
      const screen = evaluatePrescreen(evidence.prescreen);
      const reason = evidence.liveness === 'expired' ? evidence.liveness_reason : screen.status === 'fail' ? screen.discard_reasons.map(r => r.message).join('; ') : null;
      if (!reason) throw new Error('No verified terminal reason');
      result = await publish(packet, { discard: reason });
    } else throw new Error('Usage: score-job.mjs prepare|prescreen|render|publish|discard [directory]');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
