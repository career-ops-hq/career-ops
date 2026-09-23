#!/usr/bin/env node
// ci-approve: aprueba runs de CI de forks que esperan aprobación (`action_required`), con las mismas reglas
// que bin/act-approve-ci.mjs (reimplementadas aquí, sin dependencias, para correr como Action):
//   1. Paginar TODOS los runs `action_required` (nunca `--limit`: el 29-jul se aprobó a ciegas por un tope de 30).
//   2. Agrupar por `head_sha` en local: un SHA → una decisión, aunque tenga 3 runs (matriz) esperando.
//   3. Aprobar solo si: la PR está ABIERTA · el run es del `head.sha` ACTUAL de la PR · el autor no es bot ·
//      la PR no toca `.github/**` ni `package.json`/`package-lock.json` (un run aprobado ejecuta el código del
//      fork) · pudimos leer sus ficheros (lista vacía = "no pude ver", nunca "inocuo").
//   4. Tope 20 aprobaciones por ejecución. El resto se queda para la siguiente pasada (*/30).
// Env: GITHUB_TOKEN (o CI_APPROVE_TOKEN, ver ci-approve.yml) · GITHUB_REPOSITORY · DRY_RUN · CI_APPROVE_MAX (20)

import fs from 'node:fs';

const API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.CI_APPROVE_TOKEN || process.env.GITHUB_TOKEN;
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const MAX = Number(process.env.CI_APPROVE_MAX || 20);
const lines = [];
const log = (l) => { lines.push(l); process.stdout.write(l + '\n'); };

async function rest(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}/${url}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-ci-approve', ...(body ? { 'content-type': 'application/json' } : {}) },
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
    out.push(...(Array.isArray(data) ? data : (data?.workflow_runs || data?.check_runs || data?.items || [])));
    const m = /<([^>]+)>;\s*rel="next"/.exec(link); next = m ? m[1] : null;
  }
  return out;
}

// ---------- Reglas puras (testeables sin red) ----------
export const FORBIDDEN = [/^\.github\//, /^package(-lock)?\.json$/];
export const isBot = (u) => !u || u.type === 'Bot' || /\[bot\]$/.test(u.login || '');
export function touchesForbidden(files) { return files.filter((f) => FORBIDDEN.some((re) => re.test(f.filename || f))); }
export function groupByHeadSha(runs) {
  const m = new Map();
  for (const r of runs) { if (!m.has(r.head_sha)) m.set(r.head_sha, []); m.get(r.head_sha).push(r); }
  return m;
}
/** Decide para un grupo (un SHA). Devuelve {ok, why}. `pr` = PR abierta asociada (o null), `files` = ficheros de la PR. */
export function decide({ sha, pr, files }) {
  if (!pr) return { ok: false, why: 'sin PR abierta para este SHA' };
  if (pr.state !== 'open') return { ok: false, why: `PR #${pr.number} no está abierta` };
  if (pr.head.sha !== sha) return { ok: false, why: `SHA no es el head actual de #${pr.number} (${pr.head.sha.slice(0, 7)})` };
  if (isBot(pr.user)) return { ok: false, why: `autor bot (${pr.user.login})` };
  if (!files || !files.length) return { ok: false, why: `#${pr.number}: no pude leer sus ficheros, no apruebo a ciegas` };
  const bad = touchesForbidden(files);
  if (bad.length) return { ok: false, why: `#${pr.number} toca ${bad.slice(0, 3).map((f) => f.filename || f).join(', ')}` };
  return { ok: true, why: `#${pr.number} abierta, head actual, autor ${pr.user.login}, ${files.length} ficheros seguros` };
}

async function main() {
  if (!TOKEN || !REPO) throw new Error('faltan GITHUB_TOKEN o GITHUB_REPOSITORY');
  log(`ci-approve${DRY ? ' (DRY_RUN)' : ''}${process.env.CI_APPROVE_TOKEN ? ' con CI_APPROVE_TOKEN' : ' con GITHUB_TOKEN'}`);
  const runs = (await getAll(`repos/${REPO}/actions/runs?status=action_required`)).filter((r) => r.event === 'pull_request');
  const groups = groupByHeadSha(runs);
  log(`${runs.length} runs esperando en ${groups.size} SHAs`);
  let approved = 0;
  for (const [sha, group] of groups) {
    if (approved >= MAX) { log(`tope ${MAX} alcanzado: el resto espera a la próxima pasada`); break; }
    let pr = null, files = [];
    try {
      const prs = await getAll(`repos/${REPO}/commits/${sha}/pulls`);
      pr = prs.find((p) => p.state === 'open') || prs[0] || null;
      if (pr) files = await getAll(`repos/${REPO}/pulls/${pr.number}/files`);
    } catch (e) { log(`${sha.slice(0, 7)}: no pude ver la PR (${e.message.slice(0, 80)}): no apruebo`); continue; }
    const d = decide({ sha, pr, files });
    if (!d.ok) { log(`${sha.slice(0, 7)}: no : ${d.why}`); continue; }
    for (const r of group) {
      if (DRY) { log(`DRY-RUN aprobar run ${r.id} (${r.name}) : ${d.why}`); continue; }
      try { await rest('POST', `repos/${REPO}/actions/runs/${r.id}/approve`); log(`aprobado run ${r.id} (${r.name}) : ${d.why}`); }
      catch (e) { log(`run ${r.id}: fallo al aprobar (${e.message.slice(0, 120)})`); }
    }
    approved++;
  }
  log(`${approved} SHAs aprobados`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ci-approve\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((e) => { process.stderr.write(`ci-approve: ${e.message}\n`); process.exit(1); });
