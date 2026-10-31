// tests/scan-entry-response-cap.test.mjs — a portals.yml entry's max_response_mb
// sets the response body cap for that entry's fetches.
import { pass, fail } from './helpers.mjs';
import { applyEntryResponseCap } from '../scan.mjs';

console.log('\nscan — per-entry max_response_mb');

const MB = 1024 * 1024;

// A ctx whose fetch methods record the options they were called with.
function recordingCtx() {
  const calls = [];
  const record = (method) => async (url, opts = {}) => { calls.push({ method, url, opts }); return method; };
  return { calls, ctx: { fetchJson: record('fetchJson'), fetchText: record('fetchText'), fetchResponse: record('fetchResponse') } };
}

try {
  {
    const { ctx } = recordingCtx();
    const before = { ...ctx };
    applyEntryResponseCap(ctx, { name: 'Acme' });
    if (ctx.fetchJson === before.fetchJson && ctx.fetchText === before.fetchText && ctx.fetchResponse === before.fetchResponse) pass('an entry without max_response_mb leaves the ctx as it is');
    else fail('an entry without max_response_mb changed the ctx');
  }

  {
    const { ctx, calls } = recordingCtx();
    applyEntryResponseCap(ctx, { name: 'BigCo', max_response_mb: 20 });
    await ctx.fetchJson('https://example.com/a', { redirect: 'error', timeoutMs: 30_000 });
    await ctx.fetchText('https://example.com/b');
    const [json, text] = calls;
    if (json.opts.maxBytes === 20 * MB && json.opts.redirect === 'error' && json.opts.timeoutMs === 30_000 && text.opts.maxBytes === 20 * MB) {
      pass('max_response_mb sets maxBytes on fetchJson and fetchText and keeps the other options');
    } else {
      fail(`max_response_mb not applied: ${JSON.stringify(calls.map((c) => c.opts))}`);
    }
  }

  {
    const { ctx, calls } = recordingCtx();
    applyEntryResponseCap(ctx, { name: 'BigCo', max_response_mb: 64 });
    await ctx.fetchJson('https://example.com/a', { maxBytes: 5 * MB });
    if (calls[0].opts.maxBytes === 64 * MB) pass('the entry value wins over a maxBytes the provider passes');
    else fail(`provider maxBytes won over the entry value: ${calls[0].opts.maxBytes}`);
  }

  {
    const { ctx, calls } = recordingCtx();
    applyEntryResponseCap(ctx, { name: 'BigCo', max_response_mb: 20 });
    await ctx.fetchResponse('https://example.com/c', { redirect: 'manual' });
    if (calls[0].opts.maxBytes === 20 * MB && calls[0].opts.redirect === 'manual') pass('max_response_mb sets maxBytes on fetchResponse too, which reads the body under the same cap');
    else fail(`fetchResponse did not get the entry cap: ${JSON.stringify(calls[0].opts)}`);
  }

  {
    const realError = console.error;
    const warnings = [];
    console.error = (msg) => { warnings.push(String(msg)); };
    // Not a YAML number (Number() would turn true into 1 MiB and [20] into
    // 20 MiB), or a number that floors to 0 bytes or overflows to Infinity.
    const bads = [0, -5, 'big', '20', true, [20], Number.NaN, 1e-9, 1e303];
    let unchanged = 0;
    try {
      for (const bad of bads) {
        const { ctx } = recordingCtx();
        const before = ctx.fetchJson;
        applyEntryResponseCap(ctx, { name: 'BadCo', max_response_mb: bad });
        if (ctx.fetchJson === before) unchanged++;
      }
    } finally {
      console.error = realError;
    }
    if (unchanged === bads.length && warnings.length === bads.length && warnings.every((w) => w.includes('BadCo') && w.includes('max_response_mb'))) {
      pass('a max_response_mb that is not a positive YAML number of at least one byte is ignored with a warning naming the entry');
    } else {
      fail(`bad values: unchanged=${unchanged}, warnings=${JSON.stringify(warnings)}`);
    }
  }
} catch (e) {
  fail(`scan per-entry max_response_mb tests crashed: ${e.message}`);
}
