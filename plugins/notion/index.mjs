// @ts-check
// ── Reference seed ── This bundled plugin is a stable, reviewed example. To
// extend it, publish career-ops-plugin-<id> with "supersedesBundled": true and
// your version takes precedence once installed (see docs/PLUGINS.md). Bundled
// seeds take only security/compat fixes — feature work happens in the successor repo.
//
// Notion plugin — mirror your tracker to a Notion database (export) and read
// records back as job leads (search).
//
// Built on the Notion backend contributed by @pcomans in #959 (with thanks),
// reshaped per the plugin contract. The decisive change: Notion is an OPT-IN
// MIRROR, not a replacement backend. data/applications.md stays the canonical
// source of truth (the web reads it); `export` pushes a read-only snapshot of it
// to the user's own Notion DB. The core never writes to Notion as primary, and
// modes are not edited — this lives entirely behind `node plugins.mjs run notion`.
//
// Setup: a "Career Ops" parent page in Notion containing an "Applications" DB
// with Company / Role / Status / Score / URL properties, shared with your
// internal integration. Enable in config/plugins.yml; keys in .env.
//
//   node plugins.mjs run notion export            # mirror tracker → Notion
//   node plugins.mjs run notion search "platform" # read matching records → pipeline

import { createNotionClient, rich, canonicalStatus } from './_notion.mjs';

function clientFromCtx(ctx) {
  return createNotionClient({
    token: ctx?.env?.NOTION_ACCESS_TOKEN,
    parent: ctx?.env?.NOTION_PARENT_PAGE_ID,
    fetch: ctx?.fetch, // route through the engine's allowedHosts/redirect guard
  });
}

async function applicationsDb(client) {
  const dbs = await client.resolveDBs();
  const apps = dbs['Applications'];
  if (!apps) throw new Error('No "Applications" database found under the Career Ops page — create it and share the integration with it.');
  return apps;
}

/**
 * Parse a tracker score cell into a numeric value for the Notion DB Score property.
 *
 * Scores in applications.md may be formatted like `4.2/5`, `**4.2/5**`, `4.25`, etc.
 * Strips formatting and extracts the first numeric value so slash-formatted
 * scores (e.g. 4.2/5) are not mangled into 4.25 (#1414).
 *
 * @param {unknown} s - Raw score value from tracker row.
 * @returns {number} Parsed score, or NaN if no valid number is present.
 */
export function parseScore(s) {
  const m = String(s ?? '').replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
}

export default {
  parseScore,

  /**
   * export: upsert each tracker row into the user's Notion Applications DB.
   * Receives a frozen read-only snapshot of the tracker — never a file handle.
   * @param {{ applications: Array<Record<string,string>> }} snapshot
   * @param {any} ctx
   */
  async export(snapshot, ctx) {
    const rows = Array.isArray(snapshot?.applications) ? snapshot.applications : [];
    if (rows.length === 0) return { pushed: 0 };
    const client = clientFromCtx(ctx);
    const apps = await applicationsDb(client);

    let pushed = 0;
    for (const row of rows) {
      const company = (row.company || '').trim();
      const role = (row.role || '').trim();
      if (!company || !role) continue;

      const props = { Role: { title: rich(role) }, Company: { rich_text: rich(company) } };
      const status = canonicalStatus(row.status);
      if (status) props.Status = { select: { name: status } };
      const score = parseScore(row.score);
      if (Number.isFinite(score)) props.Score = { number: score };

      if (ctx?.dryRun) { ctx.log(`would push: ${company} — ${role}`); pushed++; continue; }

      // Upsert: update an existing company+role record, else create one.
      const dupes = (await client.findRecords(apps, `${company} / ${role}`))
        .filter((h) => h.company.toLowerCase() === company.toLowerCase() && h.role.toLowerCase() === role.toLowerCase());
      if (dupes.length) await client.api(`pages/${dupes[0].id}`, 'PATCH', { properties: props });
      else await client.createPage(apps, props);
      pushed++;
    }
    return { pushed };
  },

  /**
   * search: return Notion records matching a query as Job[]. Only records that
   * carry a job posting in a `URL` property are returned (e.g. a postings DB, or
   * leads you added in Notion). Note: `export` mirrors the tracker (company/role/
   * status/score) and does NOT set a job URL, so export-created rows are not
   * round-tripped by search — that's intentional, they already live in your
   * tracker. The engine writes any results to the pipeline canonically.
   * @param {string} query
   * @param {any} ctx
   */
  async search(query, ctx) {
    const client = clientFromCtx(ctx);
    const apps = await applicationsDb(client);
    const hits = await client.findRecords(apps, query);
    return hits
      .filter((h) => h.jobUrl && /^https?:\/\//i.test(h.jobUrl))
      .map((h) => ({ title: h.role || 'Notion record', url: h.jobUrl, company: h.company || '', location: '' }));
  },
};
