#!/usr/bin/env node
// label-bot: pone y quita labels en PRs e issues como github-actions[bot]. Lo que la automatización del proyecto escribe en un
// hilo sale de una cuenta de bot, nunca de la de una persona (CONTRIBUTING, "Someone else's open PR stays theirs").
// Lo lanza la sesión del maintainer con workflow_dispatch; solo quien tiene permiso de escritura puede lanzarlo.
//
// Entrada: OPS = JSON [{ "pr": n, "add": ["label"], "remove": ["label"] }] (máx. MAX_OPS). La validación es todo o nada: si una label
// no existe en el repo (se crearía sola con un typo), o un número no existe o no es una PR (label-bot solo etiqueta PRs: las issues las
// etiquetan sus propios workflows), no se toca nada. Si una escritura falla a mitad, el resto sigue, se dice qué quedó aplicado (parcial) y el run sale en rojo. Si cambió
// una label direction/*, se redispara direction-gate para esa PR aunque otra fallara: los eventos que hace GITHUB_TOKEN no lanzan
// workflows y el check tiene que ver la label nueva.
import fs from 'node:fs';

const API = 'https://api.github.com';
export const MAX_OPS = 200;
let REPO, TOKEN;
const lines = [];
const log = (l) => { lines.push(l); process.stdout.write(l + '\n'); };

async function rest(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}/${url}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-label-bot', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return { data: text ? JSON.parse(text) : null, link: res.headers.get('link') || '' };
}
async function getAll(url) {
  const out = []; let next = `${url}${url.includes('?') ? '&' : '?'}per_page=100`;
  while (next) { const { data, link } = await rest('GET', next); out.push(...(data || [])); const m = /<([^>]+)>;\s*rel="next"/.exec(link); next = m ? m[1] : null; }
  return out;
}

/** Pura: valida y normaliza. Devuelve { ops } o lanza con el motivo. `known` = nombres de labels del repo. */
export function parseOps(raw, known) {
  let ops; try { ops = JSON.parse(String(raw || '')); } catch { throw new Error('OPS no es JSON'); }
  if (!Array.isArray(ops) || !ops.length) throw new Error('OPS vacío');
  if (ops.length > MAX_OPS) throw new Error(`OPS trae ${ops.length} cambios; máximo ${MAX_OPS} por ejecución`);
  const names = new Set(known);
  const out = ops.map((o, i) => {
    const pr = Number(o?.pr);
    if (!Number.isInteger(pr) || pr <= 0) throw new Error(`cambio ${i}: número inválido (${o?.pr})`);
    const add = [...new Set((o.add || []).map(String))], remove = [...new Set((o.remove || []).map(String))];
    if (!add.length && !remove.length) throw new Error(`#${pr}: sin labels que poner ni quitar`);
    const both = add.filter((l) => remove.includes(l)); if (both.length) throw new Error(`#${pr}: ${both.join(', ')} en add y en remove`);
    const unknown = [...add, ...remove].filter((l) => !names.has(l)); if (unknown.length) throw new Error(`#${pr}: labels que no existen en el repo: ${unknown.join(', ')}`);
    return { pr, add, remove };
  });
  return { ops: out };
}
export const touchesDirection = (op) => [...op.add, ...op.remove].some((l) => l.startsWith('direction/'));

export async function main() {
  REPO = process.env.GITHUB_REPOSITORY; TOKEN = process.env.GITHUB_TOKEN;
  if (!REPO || !TOKEN) throw new Error('faltan GITHUB_REPOSITORY o GITHUB_TOKEN');
  const known = (await getAll(`repos/${REPO}/labels`)).map((l) => l.name);
  const { ops } = parseOps(process.env.OPS, known);
  // Validación completa antes de escribir: cada número existe y es una PR (si no existe, 404; si es una issue, se rechaza el lote).
  for (const op of ops) {
    const { data } = await rest('GET', `repos/${REPO}/issues/${op.pr}`);
    if (!data?.pull_request) throw new Error(`#${op.pr} es una issue: label-bot solo etiqueta PRs (mínimo privilegio: pull-requests, no issues)`);
  }
  const regate = [], failed = [];
  let full = 0;
  for (const op of ops) {
    const done = [];   // cada +label y -label que sí quedó escrito
    try {
      if (op.add.length) { await rest('POST', `repos/${REPO}/issues/${op.pr}/labels`, { labels: op.add }); done.push(...op.add.map((l) => `+${l}`)); }
      for (const l of op.remove) { try { await rest('DELETE', `repos/${REPO}/issues/${op.pr}/labels/${encodeURIComponent(l)}`); } catch (e) { if (e.status !== 404) throw e; } done.push(`-${l}`); }
      full++; log(`#${op.pr} ${done.join(' ') || 'sin cambios'}`);
    } catch (e) { failed.push({ pr: op.pr, done }); log(`#${op.pr}: fallo al escribir (${e.message.slice(0, 120)})${done.length ? `; sí quedó: ${done.join(' ')}` : '; no quedó nada'}`); }
    if (done.length && touchesDirection(op)) regate.push(op.pr); // el gate debe ver lo que cambió, aunque el resto fallara
  }
  for (const pr of [...new Set(regate)]) {
    try { await rest('POST', `repos/${REPO}/actions/workflows/direction-gate.yml/dispatches`, { ref: 'main', inputs: { pr: String(pr) } }); log(`#${pr}: direction-gate redisparado (cambió una label direction/*)`); }
    catch (e) { log(`#${pr}: no pude redisparar direction-gate (${e.message.slice(0, 120)})`); process.exitCode = 1; }
  }
  if (failed.length) {
    const some = failed.filter((f) => f.done.length);
    log(`PARCIAL: ${full} de ${ops.length} cambios aplicados enteros como github-actions[bot]${some.length ? `, ${some.length} a medias (${some.map((f) => `#${f.pr} ${f.done.join(' ')}`).join('; ')})` : ''}; fallaron ${failed.map((f) => `#${f.pr}`).join(', ')}`);
    process.exitCode = 1;
  }
  else log(`${ops.length} cambios aplicados como github-actions[bot]`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### label-bot\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((e) => { process.stderr.write(`label-bot: ${e.message}\n`); process.exit(1); });
