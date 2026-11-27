// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Notion provider — single-company careers board (→ tracked_companies:).
// Auto-detects a public Notion page on `https://<workspace>.notion.site/...`
// whose URL carries the page id (32 hex chars, the form Notion's share links
// use) and reads the zero-auth JSON endpoints the published page
// itself calls. The official Notion API (api.notion.com) needs an integration
// token AND an explicit share from the page owner, so it cannot read a
// stranger's public page; these same-origin `/api/v3` endpoints are
// undocumented, which is why every response shape is checked and a mismatch
// throws instead of reading as an empty board.
//
//   1. POST https://<workspace>.notion.site/api/v3/loadPageChunk
//      body `{ pageId, limit, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false }`
//      → `{ recordMap: { block, collection?, collection_view? } }`.
//   2. Only when the board is a database:
//      POST https://<workspace>.notion.site/api/v3/queryCollection
//      body `{ source: { type: 'collection', id, spaceId }, collectionView: { id, spaceId }, loader }`
//      → `{ result: { reducerResults: { collection_group_results: { blockIds } } }, recordMap }`.
//
// Careers boards come in two shapes, and both are read:
//   - a database (a `collection_view_page`, or an inline `collection_view`
//     block on the page): one posting per row. The view's own saved filter is
//     sent with the query, so rows the board hides stay hidden. A column named
//     "Location" (select / multi-select / text) fills `location`.
//   - a plain page whose child pages are the postings: one posting per child
//     page, in page order, including pages the board links inline (`‣`) from
//     elsewhere in the workspace and pages inside column / toggle layouts.
//     Location lives in the posting body, so it is empty.
//
// Records arrive in two wrappings, `{ role, value: <block> }` and the newer
// `{ spaceId, value: { role, value: <block> } }`; unwrapRecord reads both.
//
// The posting URL is `https://<workspace>.notion.site/<page-id-hex>`. Notion
// serves a page at its bare id, and the bare id survives a title edit, where
// the `<Title-Slug>-<id>` form Notion links to would not. `postedAt` is the
// page's `created_time`: Notion keeps no separate publish date, and a board
// that recycles one row for a re-opened role will read that row as old.

import { fetchJsonWithRetry } from './_http.mjs';

const HOST_RE = /^[a-z0-9-]+\.notion\.site$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Every id-shaped run in a path, dashed or not; the page id is the last one
// (`/<Title-Slug>-<id>`, `/p/<id>`, `/<id>`).
const PAGE_ID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;

// Blocks loaded with the page. A board's child pages arrive with it, so a
// page with more postings than this is cut short (and warned about).
const PAGE_CHUNK_LIMIT = 100;
// How deep into layout blocks (column_list → column → toggle) postings are
// looked for.
const MAX_LAYOUT_DEPTH = 3;
// Rows read from a database view, in one request.
const ROW_LIMIT = 200;

const RETRY_POLICY = { retries: 2 };
const COLLECTION_TYPES = new Set(['collection_view_page', 'collection_view']);

/** @param {string} raw 32 hex chars, dashed or not → dashed lower-case uuid, or null. */
function toUuid(raw) {
  const hex = raw.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Resolve `{ origin, pageId, viewId }` from a careers_url like
 * `https://acme.notion.site/Careers-0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d?v=<view-id>`.
 * Only the hostname and the id are read from the URL; the origin is rebuilt.
 * Returns null for any other host, a non-https URL, or a path without an id.
 * @param {import('./_types.js').PortalEntry} entry
 */
export function resolvePage(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !HOST_RE.test(parsed.hostname)) return null;
  const ids = parsed.pathname.match(PAGE_ID_RE);
  const pageId = ids ? toUuid(ids[ids.length - 1]) : null;
  if (!pageId) return null;
  const v = parsed.searchParams.get('v');
  return { origin: `https://${parsed.hostname}`, pageId, viewId: v ? toUuid(v) : null };
}

/**
 * Unwrap a recordMap entry to its record, in either wrapping.
 * @param {any} rec
 */
export function unwrapRecord(rec) {
  const v = rec && typeof rec === 'object' ? rec.value : null;
  if (v && typeof v === 'object' && v.value && typeof v.value === 'object' && 'role' in v) return v.value;
  return v && typeof v === 'object' ? v : null;
}

