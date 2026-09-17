#!/usr/bin/env node
/**
 * hired-wall-build.mjs — the Hired Wall's single builder.
 *
 * HIRED.md is the ledger. Each entry is one machine-readable comment line
 * (the source of truth) followed by its rendered card; this script APPENDS
 * new entries, regenerates every rendered card from the comments, bumps
 * docs/hired-count.json (what the README badge reads) and regenerates
 * docs/hired-wall.svg (the three most recent card-level stories shown under
 * the hero). One writer for all four surfaces so they cannot drift apart.
 *
 *   node hired-wall-build.mjs --rebuild
 *   node hired-wall-build.mjs --add --handle santifer --level handle \
 *        --role "Head of Applied AI" --geo "Spain" --weeks 8 \
 *        --story "..." --link "https://github.com/.../issues/N"
 *
 * Invariants the design promises publicly:
 *   - count == number of ledger lines in HIRED.md == the badge. Auditable.
 *   - numbers are permanent: a withdrawn story keeps its number as
 *     "counted, story withdrawn"; the count never shrinks silently.
 *   - `count`-level entries hold a number and no card (privacy level 3).
 *
 * Avatars: GitHub sanitizes SVGs in READMEs, so a remote <image href> would
 * never load. The workflow passes --fetch-avatars and the avatar bytes are
 * inlined as base64 data URIs at build time (~3KB per face, shields.io
 * pattern). Tests pass --avatar-fixture to stay offline.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = ['handle', 'role', 'count'];

const KNOWN_FLAGS = ['--add', '--rebuild', '--root', '--handle', '--level', '--role', '--sector', '--geo', '--weeks', '--story', '--link', '--fetch-avatars', '--avatar-fixture', '--help', '-h'];
const VALUE_FLAGS = ['--root', '--handle', '--level', '--role', '--sector', '--geo', '--weeks', '--story', '--link', '--avatar-fixture'];

const USAGE = `Usage:
  node hired-wall-build.mjs --rebuild [--fetch-avatars | --avatar-fixture f.png]
  node hired-wall-build.mjs --add --level handle|role|count [--handle X]
       --role "..." [--geo "..."] [--weeks N] [--story "..."] --link URL

Appends an entry to HIRED.md and/or regenerates the wall's derived surfaces
(cards, docs/hired-count.json, docs/hired-wall.svg) from the ledger comments.`;

const LEDGER_RE = /^<!-- hire n=(\d+) level=(handle|role|count)(?: handle=([^\s]+))? role="([^"]*)"(?: sector="([^"]*)")?(?: geo="([^"]*)")?(?: weeks=(\d+))? link="([^"]*)"(?: withdrawn)? -->$/;

/** Parse every ledger comment of HIRED.md, in file order. */
export function parseLedger(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(LEDGER_RE);
    if (!m) continue;
    out.push({
      n: Number(m[1]), level: m[2], handle: m[3] || '', role: m[4],
      sector: m[5] || '', geo: m[6] || '', weeks: m[7] ? Number(m[7]) : null, link: m[8],
      withdrawn: / withdrawn -->$/.test(line),
      raw: line,
    });
  }
  return out;
}

export function ledgerLine(e) {
  const parts = [`<!-- hire n=${e.n} level=${e.level}`];
  if (e.handle) parts.push(`handle=${e.handle}`);
  parts.push(`role="${e.role}"`);
  if (e.sector) parts.push(`sector="${e.sector}"`);
  if (e.geo) parts.push(`geo="${e.geo}"`);
  if (e.weeks) parts.push(`weeks=${e.weeks}`);
  parts.push(`link="${e.link}"`);
  if (e.withdrawn) parts.push('withdrawn');
  return parts.join(' ') + ' -->';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The rendered markdown card that sits under each ledger line. */
export function renderCard(e) {
  if (e.withdrawn) return `**Hire #${e.n}** — counted, story withdrawn at the author's request.`;
  if (e.level === 'count') return `**Hire #${e.n}** — counted, story kept private by choice.`;
  const who = e.level === 'handle'
    ? `<a href="https://github.com/${e.handle}"><img src="https://github.com/${e.handle}.png?size=64" width="28" height="28" align="top" alt="@${e.handle}"> **@${e.handle}**</a>`
    : `**${esc(e.role)}**`;
  const meta = [e.level === 'handle' ? esc(e.role) : (e.sector ? esc(e.sector) : null), e.geo ? esc(e.geo) : null, e.weeks ? `${e.weeks} weeks` : null]
    .filter(Boolean).join(' · ');
  return [
    `### Hire #${e.n}`,
    '',
    `> ${e.story ? esc(e.story) : ''}`,
    '',
    `${who} · ${meta} · [story →](${e.link})`,
  ].join('\n');
}

/**
 * Rebuild HIRED.md's entries section from its own ledger lines. Everything
 * between the ENTRIES markers is generated; prose outside them is
 * hand-written and never touched. Stories live IN the ledger section as a
 * quoted line right under each comment (kept verbatim on rebuild).
 */
export function rebuildWall(text) {
  const start = text.indexOf('<!-- ENTRIES -->');
  const end = text.indexOf('<!-- /ENTRIES -->');
  if (start === -1 || end === -1 || end < start) throw new Error('HIRED.md is missing its <!-- ENTRIES --> markers');
  const section = text.slice(start, end);
  const entries = [];
  const lines = section.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LEDGER_RE);
    if (!m) continue;
    const e = parseLedger(lines[i])[0];
    // The story is the first quoted line following the ledger comment.
    for (let j = i + 1; j < lines.length && !lines[j].match(LEDGER_RE); j++) {
      const q = lines[j].match(/^> (.+)$/);
      if (q) { e.story = q[1]; break; }
    }
    entries.push(e);
  }
  entries.sort((a, b) => b.n - a.n);
  const body = entries.map((e) => `${ledgerLine(e)}\n${renderCard(e)}`).join('\n\n');
  const rebuilt = `${text.slice(0, start)}<!-- ENTRIES -->\n\n${body}\n\n${text.slice(end)}`;
  return { text: rebuilt, entries };
}

