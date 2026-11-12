#!/usr/bin/env node
// Renders the architecture diagrams, as a light and a dark SVG each, into
// docs/architecture-{name}-{light,dark}.svg:
//
//   system-overview   docs/ARCHITECTURE.md → "System Overview"
//   batch-processing  docs/ARCHITECTURE.md → "Batch Processing"
//   component-map     ARCHITECTURE.md → "Component map"
//   data-flow         ARCHITECTURE.md → "Data flow (a typical run)"
//
//   node .github/scripts/architecture-diagrams.mjs --write   # regenerate every SVG
//   node .github/scripts/architecture-diagrams.mjs --check   # exit 1 if an SVG drifted
//
// The docs embed each pair through <picture>, the same light/dark switch the
// README "How It Works" diagram uses (.github/scripts/how-it-works.mjs), with
// the same look. To change wording or layout, edit this file and run --write;
// test-all runs --check, so a hand edit to an SVG is drift that fails CI
// instead of being silently undone later. Each diagram's alt text spells out
// the whole flow, because the image is the only place the flow is written down.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const USAGE = `Usage: node .github/scripts/architecture-diagrams.mjs --write | --check

Renders the architecture diagrams into docs/architecture-{name}-{light,dark}.svg.
  --write   regenerate every SVG
  --check   exit 1 if an SVG on disk differs from what --write would produce`;

const BRAND = '#DD7627';
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// GitHub's own light and dark page colours, so the diagrams sit flush in either.
export const THEMES = {
  light: { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', text: '#1f2328', muted: '#59636e', line: '#8c959f', tint: '#fdf1e7' },
  dark: { bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3', muted: '#9198a1', line: '#6e7681', tint: '#2a1d12' },
};

const W = 760;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const arrowDown = (x, y1, y2, c) =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 7}" stroke="${c}" stroke-width="2"/>`
  + `<path d="M${x - 6} ${y2 - 9} L${x + 6} ${y2 - 9} L${x} ${y2} Z" fill="${c}"/>`;

const arrowRight = (x1, x2, y, c) =>
  `<line x1="${x1}" y1="${y}" x2="${x2 - 7}" y2="${y}" stroke="${c}" stroke-width="2"/>`
  + `<path d="M${x2 - 9} ${y - 6} L${x2 - 9} ${y + 6} L${x2} ${y} Z" fill="${c}"/>`;

const arrowBoth = (x, y1, y2, c) =>
  `<line x1="${x}" y1="${y1 + 7}" x2="${x}" y2="${y2 - 7}" stroke="${c}" stroke-width="2"/>`
  + `<path d="M${x - 6} ${y1 + 9} L${x + 6} ${y1 + 9} L${x} ${y1} Z" fill="${c}"/>`
  + `<path d="M${x - 6} ${y2 - 9} L${x + 6} ${y2 - 9} L${x} ${y2} Z" fill="${c}"/>`;

const hline = (x1, x2, y, c) =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;

/**
 * A rounded box with centred lines of text. `kind` is 'step' (panel fill with
 * the orange accent bar), 'out' (orange-tinted, orange border) or 'group' (a
 * plain container). Each line is { text, dy, mono?, bold?, size?, muted?, sub? },
 * where `sub` trails the text in monospace, as the How It Works steps do.
 */
