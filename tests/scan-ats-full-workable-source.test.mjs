// tests/scan-ats-full-workable-source.test.mjs — the Workable source: no
// company directory, one board per employer built from Workable's XML feed.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — Workable feed source');

const { SOURCES, loadSourceList, providerForSource, parseArgs } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { WORKABLE_FEED_URL } = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);

const check = (ok, label, detail) => (ok ? pass(label) : fail(detail ? `${label} — ${detail}` : label));
const src = SOURCES.workable;

check(src && src.dataset === WORKABLE_FEED_URL && typeof src.loadDataset === 'function' && src.restartOnResume === true && src.singleHost === true,
  'SOURCES.workable reads the feed itself, restarts on resume and shares one host');
check(src?.provider?.id === 'workable-feed' && providerForSource('workable-full') === src.provider, 'its provider is resolvable from the source name recorded in scan history');
check(parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'workable']).ats.join() === 'workable', '--ats workable is accepted');

{
  const jobs = [{ title: 'QA Engineer', url: 'https://apply.workable.com/j/QA1' }];
  const entry = src.toEntry({ company: 'Acme GmbH', website: 'https://acme.example', jobs });
  check(entry?.name === 'Acme GmbH' && entry.website === 'https://acme.example' && entry.jobs === jobs && !('careers_url' in entry), 'toEntry() makes a board named after the employer, its postings attached');
  check(src.toEntry({ company: '', jobs }) === null && src.toEntry(null) === null, 'toEntry() rejects a row with no employer');
  const fetched = await src.provider.fetch(entry, {});
  check(fetched === jobs, "the source's fetch hands the attached postings back without a request");
  check((await src.provider.fetch({ name: 'x' }, {})).length === 0, 'a board with no postings attached fetches as empty');
}

{
  const seen = [];
  const fake = { ...src, loadDataset: async (opts) => { seen.push(opts); return [{ company: 'Acme GmbH', jobs: [] }]; } };
  const titleFilter = () => true;
  const res = await loadSourceList('workable', fake, { cutoff: 123, includeUndated: false, titleFilter }, {
    loadCompanyListFn: async () => { throw new Error('a feed source must not download a directory'); },
  });
  check(res.status === 'ok' && res.list.length === 1 && seen[0].cutoff === 123 && seen[0].titleFilter === titleFilter,
    "loadSourceList() builds a feed source's list from the sweep's window and title filter");

  const realError = console.error;
  const warnings = [];
  console.error = (m) => warnings.push(String(m));
  let failed;
  try {
    failed = await loadSourceList('workable', { ...src, loadDataset: async () => { throw new Error('HTTP 503'); } }, {});
  } finally {
    console.error = realError;
  }
  check(failed.status === 'empty' && failed.list.length === 0 && warnings.some((w) => w.includes('workable') && w.includes('HTTP 503')),
    'a feed that cannot be read is an empty source, with a warning naming it');

  const directory = await loadSourceList('join', SOURCES.join, {}, { loadCompanyListFn: async (name, url, parse) => ({ list: [name, url, parse === SOURCES.join.parseDataset], status: 'ok' }) });
  check(directory.list[0] === 'join' && directory.list[1] === SOURCES.join.dataset && directory.list[2] === true, 'every other source still downloads its directory through loadCompanyList');
}
