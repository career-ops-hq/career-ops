#!/usr/bin/env node

/**
 * Offline parser for GO Jobs result pages saved from a normal browser session.
 * It intentionally performs no network requests and never automates the site's
 * interactive Radware challenge.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ORIGIN = 'https://www.gojobs.gov.on.ca';
const CAPTCHA = ['radware captcha page', 'botmanager_support', 'validate.perfdrive.com'];

function decodeEntities(value) {
  const named = new Map([['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['nbsp', ' '], ['quot', '"']]);
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named.get(entity.toLowerCase()) ?? match;
    const hex = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function textContent(value) {
  return decodeEntities(String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : '';
}

function contentField(html, rowPrefix, field) {
  const escaped = rowPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<span\\b[^>]*id=["']${escaped}_${field}Content["'][^>]*>([\\s\\S]*?)<\\/span>`, 'i'));
  return textContent(match?.[1]);
}

function canonicalJob(rawHref) {
  let url;
  try { url = new URL(rawHref, `${ORIGIN}/Search.aspx`); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'www.gojobs.gov.on.ca' || url.pathname.toLowerCase() !== '/preview.aspx') return null;
  const jobId = url.searchParams.get('JobID') || url.searchParams.get('jobid');
  if (!/^\d+$/.test(jobId || '')) return null;
  return { jobId, url: `${ORIGIN}/Preview.aspx?JobID=${jobId}&Language=English` };
}

export function parseSavedHtml(html, source = 'saved HTML') {
  const lower = String(html).toLowerCase();
  if (CAPTCHA.some(marker => lower.includes(marker))) throw new Error(`${source}: saved page is a Radware challenge, not GO Jobs results`);

  const jobs = [];
  for (const match of String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const href = attribute(tag, 'href');
    if (!/preview\.aspx/i.test(href)) continue;
    const canonical = canonicalJob(href);
    if (!canonical) continue;
    const id = attribute(tag, 'id');
    if (/lnkJobTitleFR$/i.test(id) || /(?:\?|&)Language=French(?:&|$)/i.test(href)) continue;
    const rowPrefix = id.replace(/_lnkJobTitle(?:EN|FR)?$/i, '');
    if (!/_rptSearchResult_/i.test(rowPrefix)) continue;
    const title = textContent(tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '')).replace(/\s+\(\d+\)$/, '').trim();
    if (!title) continue;
    jobs.push({
      title,
      url: canonical.url,
      company: contentField(html, rowPrefix, 'lblOrganization') || 'Ontario Public Service',
      location: contentField(html, rowPrefix, 'lblLocation'),
      closingDate: contentField(html, rowPrefix, 'lblCloseDate'),
      jobId: canonical.jobId,
    });
  }
  if (jobs.length === 0) throw new Error(`${source}: no GO Jobs result rows found; save the rendered results page, not the search form`);
  return jobs;
}

function inputFiles(paths) {
  const canonicalize = realpathSync.native ?? realpathSync;
  const root = canonicalize(getCareerOpsRoot());
  const files = [];
  for (const rawPath of paths) {
    const candidate = resolve(root, rawPath);
    if (!existsSync(candidate)) throw new Error(`input does not exist: ${rawPath}`);
    const path = canonicalize(candidate);
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`input is outside the career-ops data root: ${rawPath}`);
    }
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) if (['.html', '.htm'].includes(extname(name).toLowerCase())) files.push(join(path, name));
    } else files.push(path);
  }
  if (files.length === 0) throw new Error('no .html/.htm input files found');
  return files;
}

export function parseFiles(paths) {
  const byUrl = new Map();
  for (const path of inputFiles(paths)) {
    for (const job of parseSavedHtml(readFileSync(path, 'utf8'), path)) byUrl.set(job.url, job);
  }
  return [...byUrl.values()];
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0 || paths.includes('--help')) {
    console.log('Usage: node parse-gojobs-html.mjs <saved-results.html|directory> [...]');
    process.exitCode = paths.includes('--help') ? 0 : 1;
    return;
  }
  try { console.log(JSON.stringify({ jobs: parseFiles(paths) }, null, 2)); }
  catch (error) { console.error(`GO Jobs parser: ${error.message}`); process.exitCode = 1; }
}

if (isMainModule(import.meta.url)) main();