/** @param {any} prop a Notion rich-text property, `[[text, annotations?], ...]` */
function richText(prop) {
  if (!Array.isArray(prop)) return '';
  return prop.map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('').trim();
}

/**
 * Build one Job from a page block, or null when it has no title or a
 * malformed id.
 * @param {any} block
 * @param {{ origin: string, companyName: string, location?: string }} opts
 */
function toJob(block, { origin, companyName, location = '' }) {
  if (!block || typeof block !== 'object' || block.alive === false) return null;
  const title = richText(block.properties?.title);
  if (!title) return null;
  const id = typeof block.id === 'string' && UUID_RE.test(block.id) ? block.id.replace(/-/g, '') : null;
  if (!id) return null;
  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url: `${origin}/${id}`, company: companyName, location };
  if (Number.isFinite(block.created_time) && block.created_time > 0) job.postedAt = block.created_time;
  return job;
}

/**
 * Read the `loadPageChunk` response. Exported for unit tests.
 * Returns the root block plus, for a plain page, its child-page postings; for a
 * database, `collection` names what to query instead.
 *
 * @param {any} json
 * @param {{ pageId: string, viewId: string | null, origin: string, companyName: string }} opts
 * @returns {{ jobs: any[], collection: null | { collectionId: string, viewId: string, spaceId: string, view: any }, missing: number }}
 */
export function parsePageChunk(json, { pageId, viewId, origin, companyName }) {
  const blocks = json?.recordMap?.block;
  if (!blocks || typeof blocks !== 'object') {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`notion: unexpected loadPageChunk response — expected recordMap.block, got: [${got}]`);
  }
  const root = unwrapRecord(blocks[pageId]);
  if (!root) throw new Error(`notion: page ${pageId} is not in the response — not public, or the id is wrong`);

  const content = Array.isArray(root.content) ? root.content : [];
  const dbBlock = COLLECTION_TYPES.has(root.type)
    ? root
    : content.map((id) => unwrapRecord(blocks[id])).find((b) => b && COLLECTION_TYPES.has(b.type));

  if (dbBlock) {
    const collectionId = dbBlock.collection_id ?? dbBlock.format?.collection_pointer?.id;
    const viewIds = Array.isArray(dbBlock.view_ids) ? dbBlock.view_ids : [];
    const chosenView = viewId && viewIds.includes(viewId) ? viewId : viewIds[0];
    const spaceId = dbBlock.space_id ?? blocks[pageId]?.spaceId;
    if (typeof collectionId !== 'string' || typeof chosenView !== 'string' || typeof spaceId !== 'string') {
      throw new Error(`notion: database block ${dbBlock.id} has no collection_id / view_ids / space_id`);
    }
    const view = unwrapRecord(json.recordMap.collection_view?.[chosenView]);
    // Without the view record its saved filter is unknown, and querying
    // unfiltered would surface the rows the board hides.
    if (!view) throw new Error(`notion: view ${chosenView} of database ${dbBlock.id} is not in the response — cannot apply its filter`);
    return { jobs: [], collection: { collectionId, viewId: chosenView, spaceId, view }, missing: 0 };
  }

  if (root.type !== 'page') throw new Error(`notion: page ${pageId} is a "${root.type}" block, not a page or database`);
  // Walk the page in reading order: child pages, "link to page" (`alias`)
  // blocks, pages linked inline from a text block, and all of them inside
  // layout blocks (columns, toggles), but never into a posting itself.
  const jobs = [];
  const seen = new Set();
  let missing = 0;
  const addPage = (block) => {
    if (block?.type !== 'page' || seen.has(block.id)) return;
    seen.add(block.id);
    const job = toJob(block, { origin, companyName });
    if (job) jobs.push(job);
  };
  const walk = (ids, depth) => {
    for (const id of ids) {
      const rec = blocks[id];
      if (!rec) { missing++; continue; }
      const block = unwrapRecord(rec);
      if (!block || block.alive === false) continue;
      if (block.type === 'page') { addPage(block); continue; }
      if (block.type === 'alias') { addPage(unwrapRecord(blocks[block.format?.alias_pointer?.id])); continue; }
      for (const id2 of mentionedPageIds(block.properties?.title)) addPage(unwrapRecord(blocks[id2]));
      if (depth < MAX_LAYOUT_DEPTH && Array.isArray(block.content)) walk(block.content, depth + 1);
    }
  };
  walk(content, 0);
  return { jobs, collection: null, missing };
}

