// tests/scan-ats-full-live-offer.test.mjs — `--json` live-offer stderr lines.
// Explore paints cards from these while the sweep is still walking. stdout
// stays the single summary object (#1199).
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — live offer stderr JSON (--json streaming)');

const {
  formatLiveOfferLine,
  parseLiveOfferLine,
  emitLiveOffer,
  filterBlacklistedOffers,
  keepAndMaybeEmit,
} = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

const job = {
  company: 'Acme',
  title: 'Staff Engineer',
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  location: 'Remote',
  postedAt: Date.parse('2026-09-01T00:00:00Z'),
};

{
  const line = formatLiveOfferLine(job, 'greenhouse-full');
  const parsed = parseLiveOfferLine(`  10/150 scanned, 1 total matches\r${line}`);
  const junk = parseLiveOfferLine('  10/150 scanned, 1 total matches');
  if (
    parsed?.kind === 'offer'
    && parsed.url === job.url
    && parsed.company === 'Acme'
    && parsed.title === 'Staff Engineer'
    && parsed.postedAt === '2026-09-01'
    && parsed.source === 'greenhouse-full'
    && junk === null
  ) {
    pass('live-offer line parses; progress ticks are ignored; \\r glue is tolerated');
  } else {
    fail(`live-offer parse: ${JSON.stringify({ parsed, junk })}`);
  }
}

{
  const chunks = [];
  const orig = console.error;
  console.error = (...a) => { chunks.push(a.join(' ')); };
  try {
    emitLiveOffer(job, 'greenhouse-full', { json: true });
    emitLiveOffer(job, 'greenhouse-full', { json: false });
    emitLiveOffer({ title: 'No URL' }, 'greenhouse-full', { json: true });
  } finally {
    console.error = orig;
  }
  if (chunks.length === 1 && chunks[0].includes('"kind":"offer"') && chunks[0].includes(job.url)) {
    pass('emitLiveOffer writes one stderr JSON line only in --json mode');
  } else {
    fail(`emitLiveOffer stderr: ${JSON.stringify(chunks)}`);
  }
}

{
  const blacklist = new Map([['acmecorp', { reason: 'skip' }]]);
  const live = filterBlacklistedOffers(
    [{ company: 'Acme Corp.', title: job.title, url: job.url, source: 'greenhouse-full' }],
    blacklist,
    { includeBlacklisted: false },
  );
  if (live.offers.length === 0 && live.filteredBlacklist === 1) {
    pass('blacklist still drops a match before a live emit would fire');
  } else {
    fail(`blacklist gate: ${JSON.stringify(live)}`);
  }
}

function captureStderr(fn) {
  const chunks = [];
  const orig = console.error;
  console.error = (...a) => { chunks.push(a.join(' ')); };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return chunks;
}

{
  const sink = [];
  const chunks = captureStderr(() => {
    keepAndMaybeEmit(job, 'greenhouse-full', sink, new Map(), { json: true });
  });
  const kept = sink[0];
  const parsed = parseLiveOfferLine(chunks[0] || '');
  if (
    sink.length === 1
    && kept?.source === 'greenhouse-full'
    && kept.dateStatus === 'dated'
    && kept.url === job.url
    && chunks.length === 1
    && parsed?.url === job.url
    && parsed.company === 'Acme'
    && parsed.title === 'Staff Engineer'
  ) {
    pass('keepAndMaybeEmit pushes the kept offer and emits it in --json mode');
  } else {
    fail(`composer keep+emit: ${JSON.stringify({ sink, chunks })}`);
  }
}

{
  const sink = [];
  const chunks = captureStderr(() => {
    keepAndMaybeEmit(job, 'greenhouse-full', sink, new Map(), { json: false });
  });
  if (sink.length === 1 && chunks.length === 0) {
    pass('keepAndMaybeEmit still keeps the offer when --json is off, but does not emit');
  } else {
    fail(`composer json:false: ${JSON.stringify({ sink: sink.length, chunks })}`);
  }
}

{
  const sink = [];
  const blocked = { ...job, company: 'Acme Corp.' };
  const chunks = captureStderr(() => {
    keepAndMaybeEmit(
      blocked,
      'greenhouse-full',
      sink,
      new Map([['acmecorp', { reason: 'skip' }]]),
      { json: true },
    );
  });
  if (sink.length === 1 && sink[0].company === 'Acme Corp.' && chunks.length === 0) {
    pass('keepAndMaybeEmit still records a blacklisted match but does not emit it live');
  } else {
    fail(`composer blacklist: ${JSON.stringify({ sink, chunks })}`);
  }
}

{
  const src = readFileSync(join(ROOT, 'scan-ats-full.mjs'), 'utf8');
  const seedCall = src.includes('keepAndMaybeEmit(job, sourceName, offers, opts.blacklist, opts)');
  const sweepCall = src.includes('keepAndMaybeEmit(job, `${sourceName}-full`, newOffers, blacklist, opts)');
  if (typeof keepAndMaybeEmit === 'function' && seedCall && sweepCall) {
    pass('sweep and seed loops both call keepAndMaybeEmit (the composer the primitives sit behind)');
  } else {
    fail(`composer call sites: seed=${seedCall} sweep=${sweepCall} exported=${typeof keepAndMaybeEmit}`);
  }
}
