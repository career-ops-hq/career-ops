// @ts-check
// Notion API helper for the notion plugin. Ported from the notion-lib.mjs
// contributed by @pcomans in #959 (with thanks), reshaped for the plugin layer:
//
//  - No module-level secrets / `import 'dotenv/config'`. The token + parent page
//    id are passed into createNotionClient() from the plugin's scoped ctx.env,
//    so nothing reads process.env at import time and the engine stays the place
//    that decides when .env is loaded.
//  - templates/states.yml (the canonical status source of truth) is resolved
//    from the repo root, two levels up from this bundled plugin.
//
// Pages use Notion's native markdown on both sides. The 360ms inter-request
// sleep keeps us under ~3 req/s. DB resolution is by NAME so no workspace id is
// ever embedded. Files prefixed with _ are never discovered as plugins.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const DIR = dirname(fileURLToPath(import.meta.url));
const STATES_PATH = join(DIR, '..', '..', 'templates', 'states.yml');
const MAX = 1900; // safety margin under Notion's 2000-char rich_text limit

// ── canonical states (templates/states.yml is the source of truth) ──────────
let _states;
function loadStates() {
  if (_states) return _states;
  const doc = yaml.load(readFileSync(STATES_PATH, 'utf-8'));
  const labels = [], aliasMap = {};
  for (const s of doc.states) {
    labels.push(s.label);
    aliasMap[s.label.toLowerCase()] = s.label;
    for (const a of (s.aliases || [])) aliasMap[String(a).toLowerCase()] = s.label;
  }
  _states = { labels, aliasMap };
  return _states;
}
/** Canonical label for a status (case-insensitive, alias-aware), or null. */
export function canonicalStatus(raw) {
  if (!raw) return null;
  const key = String(raw).replace(/\*\*/g, '').trim().toLowerCase();
  return loadStates().aliasMap[key] || null;
}
export function statusLabels() { return loadStates().labels.slice(); }

// ── text → rich_text for property values (chunk-safe under the 2000-char limit) ──
export function rich(text) {
  const str = String(text ?? '');
  const out = [];
  for (let i = 0; i < str.length || out.length === 0; i += MAX) out.push({ type: 'text', text: { content: str.slice(i, i + MAX) } });
  return out;
}

export function plain(prop) {
  return (prop?.title || prop?.rich_text || []).map((t) => t.plain_text).join('');
}

/**
 * Build a Notion client bound to one user's token + parent page. Network goes
 * through the injected `fetchFn` (the plugin passes ctx.fetch so the engine's
 * allowedHosts/HTTPS/redirect guard applies); falls back to global fetch for
 * standalone use. Nothing here reads process.env.
 * @param {{ token: string, parent: string, fetch?: Function }} cfg
 */
export function createNotionClient({ token, parent, fetch: fetchFn = globalThis.fetch }) {
  if (!token) throw new Error('NOTION_ACCESS_TOKEN is not set (.env) — the Notion plugin needs it to read/write.');
  const HEADERS = { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, method, body) {
    await sleep(360); // ~3 req/s
    // ctx.fetch throws on non-2xx (its message carries the body); the !r.ok
    // branch below is the fallback when a plain global fetch is injected.
    const r = await fetchFn(`https://api.notion.com/v1/${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`Notion ${method} ${path} -> ${j.code}: ${j.message}`);
    return j;
  }

  /** Create a page in a data source. `markdown` (optional) becomes the page body. */
  async function createPage(dataSourceId, properties, markdown) {
    const body = { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties };
    if (markdown) body.markdown = markdown;
    return api('pages', 'POST', body);
  }

  /** Map of DB name → primary data source id for every DB under the parent page. */
  async function resolveDBs() {
    if (!parent) throw new Error('Set NOTION_PARENT_PAGE_ID in .env (the "Career Ops" parent page id).');
    const out = {};
    let cursor;
    do {
      const j = await api(`blocks/${parent}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, 'GET');
      for (const b of j.results) {
        if (b.type !== 'child_database') continue;
        const db = await api(`databases/${b.id}`, 'GET');
        out[b.child_database.title] = db.data_sources?.[0]?.id;
      }
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);
    return out;
  }

  async function queryDB(dataSourceId) {
    let cursor, all = [];
    do {
      const j = await api(`data_sources/${dataSourceId}/query`, 'POST', { page_size: 100, start_cursor: cursor });
      all.push(...j.results);
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);
    return all;
  }

  function summarize(r) {
    return {
      id: r.id,
      company: plain(r.properties.Company),
      role: plain(r.properties.Role),
      status: r.properties.Status?.select?.name || '',
      score: r.properties.Score?.number ?? null,
      jobUrl: r.properties.URL?.url || '',
      url: r.url,
    };
  }

  /** Match against "<company> / <role>" (substring, case-insensitive) or exact company. */
  async function findRecords(dataSourceId, match) {
    const m = String(match).toLowerCase().trim();
    return (await queryDB(dataSourceId)).map(summarize).filter((r) => {
      const hay = `${r.company} / ${r.role}`.toLowerCase();
      return hay.includes(m) || r.company.toLowerCase() === m;
    });
  }

  return { api, createPage, resolveDBs, queryDB, findRecords };
}