/**
 * Page ids mentioned inline in a rich-text property: a `‣` segment annotated
 * `['p', <page-id>, <space-id>?]`.
 * @param {any} prop
 * @returns {string[]}
 */
function mentionedPageIds(prop) {
  if (!Array.isArray(prop)) return [];
  const ids = [];
  for (const seg of prop) {
    const annotations = Array.isArray(seg) && Array.isArray(seg[1]) ? seg[1] : [];
    for (const a of annotations) {
      if (Array.isArray(a) && a[0] === 'p' && typeof a[1] === 'string') ids.push(a[1]);
    }
  }
  return ids;
}

/**
 * Read the `queryCollection` response: one posting per row, in view order.
 * Exported for unit tests.
 * @param {any} json
 * @param {{ collectionId: string, origin: string, companyName: string }} opts
 * @returns {{ jobs: any[], rawCount: number }}
 */
export function parseCollectionRows(json, { collectionId, origin, companyName }) {
  const blockIds = json?.result?.reducerResults?.collection_group_results?.blockIds;
  if (!Array.isArray(blockIds)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`notion: unexpected queryCollection response — expected result.reducerResults.collection_group_results.blockIds[], got: [${got}]`);
  }
  const blocks = json.recordMap?.block ?? {};
  const schema = unwrapRecord(json.recordMap?.collection?.[collectionId])?.schema ?? {};
  const locationKey = Object.keys(schema).find((k) => /^locations?$/i.test(String(schema[k]?.name ?? '').trim()));
  // A multi-select stores its options as one comma-joined string.
  const multi = locationKey && schema[locationKey]?.type === 'multi_select';

  const jobs = [];
  for (const id of blockIds) {
    const block = unwrapRecord(blocks[id]);
    const raw = locationKey ? richText(block?.properties?.[locationKey]) : '';
    const location = multi ? raw.split(',').map((s) => s.trim()).filter(Boolean).join(' · ') : raw;
    const job = toJob(block, { origin, companyName, location });
    if (job) jobs.push(job);
  }
  return { jobs, rawCount: blockIds.length };
}

/** @type {Provider} */
export default {
  id: 'notion',

  detect(entry) {
    const page = resolvePage(entry);
    return page ? { url: `${page.origin}/api/v3/loadPageChunk` } : null;
  },

  /**
   * @param {{ name?: string, careers_url?: string }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, sleep?: (ms: number) => Promise<void> }} ctx
   */
  async fetch(entry, ctx) {
    const page = resolvePage(entry);
    if (!page) throw new Error(`notion: cannot derive a page id from careers_url for ${entry.name}`);
    const { origin, pageId, viewId } = page;
    const companyName = entry.name || new URL(origin).hostname.split('.')[0];
    const post = (path, body) => fetchJsonWithRetry(ctx, `${origin}/api/v3/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
    }, RETRY_POLICY);

    const chunk = await post('loadPageChunk', {
      pageId, limit: PAGE_CHUNK_LIMIT, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false,
    });
    const { jobs, collection, missing } = parsePageChunk(chunk, { pageId, viewId, origin, companyName });
    if (missing > 0) {
      console.error(`⚠️  notion: ${entry.name} — ${missing} child block(s) past the first ${PAGE_CHUNK_LIMIT} were not loaded; postings among them are missing`);
    }
    if (!collection) return jobs;

    const { collectionId, spaceId, view } = collection;
    const filter = view?.query2?.filter;
    const result = await post('queryCollection?src=initial_load', {
      source: { type: 'collection', id: collectionId, spaceId },
      collectionView: { id: collection.viewId, spaceId },
      loader: {
        type: 'reducer',
        reducers: { collection_group_results: { type: 'results', limit: ROW_LIMIT } },
        sort: Array.isArray(view?.query2?.sort) ? view.query2.sort : [],
        ...(filter && typeof filter === 'object' ? { filter } : {}),
        searchQuery: '',
        userTimeZone: 'UTC',
      },
    });
    const { jobs: rows, rawCount } = parseCollectionRows(result, { collectionId, origin, companyName });
    if (rawCount >= ROW_LIMIT) {
      console.error(`⚠️  notion: ${entry.name} returned ${ROW_LIMIT} rows, the per-board cap; later rows were not read`);
    }
    return rows;
  },
};
