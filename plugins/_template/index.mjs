// @ts-check
// {{NAME}} — a career-ops plugin.
// Guide: https://github.com/santifer/career-ops/blob/main/docs/PLUGINS.md
//
// Rules the engine enforces for you:
//  - Egress ONLY through ctx.fetch / ctx.fetchJson / ctx.fetchText (your manifest
//    `allowedHosts` is applied + SSRF-guarded). Do NOT import node:http/net or
//    call global fetch — community plugins are rejected for that.
//  - Producers (provider/ingest/search) RETURN Job[] = { title, url, company, location };
//    the engine writes them to the pipeline. Consumers (export/notify) push to
//    the user's own store. There is no auto-submit hook.
//  - Keys come from ctx.env (declare them in manifest.requiredEnv); non-secret
//    settings come from ctx.settings (the user's config/plugins.yml block).

export default {
  // Replace/add hooks to match manifest.hooks. Example ingest:
  async ingest(ctx) {
    // const data = await ctx.fetchJson('https://api.example.com/jobs');
    // return data.results.map(j => ({ title: j.title, url: j.url, company: j.company, location: j.location || '' }));
    return [];
  },
};
