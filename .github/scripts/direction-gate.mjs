#!/usr/bin/env node
// direction-gate: check requerido que FALLA si la PR lleva el label `direction/needs-santiago`.
// Cero reglas de contenido: solo lee labels. La política de dirección corre en la sesión (policy-check);
// aquí solo se impide que la merge queue / auto-merge fusione lo que Santiago no ha decidido.
//
// Eventos:
//  - pull_request (opened/synchronize/reopened/labeled/unlabeled): lee los labels ACTUALES por API (el payload
//    de `labeled` puede ir por detrás de un segundo cambio) y falla si está el label.
//  - merge_group: la PR solo entra en cola con todos los checks requeridos en verde, este incluido, así que en
//    principio ya no puede llevar el label. Aun así, si el `head_ref` de la cola permite leer el número de PR
//    (`refs/heads/gh-readonly-queue/main/pr-N-<sha>`), se vuelven a leer los labels: un label puesto DESPUÉS de
//    entrar en cola también bloquea. Si no se puede leer el número, pasa (documentado: el gate ya se evaluó en la PR).
//  - workflow_dispatch (input pr): evalúa la PR y crea el check `direction-gate` en su head por la Checks API (el ruleset
//    no ata el check a una app). Para PRs cuyo merge ref es anterior a este workflow: sin esto quedan BLOCKED para siempre.
// Env: GITHUB_TOKEN · GITHUB_REPOSITORY · GITHUB_EVENT_NAME · GITHUB_EVENT_PATH · BLOCK_LABEL · PR_NUMBER (dispatch)

import fs from 'node:fs';

export const BLOCK_LABEL = process.env.BLOCK_LABEL || 'direction/needs-santiago';

/** Pura: decide con una lista de nombres de labels. */
export function gate(labels, blockLabel = BLOCK_LABEL) {
  const has = (labels || []).includes(blockLabel);
  return has
    ? { ok: false, why: `lleva ${blockLabel}: solo Santiago decide; se fusiona con su OK (quita el label desde el lote)` }
    : { ok: true, why: `sin ${blockLabel}` };
}
/** Pura: número de PR a partir del head_ref de la merge queue, o null. */
export function prFromQueueRef(ref) {
  const m = /gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(ref || '');
  return m ? Number(m[1]) : null;
}

const H = () => ({ authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-direction-gate', 'content-type': 'application/json' });
async function api(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}
/** workflow_dispatch: el check se crea en el head de la PR con el veredicto; devuelve {ok, why, headSha}. */
export async function dispatchGate(number) {
  const pr = await api('GET', `pulls/${number}`);
  if (pr.state !== 'open') return { ok: false, why: `#${number} está ${pr.state}`, headSha: pr.head?.sha, skipped: true };
  const labels = await labelsOf(number);
  const r = gate(labels);
  await api('POST', 'check-runs', { name: 'direction-gate', head_sha: pr.head.sha, status: 'completed', conclusion: r.ok ? 'success' : 'failure', output: { title: r.ok ? 'pasa' : 'falla', summary: r.why } });
  return { ...r, headSha: pr.head.sha };
}

async function labelsOf(number) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues/${number}/labels?per_page=100`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-direction-gate' },
  });
  if (!res.ok) throw new Error(`labels #${number} → ${res.status}`);
  return (await res.json()).map((l) => l.name);
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let number = null;
  if (eventName === 'workflow_dispatch') {
    number = Number(process.env.PR_NUMBER || event.inputs?.pr);
    if (!number) throw new Error('workflow_dispatch sin input pr');
    const r = await dispatchGate(number);
    process.stdout.write(`direction-gate #${number} (dispatch, check en ${String(r.headSha).slice(0, 7)}): ${r.skipped ? 'saltado' : r.ok ? 'pasa' : 'FALLA'} : ${r.why}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `direction-gate #${number} (dispatch): ${r.ok ? 'pasa' : 'falla'} : ${r.why}\n`);
    if (!r.ok && !r.skipped) process.exit(1);
    return;
  }
  if (eventName === 'merge_group') {
    number = prFromQueueRef(event.merge_group?.head_ref);
    if (!number) { process.stdout.write('merge_group sin número de PR legible: pasa (el gate ya se evaluó en la PR)\n'); return; }
  } else number = event.pull_request?.number;
  if (!number) throw new Error(`evento ${eventName} sin PR`);
  const labels = await labelsOf(number); // lectura fresca, no el payload
  const r = gate(labels);
  process.stdout.write(`direction-gate #${number} (${eventName}): ${r.ok ? 'pasa' : 'FALLA'} : ${r.why}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `direction-gate #${number}: ${r.ok ? 'pasa' : 'falla'} : ${r.why}\n`);
  if (!r.ok) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((e) => { process.stderr.write(`direction-gate: ${e.message}\n`); process.exit(2); });
