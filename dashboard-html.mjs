#!/usr/bin/env node
// dashboard-html.mjs — one-file HTML dashboard of the applications tracker.
//
// Reads the tracker (data/applications.md, resolved through path-resolver.mjs)
// and writes output/dashboard.html: stat tiles, status filters, search and a
// sortable table with links to each posting and its report. No server, no
// build step: the page is self-contained and opens straight from disk.
//
//   node dashboard-html.mjs          # rebuild output/dashboard.html
//   node dashboard-html.mjs --open   # rebuild and open it in the default browser

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { firstLinkTarget, parseTrackerRow, resolveColumns } from './tracker-parse.mjs';

const root = getCareerOpsRoot();
const trackerPath = resolveTrackerPath(root);
const outDir = join(root, 'output');
const outFile = join(outDir, 'dashboard.html');

const lines = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf8').split(/\r?\n/) : [];
const colmap = resolveColumns(lines);
const trackerDir = dirname(trackerPath);

const rows = lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean).map(r => {
  const reportTarget = firstLinkTarget(r.report);
  // Links in the tracker are relative to the tracker's own folder; the page lives in output/.
  const report = reportTarget ? relative(outDir, join(trackerDir, reportTarget)).replace(/\\/g, '/') : '';
  let source = '';
  try { source = r.url ? new URL(r.url).hostname.replace(/^(www|jobs)\./, '') : ''; } catch { /* not a URL */ }
  return {
    n: r.num,
    date: r.date,
    company: r.company,
    role: r.role,
    score: parseFloat(r.score) || null,
    status: r.status,
    pdf: r.pdf.includes('✅'),
    report,
    url: r.url,
    source,
    note: r.notes,
  };
});

// JSON inside <script>: escape "<" so a note can never close the tag.
const data = JSON.stringify(rows).replace(/</g, '\\u003c');
const updated = new Date().toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });

const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Tracker</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--text:#1a1a1a;--muted:#6b6b6b;--line:#e4e4e0;--accent:#2f5d50;
--good:#2f7d4f;--mid:#a26b12;--low:#a33a3a;--chip:#efefea}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1d1d1d;--text:#eaeaea;--muted:#9a9a9a;--line:#2e2e2e;--accent:#7fb8a4;--good:#6fcf97;--mid:#e0b04f;--low:#ef7d7d;--chip:#2a2a2a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:22px}
.stat span{color:var(--muted);font-size:12px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.bar button{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:5px 12px;cursor:pointer;font:inherit}
.bar button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.bar input{flex:1;min-width:180px;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:6px 10px;font:inherit}
.wrap{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:820px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
tr:last-child td{border-bottom:0}
.score{font-weight:700}
.s-good{color:var(--good)}.s-mid{color:var(--mid)}.s-low{color:var(--low)}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:2px 9px;font-size:12px;white-space:nowrap}
.st-Applied{background:var(--accent);color:#fff}
.st-Interview,.st-Offer,.st-Hired{background:var(--good);color:#fff}
.st-Rejected,.st-Discarded,.st-SKIP{opacity:.6}
.note{color:var(--muted);font-size:12.5px;max-width:420px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.role{font-weight:600}
.empty{padding:24px;text-align:center;color:var(--muted)}
</style>
</head>
<body>
<main>
<h1>Job Tracker</h1>
<p class="sub">Оновлено ${updated}</p>
<div class="stats" id="stats"></div>
<div class="bar" id="filters"></div>
<div class="wrap"><table>
<thead><tr><th data-k="n">#</th><th data-k="date">Дата</th><th data-k="role">Вакансія</th><th data-k="score">Бал</th><th data-k="status">Статус</th><th data-k="source">Джерело</th><th>Звіт</th><th>Нотатка</th></tr></thead>
<tbody id="rows"></tbody></table></div>
</main>
<script>
const ROWS = ${data};
let filter = 'Усі', q = '', sortK = 'n', sortDir = -1;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cls = s => s == null ? '' : s >= 4 ? 's-good' : s >= 3.5 ? 's-mid' : 's-low';
function stats(){
  const by = s => ROWS.filter(r => r.status === s).length;
  const scored = ROWS.filter(r => r.score);
  const avg = scored.length ? (scored.reduce((a, r) => a + r.score, 0) / scored.length).toFixed(1) : '—';
  document.getElementById('stats').innerHTML = [
    ['Усього', ROWS.length], ['Оцінено', by('Evaluated')], ['Подано', by('Applied')],
    ['Тестові', by('Assessment')], ['Співбесіди', by('Interview')], ['Середній бал', avg]
  ].map(([k, v]) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>').join('');
}
function filters(){
  const st = ['Усі', ...new Set(ROWS.map(r => r.status))];
  document.getElementById('filters').innerHTML = st.map(s => '<button class="' + (s === filter ? 'on' : '') + '" data-f="' + esc(s) + '">' + esc(s) + '</button>').join('') + '<input id="q" placeholder="Пошук: компанія, роль, нотатка" value="' + esc(q) + '">';
  document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
  const i = document.getElementById('q'); i.oninput = () => { q = i.value.toLowerCase(); draw(); };
}
function draw(){
  let r = ROWS.filter(x => (filter === 'Усі' || x.status === filter) && (!q || (x.company + ' ' + x.role + ' ' + x.note).toLowerCase().includes(q)));
  r.sort((a, b) => { const A = a[sortK] ?? '', B = b[sortK] ?? ''; return (A > B ? 1 : A < B ? -1 : 0) * sortDir; });
  document.getElementById('rows').innerHTML = r.length ? r.map(x =>
    '<tr><td>' + x.n + '</td><td>' + esc(x.date) + '</td>' +
    '<td><div class="role">' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.role) + '</a>' : esc(x.role)) + '</div>' + esc(x.company === '?' ? 'роботодавець прихований' : x.company) + '</td>' +
    '<td class="score ' + cls(x.score) + '">' + (x.score ?? '—') + '</td>' +
    '<td><span class="chip st-' + esc(x.status) + '">' + esc(x.status) + '</span></td>' +
    '<td>' + esc(x.source) + '</td>' +
    '<td>' + (x.report ? '<a href="' + esc(x.report) + '">звіт</a>' : '') + '</td>' +
    '<td class="note">' + esc(x.note) + '</td></tr>').join('')
    : '<tr><td colspan="8" class="empty">' + (ROWS.length ? 'Нічого не знайдено' : 'Поки порожньо — запусти /scan-all') + '</td></tr>';
}
function render(){ stats(); filters(); draw(); }
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortK === k ? -sortDir : (k === 'score' || k === 'n' || k === 'date' ? -1 : 1); sortK = k; draw(); });
render();
</script>
</body>
</html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`✅ ${relative(root, outFile)}  ${rows.length} rows`);

if (process.argv.includes('--open')) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', outFile]]
    : process.platform === 'darwin' ? ['open', [outFile]] : ['xdg-open', [outFile]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
