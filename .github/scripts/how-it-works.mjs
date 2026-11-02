#!/usr/bin/env node
// Renders the "How It Works" diagram that every README shows, as a light and a
// dark SVG per diagram language, into docs/how-it-works[-{lang}]-{light,dark}.svg.
//
//   node .github/scripts/how-it-works.mjs --write   # regenerate every SVG
//   node .github/scripts/how-it-works.mjs --check   # exit 1 if an SVG drifted
//
// The READMEs embed the pair through <picture>, the same light/dark switch the
// wordmark uses. Most translations kept the English diagram, so they share the
// English pair. A translation whose diagram text was translated gets its own
// entry in LOCALES, keyed by the README suffix (README.id.md → 'id'), and its
// README points at docs/how-it-works-{lang}-*.svg. To change wording or layout,
// edit this file and run --write; test-all runs --check, so a hand edit to an
// SVG is drift that fails CI instead of being silently undone later.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const USAGE = `Usage: node .github/scripts/how-it-works.mjs --write | --check

Renders the README "How It Works" diagram into docs/how-it-works[-{lang}]-{light,dark}.svg.
  --write   regenerate every SVG
  --check   exit 1 if an SVG on disk differs from what --write would produce`;

const BRAND = '#DD7627';
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// GitHub's own light and dark page colours, so the diagram sits flush in either.
export const THEMES = {
  light: { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', text: '#1f2328', muted: '#59636e', line: '#8c959f', tint: '#fdf1e7' },
  dark: { bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3', muted: '#9198a1', line: '#6e7681', tint: '#2a1d12' },
};

// '' is English. `pill` is the width of the input pill, sized to its text.
export const LOCALES = {
  '': {
    input: 'You paste a job URL or description', pill: 360,
    s1: 'Archetype Detection', n1: 'Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation',
    s2: 'A-H Evaluation', sub2: 'reads cv.md', n2: 'Match, gaps, comp research, STAR stories, legitimacy',
    outs: ['Report', 'Tailored CV', 'Tracker'],
  },
  id: {
    input: 'Anda menempelkan URL atau deskripsi lowongan', pill: 440,
    s1: 'Deteksi Arketipe', n1: 'Mengklasifikasikan: LLMOps / Agentic / PM / SA / FDE / Transformation',
    s2: 'Evaluasi A-H', sub2: 'membaca cv.md', n2: 'Kecocokan, gap, riset kompensasi, cerita STAR, keabsahan lowongan',
    outs: ['Laporan', 'CV yang disesuaikan', 'Entri Tracker'],
  },
  vi: {
    input: 'Bạn dán URL hoặc mô tả tin tuyển dụng', pill: 400,
    s1: 'Archetype Detection', n1: 'Phân loại: LLMOps / Agentic / PM / SA / FDE / Transformation',
    s2: 'A-H Evaluation', sub2: 'reads cv.md', n2: 'Match, khoảng trống, nghiên cứu lương, câu chuyện STAR, độ tin cậy',
    outs: ['Report', 'CV tùy chỉnh', 'Tracker'],
  },
};

const PATHS = ['reports/*.md', 'PDF by default', 'data/applications.md'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The SVG's <title>, also used as the README <img> alt. Translations reuse only their own diagram wording. */
export function altText(lang) {
  if (!lang) {
    return 'How it works: you paste a job URL or description. Archetype Detection classifies it as LLMOps, Agentic, PM, SA, FDE or Transformation. '
      + 'The A-H Evaluation reads cv.md and covers match, gaps, comp research, STAR stories and legitimacy. '
      + 'It produces a report (reports/*.md), the tailored CV in the format set by cv.output_format — a PDF by default — and a tracker entry (data/applications.md).';
  }
  const L = LOCALES[lang];
  return `${L.input} → ${L.s1} (${L.n1}) → ${L.s2} (${L.sub2}; ${L.n2}) → ${L.outs.map((o, i) => `${o} (${PATHS[i]})`).join(', ')}`;
}

export const svgPath = (lang, theme) => `docs/how-it-works-${lang ? `${lang}-` : ''}${theme}.svg`;

const W = 760, H = 404, CX = W / 2;
const OUTS_X = [160, 380, 600];

const arrow = (x, y1, y2, c) =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 7}" stroke="${c}" stroke-width="2"/>`
  + `<path d="M${x - 6} ${y2 - 9} L${x + 6} ${y2 - 9} L${x} ${y2} Z" fill="${c}"/>`;

