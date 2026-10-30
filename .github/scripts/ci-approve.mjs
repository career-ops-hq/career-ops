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
let REPO, TOKEN, DRY, MAX;
function loadEnv() { // al llamar a main, no al importar: los tests fijan el entorno antes
  REPO = process.env.GITHUB_REPOSITORY; TOKEN = process.env.CI_APPROVE_TOKEN || process.env.GITHUB_TOKEN;
  DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || ''); MAX = Number(process.env.CI_APPROVE_MAX || 20);
}
const lines = [];
const log = (l) => { lines.push(l); process.stdout.write(l + '\n'); };

async function rest(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}/${url}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-ci-approve', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`); e.status = res.status;
    // GitHub también da 403 (o 429) por límite de tasa, primario o secundario: eso no es un token sin permiso.
    e.rateLimited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(text)));
    throw e;
  }
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

/** Todos los runs `action_required` de pull_request. La API corta en 1000 resultados por búsqueda (23-sep: 1098 retenidos, los 98
 *  más viejos no se veían): se recorre por ventanas de `created`, y una ventana de más de 1000 se parte en dos. `page(url)` →
 *  {data, link}. Las ventanas comparten el borde y se deduplica por id: ningún run se pierde entre dos. */
export const API_CAP = 1000;
export async function listHeld(page, { repo, from, to }) {
  const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = [], truncated = [];
  async function win(a, b, depth) {
    const first = await page(`repos/${repo}/actions/runs?status=action_required&created=${iso(a)}..${iso(b)}&per_page=100`);
    if ((first.data?.total_count ?? 0) > API_CAP && depth < 16 && b - a > 60e3) {
      const mid = new Date((a.getTime() + b.getTime()) / 2);
      await win(a, mid, depth + 1); await win(mid, b, depth + 1); return;
    }
    if ((first.data?.total_count ?? 0) > API_CAP) truncated.push({ from: iso(a), to: iso(b), total: first.data.total_count }); // no se puede partir más
    for (let cur = first; ;) {
      out.push(...(cur.data?.workflow_runs || []));
      const m = /<([^>]+)>;\s*rel="next"/.exec(cur.link || ''); if (!m) break;
      cur = await page(m[1]);
    }
  }
  await win(new Date(from), new Date(to), 0);
  const seen = new Set();
  return Object.assign(out.filter((r) => r.event === 'pull_request' && !seen.has(r.id) && seen.add(r.id)), { truncated });
}
/** 403 al aprobar: el token no puede aprobar runs de forks. Se para la pasada y el run sale en rojo. Cómo arreglarlo lo decide
 *  Santiago: un token de GitHub App firma como bot; un PAT personal firmaría a nombre de esa persona (el problema de L98). */
export const DENIED = (tok) => `${tok} no puede aprobar runs de forks (403): la CI de los primerizos sigue retenida. Opciones, las decide Santiago: token de una GitHub App en CI_APPROVE_TOKEN (aprueba como bot) o un PAT personal (aprobaría a nombre de esa persona). Mientras, se aprueba a mano.`;

// ---------- Reglas puras (testeables sin red) ----------
/** Manifiestos y lockfiles de dependencias a CUALQUIER profundidad (web/, dashboard/, scaffolder/…): CONTRIBUTING promete que el bot
 *  solo aprueba la CI si el cambio no toca workflows ni dependencias. Misma regla que bin/act-approve-ci.mjs (RISKY; un test las compara). */