// ── The README strip (SVG, three most recent card-level stories) ────────────

async function avatarDataUri(handle, { fetchAvatars, fixture }) {
  if (fixture) return `data:image/png;base64,${readFileSync(fixture).toString('base64')}`;
  if (!fetchAvatars) return null;
  const res = await fetch(`https://github.com/${handle}.png?size=64`, { redirect: 'follow' });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Word-wrap a quote to fit the card; clamps to 4 lines with an ellipsis. */
function wrapQuote(s, max = 34) {
  const words = String(s).split(/\s+/);
  const lines = [''];
  for (const w of words) {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > max) lines.push(w);
    else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim();
    if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].replace(/.{0,3}$/, '') + '…'; break; }
  }
  return lines;
}

export async function buildSvg(entries, opts = {}) {
  const showable = entries.filter((e) => !e.withdrawn && e.level !== 'count').slice(0, 3);
  const total = entries.length;
  // "Hay más": deliberadamente mudo — un chevron y el resto exacto en el gris
  // de la tira, a la derecha. Nada de tarjetas cortadas ni desvanecidos: el
  // fondo del README es del lector (claro u oscuro) y cualquier fade lava.
  const peek = total > 3;
  const W = 900, H = 178, GAP = 14;
  const CW = peek ? 280 : 288;
  const X0 = peek ? 4 : (W - (CW * 3 + GAP * 2)) / 2;
  let cards = '';
  for (let i = 0; i < 3; i++) {
    const x = X0 + i * (CW + GAP);
    const e = showable[i];
    if (!e && i < 3) {
      cards += `<g><rect x="${x}" y="14" width="${CW}" height="150" rx="10" fill="none" stroke="#30363d" stroke-dasharray="5 5"/>
<text x="${x + CW / 2}" y="86" text-anchor="middle" fill="#8b949e" font-size="13" font-style="italic">The next card is yours.</text>
<text x="${x + CW / 2}" y="106" text-anchor="middle" fill="#DD7627" font-size="12" font-weight="700">Share your hire →</text></g>`;
      continue;
    }
    if (!e) continue;
    const quote = wrapQuote(e.story ?? '', peek ? 33 : 34);
    const avatar = e.level === 'handle' ? await avatarDataUri(e.handle, opts) : null;
    // Single-line rows have no wrapping: anything wider than the card was
    // silently CLIPPED by the viewBox (hire #5's four-word role was). Ellipsize
    // at ~the character count that fits the ~222px text run at each font size.
    const oneLine = (s, max) => { const t = String(s ?? ''); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
    const who = oneLine(e.level === 'handle' ? `@${e.handle}` : e.role, 33);
    const sub = oneLine([e.level === 'handle' ? e.role : (e.sector || null), e.geo || null].filter(Boolean).join(' · '), 40);
    cards += `<g><rect x="${x}" y="14" width="${CW}" height="150" rx="10" fill="#161b22" stroke="#30363d"/>
<text x="${x + 16}" y="44" fill="#DD7627" font-size="22" font-weight="800">“</text>
${quote.map((l, k) => `<text x="${x + 34}" y="${44 + k * 19}" fill="#e6edf3" font-size="13" font-style="italic">${esc(l)}</text>`).join('\n')}
${avatar
    ? `<clipPath id="av${i}"><circle cx="${x + 29}" cy="${H - 52}" r="13"/></clipPath><image href="${avatar}" x="${x + 16}" y="${H - 65}" width="26" height="26" clip-path="url(#av${i})"/>`
    : `<clipPath id="an${i}"><circle cx="${x + 29}" cy="${H - 52}" r="13"/></clipPath><circle cx="${x + 29}" cy="${H - 52}" r="13" fill="#30363d"/><g clip-path="url(#an${i})" fill="#8b949e"><circle cx="${x + 29}" cy="${H - 56}" r="4.5"/><path d="M ${x + 21} ${H - 39} a 8 8 0 0 1 16 0 z"/></g>`}
<text x="${x + 50}" y="${H - 56}" fill="#c9d1d9" font-size="12.5" font-weight="700">${esc(who)}</text>
<text x="${x + 50}" y="${H - 41}" fill="#8b949e" font-size="11">${esc(sub)}</text>
<text x="${x + 16}" y="${H - 20}" fill="#DD7627" font-size="10.5" font-weight="800" letter-spacing="0.6">HIRE #${e.n}</text>
${e.weeks ? `<text x="${x + CW - 16}" y="${H - 20}" text-anchor="end" fill="#3fb950" font-size="10.5" font-weight="700">${e.weeks} weeks</text>` : ''}</g>`;
  }
  if (peek) {
    // El resto es EXACTO siempre (la honestidad es la marca del muro), así que
    // a 2-3 dígitos la fuente encoge en vez de truncar: "+9"/"+42" a 9.5,
    // "+997" a 8 — cabe centrado en los 28px de aire hasta el borde.
    const rest = total - 3;
    const fs = rest >= 100 ? 8 : rest >= 10 ? 9 : 9.5;
    cards += `<text x="${W - 12}" y="${H / 2 + 1}" text-anchor="middle" fill="#8b949e" font-size="22" font-weight="600">›</text>
<text x="${W - 12}" y="${H / 2 + 17}" text-anchor="middle" fill="#8b949e" font-size="${fs}" font-weight="700">+${rest}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="none"/>
${cards}
</svg>\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
  const bad = validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  if (bad) { process.exitCode = 1; return; }

  const root = flagValue(args, '--root') || HERE;
  const wallPath = join(root, 'HIRED.md');
  let text = readFileSync(wallPath, 'utf8');

  if (hasFlag(args, '--add')) {
    const level = flagValue(args, '--level');
    const link = flagValue(args, '--link');
    if (!LEVELS.includes(level) || !link) { console.error(`--add needs --level (${LEVELS.join('|')}) and --link.\n\n${USAGE}`); process.exitCode = 1; return; }
    const { entries } = rebuildWall(text);
    // Every field arrives from an untrusted issue body: strip anything that
    // could break the ledger comment (quotes, comment terminators, newlines)
    // or smuggle markup, and clamp lengths. Display escaping happens later in
    // renderCard/buildSvg; this is the STORAGE boundary.
    const clean = (s, max) => String(s ?? '').replace(/["<>]|--/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const e = {
      n: entries.length ? Math.max(...entries.map((x) => x.n)) + 1 : 1,
      level,
      handle: clean(flagValue(args, '--handle'), 40).replace(/[^A-Za-z0-9-]/g, ''),
      role: clean(flagValue(args, '--role'), 80),
      sector: clean(flagValue(args, '--sector'), 40),
      geo: clean(flagValue(args, '--geo'), 40),
      weeks: Number(flagValue(args, '--weeks')) || null,
      story: clean(flagValue(args, '--story'), 200),
      link: /^https:\/\/github\.com\/[\w./-]+$/.test(link) || /^https:\/\/santifer\.io\/[\w./-]*$/.test(link) ? link : '',
      withdrawn: false,
    };
    if (!e.link) { console.error('--link must be a github.com or santifer.io https URL.'); process.exitCode = 1; return; }
    if (level === 'handle' && !e.handle) { console.error('--level handle needs --handle.'); process.exitCode = 1; return; }
    const at = text.indexOf('<!-- ENTRIES -->') + '<!-- ENTRIES -->'.length;
    text = `${text.slice(0, at)}\n\n${ledgerLine(e)}\n> ${e.story}\n${text.slice(at)}`;
    console.log(`hire #${e.n} appended (${level}${e.handle ? ` @${e.handle}` : ''}).`);
  }

  const { text: rebuilt, entries } = rebuildWall(text);
  writeFileSync(wallPath, rebuilt);

  const count = entries.length;
  writeFileSync(join(root, 'docs', 'hired-count.json'), JSON.stringify({ count, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');

  const svg = await buildSvg(entries, {
    fetchAvatars: hasFlag(args, '--fetch-avatars'),
    fixture: flagValue(args, '--avatar-fixture'),
  });
  writeFileSync(join(root, 'docs', 'hired-wall.svg'), svg);
  console.log(`wall rebuilt: ${count} hire(s) · docs/hired-count.json · docs/hired-wall.svg`);
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
