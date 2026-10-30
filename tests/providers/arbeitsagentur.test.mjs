// tests/providers/arbeitsagentur.test.mjs — moved verbatim from test-all.mjs (#1440).
// Fixtures follow the v6 search shape (#2494): the response list is
// `ergebnisliste`, and a posting carries `referenznummer` /
// `stellenangebotsTitel` / `firma` / `stellenlokationen[]`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — arbeitsagentur');

/** One posting in the v6 search shape. */
const v6 = (referenznummer, stellenangebotsTitel, ort, extra = {}) => ({
  referenznummer,
  stellenangebotsTitel,
  firma: 'Co',
  stellenlokationen: [{ adresse: { ort, region: 'BERLIN', land: 'DEUTSCHLAND' } }],
  ...extra,
});

/** A v6 search response. */
const page = (...jobs) => ({ ergebnisliste: jobs });

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

  // buildLocation — reads the v6 `stellenlokationen` array. The address `region`
  // is an uppercase federal-state enum (BADEN_WUERTTEMBERG), not a display name,
  // so it is deliberately dropped rather than joined onto the city.
  if (buildLocation([{ adresse: { ort: 'Berlin', region: 'BERLIN', land: 'DEUTSCHLAND' } }]) === 'Berlin') {
    pass('buildLocation takes the city and omits Germany and the region enum');
  } else {
    fail(`buildLocation DE = ${JSON.stringify(buildLocation([{ adresse: { ort: 'Berlin', region: 'BERLIN', land: 'DEUTSCHLAND' } }]))}`);
  }
  if (buildLocation([{ adresse: { ort: 'Wien', land: 'OESTERREICH' } }]) === 'Wien, OESTERREICH') {
    pass('buildLocation appends a non-German country');
  } else {
    fail(`buildLocation non-DE = ${JSON.stringify(buildLocation([{ adresse: { ort: 'Wien', land: 'OESTERREICH' } }]))}`);
  }
  // A posting can list several addresses: every place is kept in API order,
  // deduped, " · "-joined, with a non-German country on its own place only, and
  // an address without a usable place is skipped.
  const multi = buildLocation([
    { adresse: { ort: 'Hamburg', land: 'DEUTSCHLAND' } },
    { adresse: { ort: 'Bremen' } },
    { adresse: { ort: 'Hamburg', land: 'DEUTSCHLAND' } },
    {},
    { adresse: { land: 'DEUTSCHLAND' } },
    { adresse: { ort: 'Wien', land: 'OESTERREICH' } },
  ]);
  if (multi === 'Hamburg · Bremen · Wien, OESTERREICH') {
    pass('buildLocation joins every distinct place with " · "');
  } else {
    fail(`buildLocation multi = ${JSON.stringify(multi)}`);
  }
  if (buildLocation(null) === '' && buildLocation('x') === '' && buildLocation([]) === '' && buildLocation([{}]) === '') {
    pass('buildLocation returns "" for missing/garbage input');
  } else {
    fail('buildLocation should return "" for missing/garbage input');
  }

  // normalizeJob — happy path encodes the reference number into the detail URL
  const norm = normalizeJob(v6('10000-123/4 X', '  ML Engineer  ', 'Berlin', { firma: ' ACME ' }));
  if (norm && norm.title === 'ML Engineer' && norm.company === 'ACME'
      && norm.url === 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + encodeURIComponent('10000-123/4 X')
      && norm.refnr === '10000-123/4 X') {
    pass('normalizeJob trims fields and URL-encodes the reference number');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }
  if (normalizeJob({ stellenangebotsTitel: 'No refnr' }) === null && normalizeJob({ referenznummer: 'x', stellenangebotsTitel: '' }) === null) {
    pass('normalizeJob returns null without a reference number or title');
  } else {
    fail('normalizeJob should return null when the reference number or title is missing');
  }

  // fetch() — nationwide single-keyword pass, dedup across keywords, header sent
  let sentApiKey = null;
  let sentUrl = null;
  const mkCtx = (byWas) => ({
    fetchJson: async (url, opts) => {
      sentApiKey = opts?.headers?.['X-API-Key'] ?? sentApiKey;
      sentUrl = url;
      const was = new URL(url).searchParams.get('was');
      return page(...(byWas[was] || []));
    },
  });
  const fetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML', 'NLP'] } },
    mkCtx({
      ML: [v6('A', 'ML Engineer', 'Berlin')],
      NLP: [
        v6('A', 'ML Engineer', 'Berlin'), // dup reference number
        v6('B', 'NLP Scientist', 'Köln'),
      ],
    }),
  );
  if (fetched.length === 2 && !('refnr' in fetched[0])) pass('aa.fetch() dedups by reference number and strips it from output');
  else fail(`aa.fetch() returned ${JSON.stringify(fetched)}`);
  if (sentApiKey === 'jobboerse-jobsuche') pass('aa.fetch() sends the X-API-Key header');
  else fail(`aa.fetch() X-API-Key = ${JSON.stringify(sentApiKey)}`);
  // The v4 path is gone (404 as of 2026-08-04, #2494); pin the version so a
  // silent revert can't reintroduce a dead endpoint.
  if (sentUrl && sentUrl.includes('/pc/v6/jobs')) pass('aa.fetch() queries the v6 jobs endpoint');
  else fail(`aa.fetch() endpoint = ${JSON.stringify(sentUrl)}`);

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
          ? page(v6('L', 'ML Engineer', 'Berlin'))
          : page(v6('R', 'ML Engineer (Remote)', 'Hamburg'), v6('X', 'Onsite ML Engineer', 'Hamburg'));
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

  // fetch() — remoteMatch:'filter' narrows server-side with homeoffice=prozentual_0;nv_true and
  // paginates, but still requires proof (here: the posting's own title) before
  // tagging it. The boolean `homeofficemoeglich` is true for every hit of that
  // query, so it cannot separate a fully-remote role from an office-anchored
  // hybrid. Tagging on it would smuggle hybrids past the commute filter, so
  // unproven candidates keep their real city.
  let usedHomeoffice = false;
  const pagesSeen = new Set();
  const filterFetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true, remoteMatch: 'filter', remoteMaxPages: 5, size: 2 } },
    {
      fetchJson: async (url) => {
        const sp = new URL(url).searchParams;
        if (sp.has('wo')) return page(v6('L', 'ML Engineer', 'Berlin'));
        usedHomeoffice = usedHomeoffice || sp.get('homeoffice') === 'prozentual_0;nv_true';
        pagesSeen.add(sp.get('page'));
        return Number(sp.get('page')) === 1
          ? page( // full page (== size) → pagination continues
              v6('R1', 'ML Engineer — 100% Remote', 'München', { homeofficemoeglich: true }),
              v6('R2', 'ML Scientist', 'Stuttgart', { homeofficemoeglich: true }),
            )
          : page(v6('R3', 'NLP Engineer (Homeoffice)', 'Köln', { homeofficemoeglich: true })); // short → stop
      },
    },
  );
  const munich = filterFetched.find(j => j.url.endsWith('R1'));
  const stuttgart = filterFetched.find(j => j.url.endsWith('R2'));
  const koeln = filterFetched.find(j => j.url.endsWith('R3'));
  const TAG = /Deutschlandweit \(Homeoffice\)/;
  if (usedHomeoffice && pagesSeen.has('1') && pagesSeen.has('2') && munich && TAG.test(munich.location)) {
    pass('aa.fetch() remoteMatch:filter sends homeoffice=prozentual_0;nv_true, paginates, and tags titles that claim remote');
  } else {
    fail(`aa.fetch() filter mode = ${JSON.stringify({ usedHomeoffice, pages: [...pagesSeen], munichLoc: munich?.location })}`);
  }
  if (stuttgart && !TAG.test(stuttgart.location) && stuttgart.location === 'Stuttgart') {
    pass('aa.fetch() leaves a home-office hit untagged when nothing proves remote (hybrid stays commute-filtered)');
  } else {
    fail(`aa.fetch() unproven home-office hit = ${JSON.stringify({ loc: stuttgart?.location })}`);
  }
  if (koeln && TAG.test(koeln.location)) {
    pass('aa.fetch() tags remote-titled hits found on later pages');
  } else {
    fail(`aa.fetch() later-page remote hit = ${JSON.stringify({ loc: koeln?.location })}`);
  }
  // The boolean must never be treated as proof on its own: every fixture above
  // carries homeofficemoeglich:true, and R2 still has to stay untagged.
  if (stuttgart && stuttgart.location === 'Stuttgart') {
    pass('aa.fetch() never tags on homeofficemoeglich alone');
  } else {
    fail(`aa.fetch() tagged on the boolean alone: ${JSON.stringify({ loc: stuttgart?.location })}`);
  }

  // fetch() — a stated 100 % home-office share is remote evidence on its own,
  // in both modes, and is applied once; a lower share is not evidence.
  const pctJobs = (sp) => sp.has('wo')
    ? page(v6('L', 'QA Engineer', 'Berlin'))
    : page(
      v6('P100', 'QA Engineer', 'Hamburg', { homeofficemoeglich: true, homeofficetyp: 'ANGABE_IN_PROZENT', homeofficeprozent: 100 }),
      v6('P80', 'Test Engineer', 'Köln', { homeofficemoeglich: true, homeofficetyp: 'ANGABE_IN_PROZENT', homeofficeprozent: 80 }),
    );
  for (const remoteMatch of ['filter', 'title']) {
    const got = await aa.fetch(
      { name: 'AA', arbeitsagentur: { keywords: ['QA'], wo: 'Berlin', remoteNationwide: true, remoteMatch, size: 100 } },
      { fetchJson: async (url) => pctJobs(new URL(url).searchParams) },
    );
    const p100 = got.find(j => j.url.endsWith('P100'));
    const p80 = got.find(j => j.url.endsWith('P80'));
    const p80ok = remoteMatch === 'filter' ? p80 && p80.location === 'Köln' : !p80;
    if (p100 && p100.location === 'Hamburg · Deutschlandweit (Homeoffice)' && p80ok) {
      pass(`aa.fetch() remoteMatch:${remoteMatch} tags a homeofficeprozent:100 hit and not an 80 % one`);
    } else {
      fail(`aa.fetch() remoteMatch:${remoteMatch} homeofficeprozent = ${JSON.stringify(got)}`);
    }
  }

  // normalizeJob — a stated 100 % home-office share appends the remote marker
  // to the company's city; a lower share leaves the city alone.
  const r100 = normalizeJob(v6('A1', 'QA Engineer', 'Augsburg', { homeofficetyp: 'ANGABE_IN_PROZENT', homeofficeprozent: 100 }));
  const r80 = normalizeJob(v6('A2', 'QA Engineer', 'Augsburg', { homeofficetyp: 'ANGABE_IN_PROZENT', homeofficeprozent: 80 }));
  const rNone = normalizeJob(v6('A3', 'QA Engineer', 'Augsburg', { homeofficemoeglich: true, homeofficetyp: 'NACH_VEREINBARUNG' }));
  if (r100?.location === 'Augsburg · Deutschlandweit (Homeoffice)' && r80?.location === 'Augsburg' && rNone?.location === 'Augsburg') {
    pass('normalizeJob appends the remote marker only for homeofficeprozent:100');
  } else {
    fail(`normalizeJob remote locations = ${JSON.stringify([r100?.location, r80?.location, rNone?.location])}`);
  }

  // The marker claims "anywhere in Germany": a posting tied only to addresses
  // abroad never gets it, a posting with any German (or country-less) address does.
  const { hasGermanAddress } = arbeitsagenturModule;
  const at = (ort) => ({ adresse: { ort, land: 'OESTERREICH' } });
  const de = (ort) => ({ adresse: { ort, land: 'DEUTSCHLAND' } });
  if (hasGermanAddress([de('Berlin')]) && hasGermanAddress([at('Wien'), de('Berlin')])
      && hasGermanAddress([{ adresse: { ort: 'Bremen' } }]) && hasGermanAddress([]) && hasGermanAddress(undefined)
      && !hasGermanAddress([at('Wien')]) && !hasGermanAddress([at('Wien'), at('Graz')])) {
    pass('hasGermanAddress: German, country-less or missing addresses count; abroad-only does not');
  } else {
    fail('hasGermanAddress classified a case wrongly');
  }
  const wien100 = normalizeJob({ referenznummer: 'W1', stellenangebotsTitel: 'QA Engineer', stellenlokationen: [at('Wien')], homeofficeprozent: 100 });
  const mixed100 = normalizeJob({ referenznummer: 'W2', stellenangebotsTitel: 'QA Engineer', stellenlokationen: [at('Wien'), de('Berlin')], homeofficeprozent: 100 });
  if (wien100?.location === 'Wien, OESTERREICH' && mixed100?.location === 'Wien, OESTERREICH · Berlin · Deutschlandweit (Homeoffice)') {
    pass('normalizeJob marks a 100 % home-office posting only when it has a German address');
  } else {
    fail(`normalizeJob abroad 100 % = ${JSON.stringify([wien100?.location, mixed100?.location])}`);
  }
  const abroadTitle = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['QA'], wo: 'Berlin', remoteNationwide: true, remoteMatch: 'title' } },
    {
      fetchJson: async (url) => new URL(url).searchParams.has('wo')
        ? page()
        : page({ referenznummer: 'T1', stellenangebotsTitel: 'QA Engineer (Remote)', firma: 'Co', stellenlokationen: [at('Wien')] }),
    },
  );
  if (abroadTitle.length === 1 && abroadTitle[0].location === 'Wien, OESTERREICH' && !('inGermany' in abroadTitle[0])) {
    pass('aa.fetch() does not mark a remote-titled posting tied only to an address abroad');
  } else {
    fail(`aa.fetch() abroad remote title = ${JSON.stringify(abroadTitle)}`);
  }

  // fetch() — the primary (radius) pass carries the same marker, not only the
  // nationwide remote pass.
  const primaryRemote = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['QA'], wo: 'Augsburg' } },
    { fetchJson: async () => page(v6('A1', 'QA Engineer', 'Augsburg', { homeofficeprozent: 100 })) },
  );
  if (primaryRemote.length === 1 && primaryRemote[0].location === 'Augsburg · Deutschlandweit (Homeoffice)') {
    pass('aa.fetch() marks a 100 % home-office hit in the primary pass');
  } else {
    fail(`aa.fetch() primary-pass remote = ${JSON.stringify(primaryRemote)}`);
  }

  // fetch() — a duplicate reference number across pagination pages is kept once.
  const wideRefs = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  const batchFetched = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ML'], wo: 'Berlin', remoteNationwide: true, remoteMatch: 'filter', remoteMaxPages: 5, size: 7 } },
    {
      fetchJson: async (url) => {
        const sp = new URL(url).searchParams;
        if (sp.has('wo')) return page();
        // Page 1 is full (== size) so pagination continues; W1 repeats on page 2.
        return Number(sp.get('page')) === 1
          ? page(...wideRefs.map(r => v6(r, 'ML Engineer (Remote)', 'München')))
          : page(v6('W1', 'ML Engineer (Remote)', 'München'));
      },
    },
  );
  if (batchFetched.length === wideRefs.length && batchFetched.every(j => TAG.test(j.location))) {
    pass('aa.fetch() keeps each duplicated reference number once and tags every proven candidate');
  } else {
    fail(`aa.fetch() paginated tagging = ${JSON.stringify(batchFetched.map(j => j.location))}`);
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
          return page(); // OK answers, just empty
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
        if (new URL(url).searchParams.has('wo')) return page(v6('L', 'ML Engineer', 'Berlin'));
        throw new Error('HTTP 503');
      } },
  );
  if (passBFail.length === 1 && passBFail[0].url.endsWith('L')) {
    pass('aa.fetch() preserves primary (Pass A) results when the remote pass (Pass B) fails');
  } else {
    fail(`aa.fetch() Pass B failure dropped primary: ${JSON.stringify(passBFail)}`);
  }

  // angebotsart: default ARBEIT only; a list queries each type and merges.
  const { parseAngebotsart } = arbeitsagenturModule;
  if (JSON.stringify(parseAngebotsart(undefined)) === '["1"]'
      && JSON.stringify(parseAngebotsart([1, 34, '34', 99])) === '["1","34"]'
      && JSON.stringify(parseAngebotsart('bogus')) === '["1"]') {
    pass('parseAngebotsart() defaults to ["1"], dedupes, and drops unknown codes');
  } else {
    fail('parseAngebotsart() did not normalize offer types');
  }
  const seenArts = [];
  const byArt = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ESG'], wo: 'Bochum', angebotsart: [1, 34] } },
    { fetchJson: async (url, opts) => {
        if (opts?.redirect !== 'error') throw new Error(`redirect must be 'error', got ${opts?.redirect}`);
        const art = new URL(url).searchParams.get('angebotsart');
        seenArts.push(art);
        return art === '34' ? page(v6('P', 'Werkstudent ESG', 'Bochum')) : page(v6('J', 'ESG Analyst', 'Bochum'));
      } },
  );
  if (seenArts.join(',') === '1,34' && byArt.length === 2) {
    pass('aa.fetch() queries each configured angebotsart and merges the results');
  } else {
    fail(`aa.fetch() angebotsart list: arts=${seenArts} jobs=${JSON.stringify(byArt)}`);
  }

  // One offer type failing must not discard the other type's results.
  const oneTypeFailed = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ESG'], wo: 'Bochum', angebotsart: [1, 34] } },
    { fetchJson: async (url) => {
        if (new URL(url).searchParams.get('angebotsart') === '34') throw new Error('HTTP 404');
        return page(v6('J', 'ESG Analyst', 'Bochum'));
      } },
  );
  if (oneTypeFailed.length === 1 && oneTypeFailed[0].url.endsWith('J')) {
    pass('aa.fetch() keeps a successful offer type when another type fails');
  } else {
    fail(`aa.fetch() partial angebotsart failure: ${JSON.stringify(oneTypeFailed)}`);
  }

  // Filter-mode pages are paced across offer types and retried on 429.
  const sleeps = [];
  const filterArts = [];
  let tripped = false;
  const paced = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ESG'], wo: 'Bochum', remoteNationwide: true, remoteMatch: 'filter', angebotsart: [1, 34], size: 1, remoteMaxPages: 2 } },
    {
      sleep: async (ms) => { sleeps.push(ms); },
      fetchJson: async (url) => {
        const sp = new URL(url).searchParams;
        if (!sp.has('homeoffice')) return page();
        if (!tripped && sp.get('angebotsart') === '34') {
          tripped = true;
          throw Object.assign(new Error('HTTP 429'), { status: 429 });
        }
        filterArts.push(`${sp.get('angebotsart')}:${sp.get('page')}`);
        return page(v6(`R${sp.get('angebotsart')}${sp.get('page')}`, 'ESG Analyst (Remote)', 'Hamburg'));
      },
    },
  );
  if (tripped && filterArts.join(',') === '1:1,1:2,34:1,34:2' && paced.length === 4 && sleeps.filter(ms => ms === 200).length === 3) {
    pass('aa.fetch() remoteMatch:filter paces pages across offer types and retries a 429');
  } else {
    fail(`aa.fetch() filter pacing/retry: pages=${filterArts} sleeps=${JSON.stringify(sleeps)} jobs=${paced.length}`);
  }

  // An offer type that exhausts its retries must not stop the next type.
  const afterExhaust = await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ESG'], wo: 'Bochum', remoteNationwide: true, remoteMatch: 'filter', angebotsart: [1, 34] } },
    {
      sleep: async () => {},
      fetchJson: async (url) => {
        const sp = new URL(url).searchParams;
        if (!sp.has('homeoffice')) return page();
        if (sp.get('angebotsart') === '1') throw Object.assign(new Error('HTTP 503'), { status: 503 });
        return page(v6('R34', 'ESG Analyst (Remote)', 'Hamburg'));
      },
    },
  );
  if (afterExhaust.length === 1 && afterExhaust[0].url.endsWith('R34')) {
    pass('aa.fetch() remoteMatch:filter continues with the next offer type after one exhausts its retries');
  } else {
    fail(`aa.fetch() filter per-type failure: ${JSON.stringify(afterExhaust)}`);
  }

  // While probing (ctx.maxPages set), a fetch rejection propagates unwrapped.
  class Sentinel extends Error {}
  const sentinel = new Sentinel('budget reached');
  let caught = null;
  try {
    await aa.fetch(
      { name: 'AA', arbeitsagentur: { keywords: ['ESG', 'CSRD'], wo: 'Bochum', angebotsart: [1, 34] } },
      { maxPages: 2, fetchJson: async (url) => {
          if (new URL(url).searchParams.get('angebotsart') === '34') throw sentinel;
          return page(v6('J', 'ESG Analyst', 'Bochum'));
        } },
    );
  } catch (err) { caught = err; }
  if (caught === sentinel) {
    pass('aa.fetch() rethrows a ctx.fetch* rejection unwrapped while probing (ctx.maxPages)');
  } else {
    fail(`aa.fetch() probe rejection was swallowed or wrapped: ${caught && caught.message}`);
  }

  // While probing, ctx.maxPages caps list requests across the whole walk.
  let probeRequests = 0;
  await aa.fetch(
    { name: 'AA', arbeitsagentur: { keywords: ['ESG', 'CSRD'], wo: 'Bochum', remoteNationwide: true, remoteMatch: 'filter', angebotsart: [1, 34], size: 1, remoteMaxPages: 3 } },
    { maxPages: 1, sleep: async () => {}, fetchJson: async () => {
        probeRequests++;
        return page(v6(`X${probeRequests}`, 'ESG Analyst (Remote)', 'Hamburg'));
      } },
  );
  if (probeRequests === 1) {
    pass('aa.fetch() makes exactly one list request at ctx.maxPages: 1');
  } else {
    fail(`aa.fetch() probe made ${probeRequests} list requests at ctx.maxPages: 1`);
  }

} catch (e) {
  fail(`arbeitsagentur provider tests crashed: ${e.message}`);
}