export const DEPENDENCY_FILE = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|\.yarnrc(\.yml)?|\.npmrc|bun\.lockb?|go\.(mod|sum|work)|requirements[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|uv\.lock|setup\.(py|cfg)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock))$/;
export const FORBIDDEN = [/^\.github\//, DEPENDENCY_FILE];
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

/** head.sha → PR abierta. `commits/{sha}/pulls` devuelve [] para un commit de fork (comprobado con #2572 y #4403, 23-sep):
 *  el primerizo de un fork, que es el caso normal, nunca se aprobaba. Se mapea desde la lista de PRs abiertas, como bin/act-approve-ci. */
export function openPrBySha(openPrs) {
  return new Map((openPrs || []).filter((p) => p.state === 'open' && p.head?.sha).map((p) => [p.head.sha, p]));
}

export async function main() {
  loadEnv();
  if (!TOKEN || !REPO) throw new Error('faltan GITHUB_TOKEN o GITHUB_REPOSITORY');
  log(`ci-approve${DRY ? ' (DRY_RUN)' : ''}${process.env.CI_APPROVE_TOKEN ? ' con CI_APPROVE_TOKEN' : ' con GITHUB_TOKEN'}`);
  const openPrs = await getAll(`repos/${REPO}/pulls?state=open`);
  const bySha = openPrBySha(openPrs);
  // Los runs del head de una PR se crean al abrirla o después: basta con mirar desde la PR abierta más vieja (1 h de margen).
  const oldest = openPrs.map((pr) => Date.parse(pr.created_at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const runs = await listHeld((u) => rest('GET', u), { repo: REPO, from: (oldest || Date.now() - 180 * 864e5) - 36e5, to: Date.now() });
  const groups = groupByHeadSha(runs);
  log(`${runs.length} runs esperando en ${groups.size} SHAs · ${bySha.size} PRs abiertas`);
  for (const t of runs.truncated || []) log(`AVISO: la ventana ${t.from}..${t.to} tiene ${t.total} runs retenidos y la API solo da ${API_CAP}: la lista está incompleta`);
  let tried = 0, approvedShas = 0, approvedRuns = 0, orphans = 0, stop = null;
  for (const [sha, group] of groups) {
    if (stop) break;
    if (tried >= MAX) { log(`tope ${MAX} alcanzado: el resto espera a la próxima pasada`); break; }
    const pr = bySha.get(sha) || null;
    if (!pr) { orphans++; continue; } // no es el head de ninguna PR abierta (push encima, cerrada o fusionada): nada que aprobar
    let files = [];
    try { files = await getAll(`repos/${REPO}/pulls/${pr.number}/files`); }
    catch (e) {
      if (e.rateLimited) { stop = 'rate'; log(`#${pr.number} ${sha.slice(0, 7)}: límite de tasa de GitHub al leer sus ficheros (${e.status}): se para la pasada; la siguiente lo reintenta`); break; }
      log(`#${pr.number} ${sha.slice(0, 7)}: no pude leer sus ficheros (${e.message.slice(0, 80)}): no apruebo`); continue;
    }
    const d = decide({ sha, pr, files });
    if (!d.ok) { log(`#${pr.number} ${sha.slice(0, 7)}: no : ${d.why}`); continue; }
    tried++;
    let all = true;
    for (const r of group) {
      if (DRY) { log(`DRY-RUN aprobar run ${r.id} (${r.name}) : ${d.why}`); continue; }
      try { await rest('POST', `repos/${REPO}/actions/runs/${r.id}/approve`); approvedRuns++; log(`aprobado run ${r.id} (${r.name}) : ${d.why}`); }
      catch (e) {
        all = false;
        if (e.rateLimited) { stop = 'rate'; log(`run ${r.id} (#${pr.number}): límite de tasa de GitHub (${e.status}): se para la pasada; la siguiente lo reintenta`); break; }
        if (e.status === 403) { stop = 'denied'; log(`run ${r.id} (#${pr.number}): ${DENIED(process.env.CI_APPROVE_TOKEN ? 'CI_APPROVE_TOKEN' : 'GITHUB_TOKEN')}`); break; }
        log(`run ${r.id}: fallo al aprobar (${e.message.slice(0, 120)})`);
      }
    }
    if (all && !DRY) approvedShas++;
  }
  if (orphans) log(`${orphans} SHAs huérfanos (no son el head de ninguna PR abierta): no se aprueban`);
  if (DRY) log(`${tried} SHAs se aprobarían (DRY_RUN)`);
  else log(`${approvedShas} SHAs aprobados (${approvedRuns} runs)${stop === 'denied' ? '; parada por un 403 de permisos' : stop === 'rate' ? '; parada por límite de tasa' : ''}`);
  if (stop === 'denied' || (runs.truncated || []).length) process.exitCode = 1; // en rojo: que se vea en Actions y en bin/watch-runs
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ci-approve\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((e) => { process.stderr.write(`ci-approve: ${e.message}\n`); process.exit(1); });
