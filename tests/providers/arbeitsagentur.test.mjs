// tests/providers/arbeitsagentur.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — arbeitsagentur');

try {
  const arbeitsagenturModule = await import(pathToFileURL(join(ROOT, 'providers/arbeitsagentur.mjs')).href);
  const aa = arbeitsagenturModule.default;
  const { parseArbeitsagenturConfig, buildLocation, normalizeJob } = arbeitsagenturModule;

  if (aa.id === 'arbeitsagentur') pass('arbeitsagentur.id is "arbeitsagentur"');
  else fail(`arbeitsagentur.id is ${JSON.stringify(aa.id)}`);

  // parseArbeitsagenturConfig — defaults when block is absent
  const def = parseArbeitsagenturConfig({});
  if (def.keywords.length === 0 && def.wo === '' && def.umkreis === 50 && def.days === 30 && def.size === 100 && def.remoteNationwide === false) {
    pass('parseArbeitsagenturConfig applies defaults (umkreis 50, days 30, size 100)');
  } else {
    fail(`parseArbeitsagenturConfig defaults = ${JSON.stringify(def)}`);
  }

  // parseArbeitsagenturConfig — sanitizes keywords and clamps numbers
  const cfg = parseArbeitsagenturConfig({
    arbeitsagentur: { keywords: ['  ML Engineer  ', '', 7, 'NLP'], wo: ' Berlin ', umkreis: 999999, size: 0, days: -3, remoteNationwide: 'yes' },
  });
  if (cfg.keywords.length === 2 && cfg.keywords[0] === 'ML Engineer' && cfg.keywords[1] === 'NLP') {
    pass('parseArbeitsagenturConfig trims keywords and drops empty/non-string entries');
  } else {
    fail(`parseArbeitsagenturConfig keywords = ${JSON.stringify(cfg.keywords)}`);
  }
  if (cfg.wo === 'Berlin' && cfg.umkreis === 1000 && cfg.size === 1 && cfg.days === 1 && cfg.remoteNationwide === false) {
    pass('parseArbeitsagenturConfig clamps umkreis/size/days and treats non-true remoteNationwide as false');
  } else {
    fail(`parseArbeitsagenturConfig sanitized = ${JSON.stringify(cfg)}`);
  }

  // buildLocation — ort/region join, non-DE country appended, DE omitted
  if (buildLocation({ ort: 'Berlin', region: 'Berlin', land: 'Deutschland' }) === 'Berlin, Berlin') {
    pass('buildLocation joins ort/region and omits Germany');
  } else {
    fail(`buildLocation DE = ${JSON.stringify(buildLocation({ ort: 'Berlin', region: 'Berlin', land: 'Deutschland' }))}`);
  }
  if (buildLocation({ ort: 'Wien', land: 'Österreich' }) === 'Wien, Österreich') {
    pass('buildLocation appends non-DE country');
  } else {
    fail(`buildLocation non-DE = ${JSON.stringify(buildLocation({ ort: 'Wien', land: 'Österreich' }))}`);
  }
  if (buildLocation(null) === '' && buildLocation('x') === '') pass('buildLocation returns "" for missing/garbage input');
  else fail('buildLocation should return "" for missing/garbage input');

  // normalizeJob — happy path encodes refnr into the detail URL
  const norm = normalizeJob({ refnr: '10000-123/4 X', titel: '  ML Engineer  ', arbeitgeber: ' ACME ', arbeitsort: { ort: 'Berlin' } });
  if (norm && norm.title === 'ML Engineer' && norm.company === 'ACME'
      && norm.url === 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + encodeURIComponent('10000-123/4 X')
      && norm.refnr === '10000-123/4 X') {
    pass('normalizeJob trims fields and URL-encodes refnr');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }
  if (normalizeJob({ titel: 'No refnr' }) === null && normalizeJob({ refnr: 'x', titel: '' }) === null) {
    pass('normalizeJob returns null without a refnr or title');
  } else {
    fail('normalizeJob should return null when refnr or title is missing');
  }

  // fetch() — nationwide single-keyword pass, dedup across keywords, header sent
  let sentApiKey = null;
  const mkCtx = (byWas) => ({
    fetchJson: async (url, opts) => {
      sentApiKey = opts?.headers?.['X-API-Key'] ?? sentApiKey;
      const was = new URL(url).searchParams.get('was');
      return { stellenangebote: byWas[was] || [] };
    },
  });
  const fetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML', 'NLP'] } },
    mkCtx({
      ML: [{ refnr: 'A', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Berlin' } }],
      NLP: [
        { refnr: 'A', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Berlin' } }, // dup refnr
        { refnr: 'B', titel: 'NLP Scientist', arbeitgeber: 'Co', arbeitsort: { ort: 'Köln' } },
      ],
    }),
  );
  if (fetched.length === 2 && !('refnr' in fetched[0])) pass('aa.fetch() dedups by refnr and strips refnr from output');
  else fail(`aa.fetch() returned ${JSON.stringify(fetched)}`);
  if (sentApiKey === 'jobboerse-jobsuche') pass('aa.fetch() sends the X-API-Key header');
  else fail(`aa.fetch() X-API-Key = ${JSON.stringify(sentApiKey)}`);

  // fetch() — remoteNationwide pass keeps only remote-titled wide hits
  let calls = 0;
  const remoteFetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true } },
    {
      fetchJson: async (url) => {
        calls++;
        const hasWo = new URL(url).searchParams.has('wo');
        // Pass A (wo set) → local hit; Pass B (no wo) → one remote-titled, one not.
        return hasWo
          ? { stellenangebote: [{ refnr: 'L', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Berlin' } }] }
          : { stellenangebote: [
              { refnr: 'R', titel: 'ML Engineer (Remote)', arbeitgeber: 'Co', arbeitsort: { ort: 'Hamburg' } },
              { refnr: 'X', titel: 'Onsite ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Hamburg' } },
            ] };
      },
    },
  );
  if (calls === 2 && remoteFetched.some(j => j.url.endsWith('R')) && !remoteFetched.some(j => j.url.endsWith('X'))) {
    pass('aa.fetch() remoteNationwide keeps remote-titled wide hits and drops onsite ones');
  } else {
    fail(`aa.fetch() remoteNationwide = ${calls} calls, ${JSON.stringify(remoteFetched.map(j => j.url))}`);
  }

  // parseArbeitsagenturConfig — remoteMatch mode + remoteMaxPages (config-driven remote detection)
  const rcfg = parseArbeitsagenturConfig({ arbeitsagentur: { keywords: ['ML'], remoteMatch: 'filter', remoteMaxPages: 50 } });
  if (rcfg.remoteMatch === 'filter' && rcfg.remoteMaxPages === 20) {
    pass('parseArbeitsagenturConfig parses remoteMatch and clamps remoteMaxPages');
  } else {
    fail(`parseArbeitsagenturConfig remoteMatch/maxPages = ${JSON.stringify({ m: rcfg.remoteMatch, p: rcfg.remoteMaxPages })}`);
  }
  const rdef = parseArbeitsagenturConfig({ arbeitsagentur: { keywords: ['ML'], remoteMatch: 'bogus' } });
  if (rdef.remoteMatch === 'title' && rdef.remoteMaxPages === 1) {
    pass('parseArbeitsagenturConfig defaults remoteMatch to "title" and remoteMaxPages to 1');
  } else {
    fail(`parseArbeitsagenturConfig remote defaults = ${JSON.stringify({ m: rdef.remoteMatch, p: rdef.remoteMaxPages })}`);
  }

  // fetch() — remoteMatch:'filter' uses server-side homeoffice filter, paginates, and tags
  // only the candidates the detail endpoint confirms as homeofficetyp VOLLSTAENDIG.
  // `homeoffice=nv_true` also returns NACH_VEREINBARUNG (office-anchored hybrid) roles,
  // which must keep their real city so the commute location_filter still drops them.
  let usedHomeoffice = false;
  const pagesSeen = new Set();
  const detailsSeen = [];
  // R1 München = genuinely remote; R2 Stuttgart = hybrid "nach Absprache"; R3 Köln = lookup fails.
  const HOMEOFFICETYP = { R1: 'VOLLSTAENDIG', R2: 'NACH_VEREINBARUNG' };
  const filterFetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true, remoteMatch: 'filter', remoteMaxPages: 5, size: 2 } },
    {
      fetchJson: async (url) => {
        if (url.includes('/jobdetails/')) {
          const refnr = Buffer.from(url.split('/jobdetails/')[1], 'base64').toString();
          detailsSeen.push(refnr);
          if (!(refnr in HOMEOFFICETYP)) throw new Error('HTTP 404'); // unverifiable → must stay untagged
          return { homeofficetyp: HOMEOFFICETYP[refnr] };
        }
        const sp = new URL(url).searchParams;
        if (sp.has('wo')) {
          return { stellenangebote: [{ refnr: 'L', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Berlin' } }] };
        }
        usedHomeoffice = usedHomeoffice || sp.get('homeoffice') === 'nv_true';
        pagesSeen.add(sp.get('page'));
        return Number(sp.get('page')) === 1
          ? { stellenangebote: [ // full page (== size) → pagination continues
              { refnr: 'R1', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'München' } },
              { refnr: 'R2', titel: 'ML Scientist', arbeitgeber: 'Co', arbeitsort: { ort: 'Stuttgart' } },
            ] }
          : { stellenangebote: [{ refnr: 'R3', titel: 'NLP Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Köln' } }] }; // short → stop
      },
    },
  );
  const munich = filterFetched.find(j => j.url.endsWith('R1'));
  const stuttgart = filterFetched.find(j => j.url.endsWith('R2'));
  const koeln = filterFetched.find(j => j.url.endsWith('R3'));
  const TAG = /Deutschlandweit \(Homeoffice\)/;
  if (usedHomeoffice && pagesSeen.has('1') && pagesSeen.has('2') && munich && TAG.test(munich.location)) {
    pass('aa.fetch() remoteMatch:filter sends homeoffice=nv_true, paginates, and tags confirmed VOLLSTAENDIG roles');
  } else {
    fail(`aa.fetch() filter mode = ${JSON.stringify({ usedHomeoffice, pages: [...pagesSeen], munichLoc: munich?.location })}`);
  }
  if (stuttgart && !TAG.test(stuttgart.location) && stuttgart.location === 'Stuttgart') {
    pass('aa.fetch() does not tag NACH_VEREINBARUNG (hybrid) roles as nationwide remote');
  } else {
    fail(`aa.fetch() NACH_VEREINBARUNG role = ${JSON.stringify({ loc: stuttgart?.location })}`);
  }
  if (koeln && !TAG.test(koeln.location) && koeln.location === 'Köln') {
    pass('aa.fetch() leaves a posting untagged when the homeofficetyp lookup fails');
  } else {
    fail(`aa.fetch() unverifiable role = ${JSON.stringify({ loc: koeln?.location })}`);
  }
  if (detailsSeen.length === 3 && ['R1', 'R2', 'R3'].every(r => detailsSeen.includes(r))) {
    pass('aa.fetch() verifies homeofficetyp once per remote candidate');
  } else {
    fail(`aa.fetch() detail lookups = ${JSON.stringify(detailsSeen)}`);
  }

  // fetch() — the detail lookups must stay batched (VERIFY_BATCH = 5). With more
  // candidates than one batch, peak in-flight requests must never exceed the cap,
  // and a duplicate refnr across pagination pages must not cost a second lookup.
  // Both would pass silently under an unbounded Promise.all / an un-deduped list.
  let inFlight = 0;
  let peakInFlight = 0;
  const detailCalls = [];
  const wideRefs = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  const batchFetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true, remoteMatch: 'filter', remoteMaxPages: 5, size: 7 } },
    {
      fetchJson: async (url) => {
        if (url.includes('/jobdetails/')) {
          const refnr = Buffer.from(url.split('/jobdetails/')[1], 'base64').toString();
          detailCalls.push(refnr);
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise(r => setTimeout(r, 5)); // hold the slot so overlap is observable
          inFlight--;
          return { homeofficetyp: 'VOLLSTAENDIG' };
        }
        const sp = new URL(url).searchParams;
        if (sp.has('wo')) return { stellenangebote: [] };
        // Page 1 is full (== size) so pagination continues; W1 repeats on page 2.
        return Number(sp.get('page')) === 1
          ? { stellenangebote: wideRefs.map(r => ({ refnr: r, titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'München' } })) }
          : { stellenangebote: [{ refnr: 'W1', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'München' } }] };
      },
    },
  );
  if (peakInFlight > 0 && peakInFlight <= 5) {
    pass(`aa.fetch() caps concurrent homeofficetyp lookups at VERIFY_BATCH (peak ${peakInFlight})`);
  } else {
    fail(`aa.fetch() peak in-flight detail requests = ${peakInFlight} (expected 1..5)`);
  }
  if (detailCalls.length === wideRefs.length && new Set(detailCalls).size === wideRefs.length) {
    pass('aa.fetch() verifies each duplicated refnr only once');
  } else {
    fail(`aa.fetch() detail calls = ${detailCalls.length} (${JSON.stringify(detailCalls)}), expected ${wideRefs.length} unique`);
  }
  if (batchFetched.length === wideRefs.length && batchFetched.every(j => /Deutschlandweit \(Homeoffice\)/.test(j.location))) {
    pass('aa.fetch() tags every confirmed VOLLSTAENDIG candidate across batches');
  } else {
    fail(`aa.fetch() batched tagging = ${JSON.stringify(batchFetched.map(j => j.location))}`);
  }

  // fetch() — no keywords throws; total outage throws (not silent)
  let noKw = false;
  try { await aa.fetch({ name: 'AA', arbeitsagentur: {} }, mkCtx({})); } catch { noKw = true; }
  if (noKw) pass('aa.fetch() throws when no keywords are configured');
  else fail('aa.fetch() should throw without keywords');

  let outage = false;
  try {
    await aa.fetch({ name: 'AA', arbeitsagentur: { keywords: ['ML'] } }, { fetchJson: async () => { throw new Error('HTTP 503'); } });
  } catch { outage = true; }
  if (outage) pass('aa.fetch() throws when every keyword request fails (no silent empty)');
  else fail('aa.fetch() should throw on total outage');

  // fetch() — one keyword answers (empty) while another fails → NOT a total
  // outage; partial success must not throw.
  let partialThrew = false;
  let partial;
  try {
    partial = await aa.fetch(
      { name: 'AA', arbeitsagentur: { keywords: ['OK', 'BAD'] } },
      { fetchJson: async (url) => {
          if (new URL(url).searchParams.get('was') === 'BAD') throw new Error('HTTP 503');
          return { stellenangebote: [] }; // OK answers, just empty
        } },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('aa.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`aa.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }

  // fetch() — Pass A succeeds with jobs, optional Pass B fails → Pass A jobs kept.
  const passBFail = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true } },
    { fetchJson: async (url) => {
        // Pass A (wo set) returns a job; Pass B (no wo) throws.
        if (new URL(url).searchParams.has('wo')) {
          return { stellenangebote: [{ refnr: 'L', titel: 'ML Engineer', arbeitgeber: 'Co', arbeitsort: { ort: 'Berlin' } }] };
        }
        throw new Error('HTTP 503');
      } },
  );
  if (passBFail.length === 1 && passBFail[0].url.endsWith('L')) {
    pass('aa.fetch() preserves primary (Pass A) results when the remote pass (Pass B) fails');
  } else {
    fail(`aa.fetch() Pass B failure dropped primary: ${JSON.stringify(passBFail)}`);
  }

} catch (e) {
  fail(`arbeitsagentur provider tests crashed: ${e.message}`);
}

