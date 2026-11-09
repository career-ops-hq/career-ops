// tests/scan-ats-full-join-source.test.mjs — the join.com directory source:
// its SOURCES entry, and loadCompanyList() reading a non-JSON dataset through
// the source's parseDataset hook.
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — join.com directory source');

const { SOURCES, loadCompanyList, withIdCache } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { default: joinProvider, parseCompanySitemap } = await import(pathToFileURL(join(ROOT, 'providers/join.mjs')).href);

// The SOURCES entry.
{
  const src = SOURCES.join;
  if (src && src.provider === joinProvider && src.parseDataset === parseCompanySitemap && src.dataset === 'https://join.com/companies/sitemap.xml') {
    pass('SOURCES.join reads join.com\'s company sitemap through the join provider\'s parser');
  } else {
    fail(`SOURCES.join wrong: ${JSON.stringify(src && { dataset: src.dataset, provider: src.provider?.id })}`);
  }
  if (src?.concurrency === 2 && src.singleHost === true) pass('SOURCES.join runs two boards at a time on one shared host');
  else fail(`SOURCES.join pacing wrong: concurrency=${src?.concurrency}, singleHost=${src?.singleHost}`);

  const e = src?.toEntry('acme-corp');
  if (e?.careers_url === 'https://join.com/companies/acme-corp' && e.name === 'acme-corp' && joinProvider.detect(e)) {
    pass('SOURCES.join.toEntry() builds a careers_url the join provider claims');
  } else {
    fail(`SOURCES.join.toEntry() wrong: ${JSON.stringify(e)}`);
  }
  if (src?.toEntry('evil/..%2f') === null && src?.toEntry('') === null) pass('SOURCES.join.toEntry() rejects non-slug input');
  else fail('SOURCES.join.toEntry() accepted a hostile slug');
}

// withIdCache() — the seed passes hand each provider its own slice of the id cache.
{
  const asked = [];
  const store = { forProvider: (id) => { asked.push(id); return { slice: id }; } };
  const ctx = { fetchText: () => {} };
  const withStore = withIdCache(ctx, store, { id: 'join' });
  const without = withIdCache(ctx, undefined, { id: 'join' });
  if (withStore.idCache?.slice === 'join' && withStore.fetchText === ctx.fetchText && !('idCache' in ctx) && asked.join() === 'join' && without === ctx) {
    pass('withIdCache() adds the provider\'s own slice as ctx.idCache, and leaves ctx as is without a store');
  } else {
    fail(`withIdCache() wrong: ${JSON.stringify({ withStore: withStore.idCache, same: without === ctx, asked })}`);
  }
}

// loadCompanyList() with parseDataset: the text is parsed, and the cache holds the array.
const cacheDir = mkdtempSync(join(tmpdir(), 'career-ops-ats-companies-'));
try {
  const sitemap = '<urlset><url><loc>https://join.com/companies/acme-corp</loc></url><url><loc>https://join.com/companies/bigco</loc></url></urlset>';
  let textCalls = 0;
  let jsonCalls = 0;
  const io = {
    cacheDir,
    fetchTextFn: async () => { textCalls++; return sitemap; },
    fetchJsonFn: async () => { jsonCalls++; return ['wrong']; },
  };
  const first = await loadCompanyList('join', SOURCES.join.dataset, SOURCES.join.parseDataset, io);
  const cached = JSON.parse(readFileSync(join(cacheDir, 'join.json'), 'utf8'));
  if (first.status === 'ok' && JSON.stringify(first.list) === '["acme-corp","bigco"]' && JSON.stringify(cached) === '["acme-corp","bigco"]' && textCalls === 1 && jsonCalls === 0) {
    pass('loadCompanyList() reads a parseDataset source as text and caches the parsed array');
  } else {
    fail(`loadCompanyList() parse path wrong: ${JSON.stringify({ first, cached, textCalls, jsonCalls })}`);
  }

  const second = await loadCompanyList('join', SOURCES.join.dataset, SOURCES.join.parseDataset, io);
  if (second.status === 'ok' && second.list.length === 2 && textCalls === 1) pass('loadCompanyList() serves a parsed dataset from the cache within the TTL');
  else fail(`loadCompanyList() cache hit wrong: status=${second.status}, textCalls=${textCalls}`);

  // An expired cache and a download that does not parse fall back to the stale list.
  const expired = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
  utimesSync(join(cacheDir, 'join.json'), expired, expired);
  const realError = console.error;
  console.error = () => {};
  let third;
  try {
    third = await loadCompanyList('join', SOURCES.join.dataset, SOURCES.join.parseDataset, {
      ...io,
      fetchTextFn: async () => '<html>Attention Required</html>',
    });
  } finally {
    console.error = realError;
  }
  if (third.status === 'stale' && third.list.length === 2) pass('loadCompanyList() keeps the stale list when the fresh dataset does not parse');
  else fail(`loadCompanyList() stale fallback wrong: ${JSON.stringify(third)}`);

  // A source without parseDataset still reads JSON.
  const plain = await loadCompanyList('acmeats', 'https://example.com/acmeats.json', undefined, {
    cacheDir,
    fetchTextFn: async () => { throw new Error('should not be called'); },
    fetchJsonFn: async () => ['exampleco'],
  });
  if (plain.status === 'ok' && plain.list[0] === 'exampleco' && existsSync(join(cacheDir, 'acmeats.json'))) {
    pass('loadCompanyList() still reads a source without parseDataset as JSON');
  } else {
    fail(`loadCompanyList() JSON path wrong: ${JSON.stringify(plain)}`);
  }
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
