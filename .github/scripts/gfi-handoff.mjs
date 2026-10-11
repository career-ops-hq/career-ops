#!/usr/bin/env node
// gfi-handoff: los martes, las `good first issue` que nadie ha reclamado pasan a la cola de agentes.
// Criterio (todo debe cumplirse): sin assignee · sin PR enlazada abierta · >30 días de antigüedad ·
// >14 días sin ningún `/assign` o `/claim` en comentarios · sin `claim-pinned` · sin `first-timers-only`.
// Efecto: quita `good first issue`, pone `agent-candidate`, asigna a Copilot coding agent, comenta con marcador.
// Tope 3 por ejecución (= 3 por semana con el cron).
//
// Asignación a Copilot (verificado en docs.github.com/…/use-cloud-agent-via-the-api, sep-2026):
//   REST  POST repos/{o}/{r}/issues/{n}/assignees  body {"assignees":["copilot-swe-agent[bot]"], "agent_assignment":{…}}
//   GraphQL replaceActorsForAssignable(actorIds:[<id del Bot copilot-swe-agent>]) con header
//           GraphQL-Features: issues_copilot_assignment_api_support,coding_agent_model_selection
//   Solo admite tokens user-to-server (PAT / OAuth / GitHub App user token). GITHUB_TOKEN es server-to-server y
//   NO arranca al agente. Por eso hace falta el secret COPILOT_ASSIGN_TOKEN (fine-grained PAT de Santiago,
//   permisos Issues: write y Pull requests: write en el repo). Sin él, el script solo informa (no cambia labels).
//   Comprobación de que el agente está habilitado: suggestedActors(capabilities:[CAN_BE_ASSIGNED]) contiene
//   login `copilot-swe-agent` (comprobado el 22-sep en career-ops-hq/career-ops: id BOT_kgDOC9w8XQ).
// Env: GITHUB_TOKEN · COPILOT_ASSIGN_TOKEN · GITHUB_REPOSITORY · DRY_RUN · GFI_HANDOFF_MAX (3)

import fs from 'node:fs';

const API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const ASSIGN_TOKEN = process.env.COPILOT_ASSIGN_TOKEN;
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '') || !ASSIGN_TOKEN;
const MAX = Number(process.env.GFI_HANDOFF_MAX || 3);
const DAY = 864e5;
const COPILOT = 'copilot-swe-agent[bot]';
const lines = [];
const log = (l) => { lines.push(l); process.stdout.write(l + '\n'); };

async function rest(method, url, body, token = TOKEN) {
  const res = await fetch(url.startsWith('http') ? url : `${API}/${url}`, {
    method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-gfi-handoff', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`);
  return { data: text ? JSON.parse(text) : null, link: res.headers.get('link') || '' };
}
async function getAll(url) {
  const out = []; let next = `${url}${url.includes('?') ? '&' : '?'}per_page=100`;
  while (next) {
    const { data, link } = await rest('GET', next);
    out.push(...(Array.isArray(data) ? data : (data?.items || [])));
    const m = /<([^>]+)>;\s*rel="next"/.exec(link); next = m ? m[1] : null;
  }
  return out;
}

// ---------- Criterio puro (testeable) ----------
export function eligible(issue, { comments, timeline, now = new Date() }) {
  const labels = (issue.labels || []).map((l) => (l.name || l).toLowerCase());
  if (issue.pull_request) return { ok: false, why: 'es una PR' };
  if (!labels.includes('good first issue')) return { ok: false, why: 'sin good first issue' };
  if (labels.includes('first-timers-only')) return { ok: false, why: 'first-timers-only: reservada a personas' };
  if (labels.includes('claim-pinned')) return { ok: false, why: 'claim-pinned' };
  if ((issue.assignees || []).length) return { ok: false, why: `asignada a ${issue.assignees[0].login}` };
  const ageD = (now - new Date(issue.created_at)) / DAY;
  if (ageD <= 30) return { ok: false, why: `${Math.floor(ageD)} días: aún joven (>30)` };
  const linkedOpenPr = (timeline || []).some((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request && e.source.issue.state === 'open');
  if (linkedOpenPr) return { ok: false, why: 'tiene PR abierta enlazada' };
  const lastClaim = Math.max(0, ...(comments || []).filter((c) => /^\s*\/(assign|claim)\b/i.test(c.body || '')).map((c) => new Date(c.created_at).getTime()));
  if (lastClaim && (now - lastClaim) / DAY <= 14) return { ok: false, why: 'claim hace <14 días' };
  return { ok: true, why: `${Math.floor(ageD)} días sin nadie` };
}

async function handoff(issue, why) {
  const n = issue.number;
  if (DRY) { log(`DRY-RUN #${n}: quitar good first issue, poner agent-candidate, asignar ${COPILOT} : ${why}`); return; }
  await rest('DELETE', `repos/${REPO}/issues/${n}/labels/${encodeURIComponent('good first issue')}`);
  await rest('POST', `repos/${REPO}/issues/${n}/labels`, { labels: ['agent-candidate'] });
  await rest('POST', `repos/${REPO}/issues/${n}/comments`, { body:
    `Nobody claimed this one in the newcomer window, so it moves to the agent queue: a coding agent will draft a fix and a maintainer will review it by hand. ` +
    `If you were about to take it, say so here and a maintainer hands it back to you: people always come first.\n\n<!-- co:gfi-handoff:${n} -->` });
  await rest('POST', `repos/${REPO}/issues/${n}/assignees`, {
    assignees: [COPILOT],
    agent_assignment: { target_repo: REPO, base_branch: 'main', custom_instructions: 'Follow .github/copilot-instructions.md. Run `node test-all.mjs --quick` before opening the pull request. Label the pull request agent-generated.', custom_agent: '', model: '' },
  }, ASSIGN_TOKEN);
  log(`hecho #${n}: agent-candidate + ${COPILOT} : ${why}`);
}

async function main() {
  if (!TOKEN || !REPO) throw new Error('faltan GITHUB_TOKEN o GITHUB_REPOSITORY');
  log(`gfi-handoff${DRY ? ` (DRY_RUN${ASSIGN_TOKEN ? '' : ': falta COPILOT_ASSIGN_TOKEN, solo informo'})` : ''}`);
  const now = new Date();
  const issues = await getAll(`repos/${REPO}/issues?state=open&labels=${encodeURIComponent('good first issue')}&sort=created&direction=asc`);
  log(`${issues.length} good first issue abiertas`);
  let done = 0;
  for (const issue of issues) {
    if (done >= MAX) { log(`tope ${MAX}: el resto la semana que viene`); break; }
    if (issue.pull_request || issue.assignees?.length) continue;
    const [comments, timeline] = await Promise.all([getAll(`repos/${REPO}/issues/${issue.number}/comments`), getAll(`repos/${REPO}/issues/${issue.number}/timeline`)]);
    const e = eligible(issue, { comments, timeline, now });
    if (!e.ok) { log(`#${issue.number}: no : ${e.why}`); continue; }
    await handoff(issue, e.why); done++;
  }
  log(`${done} traspasadas`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### gfi-handoff\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((e) => { process.stderr.write(`gfi-handoff: ${e.message}\n`); process.exit(1); });