export function renderSvg(lang, theme) {
  const L = LOCALES[lang];
  const t = THEMES[theme];
  const step = (y, title, sub, note) => `
  <rect x="100" y="${y}" width="560" height="72" rx="10" fill="${t.panel}" stroke="${t.border}"/>
  <clipPath id="clip${y}"><rect x="100" y="${y}" width="560" height="72" rx="10"/></clipPath>
  <rect x="100" y="${y}" width="6" height="72" fill="${BRAND}" clip-path="url(#clip${y})"/>
  <text x="${CX}" y="${y + 30}" text-anchor="middle" font-size="17" fill="${t.text}"><tspan font-weight="700">${esc(title)}</tspan>${sub ? `<tspan font-family="${MONO}" font-size="13" fill="${t.muted}">  ${esc(sub)}</tspan>` : ''}</text>
  <text x="${CX}" y="${y + 53}" text-anchor="middle" font-size="13.5" fill="${t.muted}">${esc(note)}</text>`;
  const output = (x, title, sub) => `
  <rect x="${x - 100}" y="324" width="200" height="64" rx="10" fill="${t.tint}" stroke="${BRAND}"/>
  <text x="${x}" y="351" text-anchor="middle" font-size="16" font-weight="700" fill="${t.text}">${esc(title)}</text>
  <text x="${x}" y="373" text-anchor="middle" font-size="13" font-family="${MONO}" fill="${t.muted}">${esc(sub)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}" role="img" aria-labelledby="hiw-title">
  <title id="hiw-title">${esc(altText(lang))}</title>
  <rect width="${W}" height="${H}" rx="12" fill="${t.bg}"/>
  <rect x="${CX - L.pill / 2}" y="16" width="${L.pill}" height="44" rx="22" fill="${t.bg}" stroke="${BRAND}" stroke-width="2"/>
  <text x="${CX}" y="44" text-anchor="middle" font-size="15" font-weight="600" fill="${t.text}">${esc(L.input)}</text>
  ${arrow(CX, 60, 92, t.line)}${step(92, L.s1, '', L.n1)}
  ${arrow(CX, 164, 196, t.line)}${step(196, L.s2, L.sub2, L.n2)}
  <line x1="${CX}" y1="268" x2="${CX}" y2="294" stroke="${t.line}" stroke-width="2"/>
  <line x1="${OUTS_X[0]}" y1="294" x2="${OUTS_X[2]}" y2="294" stroke="${t.line}" stroke-width="2" stroke-linecap="round"/>
  ${OUTS_X.map((x) => arrow(x, 294, 324, t.line)).join('')}${OUTS_X.map((x, i) => output(x, L.outs[i], PATHS[i])).join('')}
</svg>
`;
}

/** Every SVG this script owns, as [repo-relative path, expected content]. */
export function expectedFiles() {
  return Object.keys(LOCALES).flatMap((lang) =>
    Object.keys(THEMES).map((theme) => [svgPath(lang, theme), renderSvg(lang, theme)]));
}

export function checkAll() {
  const problems = [];
  for (const [rel, svg] of expectedFiles()) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) problems.push(`${rel}: missing`);
    else if (readFileSync(abs, 'utf8') !== svg) problems.push(`${rel}: differs from what --write renders`);
  }
  return problems;
}

function main() {
  const mode = process.argv[2] || '';
  if (mode === '--help' || mode === '-h') { console.log(USAGE); return; }
  if (mode === '--write') {
    const written = [];
    for (const [rel, svg] of expectedFiles()) {
      const abs = join(ROOT, rel);
      if (!existsSync(abs) || readFileSync(abs, 'utf8') !== svg) { writeFileSync(abs, svg); written.push(rel); }
    }
    console.log(written.length ? `written: ${written.join(', ')}` : 'every How It Works SVG is already up to date');
    return;
  }
  if (mode === '--check') {
    const problems = checkAll();
    if (!problems.length) { console.log('every How It Works SVG matches .github/scripts/how-it-works.mjs'); return; }
    console.error(problems.join('\n'));
    console.error('Run: node .github/scripts/how-it-works.mjs --write');
    process.exit(1);
  }
  console.error(USAGE);
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