function box(t, id, { x, y, w, h, kind = 'step', lines }) {
  const fill = kind === 'out' ? t.tint : kind === 'group' ? t.bg : t.panel;
  const stroke = kind === 'out' ? BRAND : t.border;
  let out = `\n  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}"/>`;
  if (kind === 'step') {
    out += `\n  <clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/></clipPath>`
      + `\n  <rect x="${x}" y="${y}" width="6" height="${h}" fill="${BRAND}" clip-path="url(#${id})"/>`;
  }
  for (const l of lines) {
    const attrs = [
      `x="${x + w / 2}"`, `y="${y + l.dy}"`, 'text-anchor="middle"', `font-size="${l.size ?? (l.bold ? 16 : 13)}"`,
      l.bold ? 'font-weight="700"' : '', l.mono ? `font-family="${MONO}"` : '', `fill="${l.muted ? t.muted : t.text}"`,
    ].filter(Boolean).join(' ');
    const sub = l.sub ? `<tspan font-family="${MONO}" font-size="13" font-weight="400" fill="${t.muted}">  ${esc(l.sub)}</tspan>` : '';
    out += `\n  <text ${attrs}>${esc(l.text)}${sub}</text>`;
  }
  return out;
}

const title2 = (title, sub, subMono = true) => [
  { text: title, bold: true, dy: 27 },
  { text: sub, mono: subMono, muted: true, size: subMono ? 12.5 : 13, dy: 48 },
];

const title3 = (title, path, note) => [
  { text: title, bold: true, size: 15, dy: 24 },
  { text: path, mono: true, muted: true, size: 12, dy: 44 },
  { text: note, muted: true, size: 12.5, dy: 63 },
];

