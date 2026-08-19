#!/usr/bin/env node
/**
 * resgen-bridge.mjs — hand a career-ops job to the resGen resume tailorer.
 *
 * Writes resGen's `jds/jd_<company>_<role>.txt` (its exact capture format) so
 * you can tailor res.tex there right after career-ops scores the role.
 *
 * Usage:
 *   node resgen-bridge.mjs <report#>                     # e.g. 001  (reads reports/001-*.md)
 *   node resgen-bridge.mjs <url> --company X --role Y
 *   node resgen-bridge.mjs <report#|url> --jd-file jd.txt   # supply JD body yourself
 *   node resgen-bridge.mjs --selftest
 *
 * JD body: auto-fetched from Greenhouse/Lever/Ashby public APIs when the URL is
 * one of those; otherwise pass --jd-file (branded career pages can't be resolved
 * to an ATS slug from the URL alone).
 * ponytail: ATS-API fetch only (gh/lever/ashby) — everything else needs --jd-file.
 *
 * resGen dir: --resgen DIR, else $RESGEN_DIR, else sibling ../resGen.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';

// resGen's slugify, copied verbatim (tools/server/server.js) so filenames match.
const slugify = (v, fb = 'x') =>
  (String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)) || fb;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function fetchJD(url) {
  let m;
  // Lever: jobs.lever.co/<slug>/<id>  ->  api.lever.co/v0/postings/<slug>/<id>
  if ((m = url.match(/lever\.co\/([^/]+)\/([0-9a-f-]+)/i))) {
    const d = await (await fetch(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}?mode=json`)).json();
    const j = Array.isArray(d) ? d[0] : d;
    return strip(j.descriptionPlain || j.description || '') +
      (j.lists || []).map(l => `\n\n${l.text}\n${strip(l.content)}`).join('');
  }
  // Greenhouse boards: .../<slug>/jobs/<id>  ->  boards-api
  if ((m = url.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i))) {
    const d = await (await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`)).json();
    return strip(d.content || '');
  }
  // Ashby: jobs.ashbyhq.com/<slug>/<id>
  if ((m = url.match(/ashbyhq\.com\/([^/]+)\/([0-9a-f-]+)/i))) {
    const d = await (await fetch(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}`)).json();
    const j = (d.jobs || []).find(x => x.jobUrl?.includes(m[2])) || {};
    return strip(j.descriptionHtml || j.descriptionPlain || '');
  }
  return null;
}

const strip = s =>
  String(s || '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function fromReport(num) {
  const dir = 'reports';
  const pad = String(num).padStart(3, '0');
  const file = readdirSync(dir).find(f => f.startsWith(`${pad}-`) || f.startsWith(`${Number(num)}-`));
  if (!file) throw new Error(`no report found for #${num} in ${dir}/`);
  const txt = readFileSync(path.join(dir, file), 'utf8');
  const title = txt.match(/^#\s*Evaluation:\s*(.+?)\s*[—-]\s*(.+)$/m);
  const url = txt.match(/^\*\*URL:\*\*\s*(\S+)/m);
  return {
    company: title ? title[1].trim() : undefined,
    role: title ? title[2].trim() : undefined,
    url: url ? url[1].trim() : undefined,
  };
}

function selftest() {
  const A = (got, want, msg) => { if (got !== want) throw new Error(`FAIL ${msg}: got ${got}, want ${want}`); };
  A(slugify('Checkout.com'), 'checkout_com', 'dots');
  A(slugify('web developer - Prefr'), 'web_developer_prefr', 'spaces+dash');
  A(slugify('  '), 'x', 'empty->fallback');
  A(`jd_${slugify('CRED')}_${slugify('web developer - Prefr')}.txt`,
    'jd_cred_web_developer_prefr.txt', 'filename');
  console.log('selftest OK');
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const first = process.argv[2];
  if (!first || first.startsWith('--')) {
    console.error('usage: node resgen-bridge.mjs <report#|url> [--company X --role Y] [--jd-file f] [--resgen DIR]');
    process.exit(1);
  }
  const resgenDir = arg('--resgen') || process.env.RESGEN_DIR ||
    path.resolve(process.cwd(), '..', 'resGen');
  if (!existsSync(resgenDir)) throw new Error(`resGen dir not found: ${resgenDir} (pass --resgen)`);

  let company = arg('--company'), role = arg('--role'), url;
  if (/^\d+$/.test(first)) { const r = fromReport(first); company ||= r.company; role ||= r.role; url = r.url; }
  else url = first;
  url = arg('--url') || url;
  if (!company || !role) throw new Error('company/role missing — pass --company and --role (or a report# that has them)');

  const jdFile = arg('--jd-file');
  let body = jdFile ? readFileSync(jdFile, 'utf8') : (url ? await fetchJD(url) : null);
  if (!body) throw new Error(url
    ? `couldn't auto-fetch JD from ${url} — pass --jd-file (only greenhouse/lever/ashby URLs auto-fetch)`
    : 'no URL and no --jd-file — nothing to write');

  const outDir = path.join(resgenDir, 'jds');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `jd_${slugify(company)}_${slugify(role)}.txt`);
  const bar = '='.repeat(70);
  writeFileSync(out,
    `${bar}\nCompany : ${company}\nRole    : ${role}\nSource  : ${url || '(pasted)'}\n` +
    `Captured: ${new Date().toISOString()}\n${bar}\n\n${body.trim()}\n`, 'utf8');
  console.log(`wrote ${out}`);
  console.log(`→ in resGen: tailor res.tex to this JD, then node tools/fit-check.js / compile.js`);
}
main().catch(e => { console.error('resgen-bridge:', e.message); process.exit(1); });