const svgOpen = (t, name, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${SANS}" role="img" aria-labelledby="${name}-title">
  <title id="${name}-title">${esc(ALT[name])}</title>
  <rect width="${W}" height="${h}" rx="12" fill="${t.bg}"/>`;

/** Each diagram's <title>, also used as the doc's <img> alt. */
export const ALT = {
  'system-overview': 'System overview: an AI coding CLI agent reads AGENTS.md and modes/*.md and runs one of three flows. '
    + 'Single evaluation (modes/auto-pipeline.md) goes straight to output. '
    + 'Portal scan (scan.mjs and modes/scan.md) fills the URL inbox, data/pipeline.md, which pipeline mode then evaluates. '
    + 'Batch processing (batch/batch-runner.sh) runs N headless workers, one per offer: claude -p workers run in parallel, other CLIs one offer at a time. '
    + 'All three feed the output pipeline: a report (reports/NNN-*.md, the A-H evaluation), a PDF (generate-pdf.mjs, HTML through Playwright) '
    + 'and a tracker TSV (batch/tracker-additions/, merged by merge-tracker.mjs) into the canonical tracker, data/applications.md.',
  'batch-processing': 'Batch processing: batch/batch-input.tsv lists the offers (id, url, source, notes). '
    + 'The orchestrator, batch/batch-runner.sh, records progress in batch/batch-state.tsv so a run can retry and resume, '
    + 'and hands each offer to one of N headless CLI workers running the self-contained prompt batch/batch-prompt.md. '
    + 'Workers are claude -p by default and run in parallel (--parallel, default 3); any other CLI runs one offer at a time. '
    + 'Each worker writes a report (reports/NNN-*.md), a PDF (output/*.pdf) and a tracker TSV line (batch/tracker-additions/). '
    + 'After the batch, merge-tracker.mjs merges the TSV lines into the canonical tracker, data/applications.md.',
  'component-map': 'Component map: an AI coding CLI (or a script) reads the prompt files in modes/*.md, the brain: '
    + 'scoring, evaluation, apply, scan and interview prompts, with _shared.md as the scoring core. '
    + 'They drive five areas: scan (scan.mjs, providers/), evaluate (modes/oferta.md plus the eval scripts), '
    + 'generate (PDFs, CVs, cover letters), track (data/, reports/) and update (update-system.mjs).',
  'data-flow': 'Data flow of a typical run: scan (scan.mjs) adds URLs to data/pipeline.md; evaluate (oferta.md with cv.md) '
    + 'writes reports/NNN-*.md and a row in the tracker, data/applications.md, which links the report; '
    + 'then you apply: you review and click Submit yourself.',
};

// --- System Overview (docs/ARCHITECTURE.md) ---------------------------------

const COLS = [140, 380, 620];

function systemOverview(t) {
  const H = 568;
  const col = (cx, y, lines, kind = 'step', id) => box(t, id, { x: cx - 105, y, w: 210, h: 64, kind, lines });
  const inner = (cx, title, path, note) => box(t, '', { x: cx - 100, y: 360, w: 200, h: 76, kind: 'out', lines: title3(title, path, note) });
  return svgOpen(t, 'system-overview', H)
    + box(t, 'so-agent', { x: 200, y: 16, w: 360, h: 64, lines: title2('AI coding CLI agent', 'reads AGENTS.md + modes/*.md') })
    + `\n  <line x1="380" y1="80" x2="380" y2="100" stroke="${t.line}" stroke-width="2"/>`
    + `\n  ${hline(COLS[0], COLS[2], 100, t.line)}`
    + `\n  ${COLS.map((x) => arrowDown(x, 100, 124, t.line)).join('')}`
    + col(COLS[0], 124, title2('Single evaluation', 'modes/auto-pipeline.md'), 'step', 'so-single')
    + col(COLS[1], 124, title2('Portal scan', 'scan.mjs + modes/scan.md'), 'step', 'so-scan')
    + col(COLS[2], 124, title2('Batch processing', 'batch/batch-runner.sh'), 'step', 'so-batch')
    + `\n  ${arrowDown(COLS[1], 188, 220, t.line)}${arrowDown(COLS[2], 188, 220, t.line)}`
    + col(COLS[1], 220, title2('URL inbox', 'data/pipeline.md'), 'step', 'so-inbox')
    + col(COLS[2], 220, title2('N headless workers', 'parallel only with claude -p', false), 'step', 'so-workers')
    + `\n  ${arrowDown(COLS[0], 188, 316, t.line)}${arrowDown(COLS[1], 284, 316, t.line)}${arrowDown(COLS[2], 284, 316, t.line)}`
    + `\n  <text x="${COLS[1] + 8}" y="304" font-size="12" fill="${t.muted}">pipeline mode</text>`
    + box(t, '', { x: 30, y: 316, w: 700, h: 136, kind: 'group', lines: [{ text: 'Output pipeline', bold: true, size: 15, dy: 28 }] })
    + inner(COLS[0], 'Report', 'reports/NNN-*.md', 'A-H evaluation')
    + inner(COLS[1], 'PDF', 'generate-pdf.mjs', 'HTML → Playwright')
    + inner(COLS[2], 'Tracker TSV', 'batch/tracker-additions/', 'merged by merge-tracker.mjs')
    + `\n  ${arrowDown(380, 452, 488, t.line)}`
    + box(t, '', { x: 230, y: 488, w: 300, h: 64, kind: 'out', lines: title2('Canonical tracker', 'data/applications.md') })
    + '\n</svg>\n';
}

// --- Batch Processing (docs/ARCHITECTURE.md) -------------------------------

function batchProcessing(t) {
  const H = 446;
  const at = (cx, y, h, lines, kind, id) => box(t, id, { x: cx - 105, y, w: 210, h, kind, lines });
  return svgOpen(t, 'batch-processing', H)
    + at(COLS[0], 16, 76, title3('Input offers', 'batch/batch-input.tsv', 'id, url, source, notes'), 'step', 'bp-input')
    + at(COLS[1], 16, 76, title3('Orchestrator', 'batch/batch-runner.sh', 'parallelism, retries, resume'), 'step', 'bp-runner')
    + at(COLS[2], 16, 76, title3('N headless workers', 'batch/batch-prompt.md', 'parallel only with claude -p'), 'step', 'bp-workers')
    + `\n  ${arrowRight(COLS[0] + 105, COLS[1] - 105, 54, t.line)}${arrowRight(COLS[1] + 105, COLS[2] - 105, 54, t.line)}`
    + `\n  ${arrowBoth(COLS[1], 92, 128, t.line)}`
    + `\n  <text x="${COLS[1] + 10}" y="114" font-size="12" fill="${t.muted}">reads + writes</text>`
    + at(COLS[1], 128, 64, title2('Progress', 'batch/batch-state.tsv'), 'step', 'bp-state')
    + `\n  <line x1="${COLS[2]}" y1="92" x2="${COLS[2]}" y2="222" stroke="${t.line}" stroke-width="2"/>`
    + `\n  <text x="${COLS[2] + 10}" y="160" font-size="12" fill="${t.muted}">each worker writes</text>`
    + `\n  ${hline(COLS[0], COLS[2], 222, t.line)}`
    + `\n  ${COLS.map((x) => arrowDown(x, 222, 246, t.line)).join('')}`
    + at(COLS[0], 246, 72, title3('Report', 'reports/NNN-*.md', 'A-H evaluation'), 'out')
    + at(COLS[1], 246, 72, title3('PDF', 'output/*.pdf', 'tailored CV'), 'out')
    + at(COLS[2], 246, 72, title3('Tracker TSV', 'batch/tracker-additions/', 'one line per offer'), 'out')
    + `\n  ${arrowDown(COLS[2], 318, 366, t.line)}`
    + `\n  <text x="${COLS[2] - 10}" y="339" text-anchor="end" font-size="12" fill="${t.muted}">after the batch:</text>`
    + `\n  <text x="${COLS[2] - 10}" y="356" text-anchor="end" font-size="12" font-family="${MONO}" fill="${t.muted}">merge-tracker.mjs</text>`
    + at(COLS[2], 366, 64, title2('Canonical tracker', 'data/applications.md'), 'out')
    + '\n</svg>\n';
}

// --- Component map (ARCHITECTURE.md) ----------------------------------------

const AREAS = [
  ['scan', [['scan.mjs', true], ['providers/', true]]],
  ['evaluate', [['modes/oferta.md', true], ['+ eval scripts', false]]],
  ['generate', [['PDFs, CVs,', false], ['cover letters', false]]],
  ['track', [['data/', true], ['reports/', true]]],
  ['update', [['update-system.mjs', true]]],
];
const AREA_W = 140, AREA_GAP = 8, AREA_X0 = 14;

function componentMap(t) {
  const H = 336;
  const centers = AREAS.map((_, i) => AREA_X0 + i * (AREA_W + AREA_GAP) + AREA_W / 2);
  return svgOpen(t, 'component-map', H)
    + box(t, 'cm-cli', { x: 210, y: 16, w: 340, h: 56, kind: 'step', lines: [{ text: 'AI coding CLI (or scripts)', bold: true, dy: 34 }] })
    + `\n  ${arrowDown(380, 72, 112, t.line)}`
    + `\n  <text x="390" y="97" font-size="12" fill="${t.muted}">reads prompt files</text>`
    + box(t, 'cm-modes', {
      x: 80, y: 112, w: 600, h: 76, lines: [
        { text: 'The brain', sub: 'modes/*.md', bold: true, dy: 29 },
        { text: 'scoring, evaluation, apply, scan and interview prompts; _shared.md is the scoring core', muted: true, size: 12.5, dy: 54 },
      ],
    })
    + `\n  <line x1="380" y1="188" x2="380" y2="204" stroke="${t.line}" stroke-width="2"/>`
    + `\n  ${hline(centers[0], centers[4], 204, t.line)}`
    + `\n  ${centers.map((x) => arrowDown(x, 204, 228, t.line)).join('')}`
    + AREAS.map(([name, rows], i) => box(t, '', {
      x: centers[i] - AREA_W / 2, y: 228, w: AREA_W, h: 92, kind: 'out',
      lines: [{ text: name, bold: true, dy: 28 }, ...rows.map(([text, mono], j) => ({ text, mono, muted: true, size: 12, dy: 52 + j * 19 }))],
    })).join('')
    + '\n</svg>\n';
}

// --- Data flow (ARCHITECTURE.md) --------------------------------------------

const FLOW_W = 158, FLOW_GAP = 34, FLOW_X0 = 13;

function dataFlow(t) {
  const H = 208;
  const xs = [0, 1, 2, 3].map((i) => FLOW_X0 + i * (FLOW_W + FLOW_GAP));
  const row = [
    ['Scan', 'scan.mjs'],
    ['URL inbox', 'data/pipeline.md'],
    ['Evaluate', 'oferta.md + cv.md'],
    ['Report', 'reports/NNN-*.md'],
  ];
  const cx = (i) => xs[i] + FLOW_W / 2;
  const trackerX = (cx(2) + cx(3)) / 2;
  const applyX = 250;
  return svgOpen(t, 'data-flow', H)
    + row.map(([title, sub], i) => box(t, i === 3 ? '' : `df-${i}`, { x: xs[i], y: 16, w: FLOW_W, h: 64, kind: i === 3 ? 'out' : 'step', lines: title2(title, sub) })).join('')
    + `\n  ${[0, 1, 2].map((i) => arrowRight(xs[i] + FLOW_W, xs[i + 1], 48, t.line)).join('')}`
    + `\n  ${arrowDown(cx(2), 80, 128, t.line)}${arrowDown(cx(3), 80, 128, t.line)}`
    + `\n  <text x="${cx(3) + 8}" y="108" font-size="12" fill="${t.muted}">linked</text>`
    + box(t, '', { x: trackerX - 130, y: 128, w: 260, h: 64, kind: 'out', lines: title2('Tracker', 'data/applications.md') })
    + `\n  <line x1="${trackerX - 130}" y1="160" x2="${applyX + 160 + 7}" y2="160" stroke="${t.line}" stroke-width="2"/>`
    + `<path d="M${applyX + 169} ${154} L${applyX + 169} ${166} L${applyX + 160} 160 Z" fill="${t.line}"/>`
    + `\n  <rect x="${applyX - 160}" y="128" width="320" height="64" rx="32" fill="${t.bg}" stroke="${BRAND}" stroke-width="2"/>`
    + `\n  <text x="${applyX}" y="155" text-anchor="middle" font-size="16" font-weight="700" fill="${t.text}">Apply</text>`
    + `\n  <text x="${applyX}" y="176" text-anchor="middle" font-size="13" fill="${t.muted}">you review, then click Submit yourself</text>`
    + '\n</svg>\n';
}

// ---------------------------------------------------------------------------

/** Diagram name → [renderer, the doc that embeds it]. */
export const DIAGRAMS = {
  'system-overview': [systemOverview, 'docs/ARCHITECTURE.md'],
  'batch-processing': [batchProcessing, 'docs/ARCHITECTURE.md'],
  'component-map': [componentMap, 'ARCHITECTURE.md'],
  'data-flow': [dataFlow, 'ARCHITECTURE.md'],
};

export const svgPath = (name, theme) => `docs/architecture-${name}-${theme}.svg`;

export function renderSvg(name, theme) {
  return DIAGRAMS[name][0](THEMES[theme]);
}

/** Every SVG this script owns, as [repo-relative path, expected content]. */
export function expectedFiles() {
  return Object.keys(DIAGRAMS).flatMap((name) =>
    Object.keys(THEMES).map((theme) => [svgPath(name, theme), renderSvg(name, theme)]));
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
    console.log(written.length ? `written: ${written.join(', ')}` : 'every architecture SVG is already up to date');
    return;
  }
  if (mode === '--check') {
    const problems = checkAll();
    if (!problems.length) { console.log('every architecture SVG matches .github/scripts/architecture-diagrams.mjs'); return; }
    console.error(problems.join('\n'));
    console.error('Run: node .github/scripts/architecture-diagrams.mjs --write');
    process.exit(1);
  }
  console.error(USAGE);
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
