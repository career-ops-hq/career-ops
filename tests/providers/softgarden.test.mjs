// tests/providers/softgarden.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — softgarden (hosted jobs widget parser)');
try {
  const softgardenModule = await import(pathToFileURL(join(ROOT, 'providers/softgarden.mjs')).href);
  const softgarden = softgardenModule.default;
  const { resolveWidgetUrl, parseSoftgardenDate, parseWidget } = softgardenModule;

  if (softgarden.id === 'softgarden') pass('softgarden.id is "softgarden"');
  else fail(`softgarden.id is ${JSON.stringify(softgarden.id)}`);

  // resolveWidgetUrl — widget URLs pass through, other tenant URLs default,
  // spoofed hosts rejected.
  if (resolveWidgetUrl({ api: 'https://renk-group.softgarden.io/de/widgets/jobs' }) === 'https://renk-group.softgarden.io/de/widgets/jobs') pass('softgarden.resolveWidgetUrl() keeps explicit widget URLs');
  else fail('softgarden.resolveWidgetUrl() should keep the widget URL');
  if (resolveWidgetUrl({ careers_url: 'https://acme.softgarden.io/en/vacancies' }) === 'https://acme.softgarden.io/en/widgets/jobs') pass('softgarden.resolveWidgetUrl() defaults other tenant URLs to the lang widget');
  else fail(`softgarden.resolveWidgetUrl() default wrong: ${resolveWidgetUrl({ careers_url: 'https://acme.softgarden.io/en/vacancies' })}`);
  if (softgarden.detect({ careers_url: 'https://evil.com/x.softgarden.io' }) === null && softgarden.detect({ careers_url: 'https://softgarden.io.evil.com/x' }) === null) {
    pass('softgarden.detect() rejects path- and suffix-spoofed hosts');
  } else {
    fail('softgarden.detect() should reject spoofed hosts');
  }

  if (parseSoftgardenDate('04.07.26') === Date.UTC(2026, 6, 4) && parseSoftgardenDate('7/4/26') === Date.UTC(2026, 6, 4) && parseSoftgardenDate('junk') === undefined) {
    pass('softgarden.parseSoftgardenDate() reads D.M.YY and M/D/YY, rejects junk');
  } else {
    fail('softgarden.parseSoftgardenDate() wrong');
  }

  // parseWidget — matchElement blocks; relative ../../job/ hrefs resolve
  // against the widget path; entities decoded; multi-city joined.
  const sgCard = (id, title, cities) =>
    `<div class="matchElement" id="job_id_${id}">` +
    `<div class="matchValue date">04.07.26</div>` +
    `<div target="_blank" class="matchValue title"><a href="../../job/${id}/slug-${id}?jobDbPVId=9${id}&amp;l=de" target="_blank">${title}</a></div>` +
    `<div class="matchValue audience">Berufserfahrene</div>` +
    `<div class="matchValue ProjectGeoLocationCity"><div><div class="location-container">${cities.map((c) => `<span class="location-view-item">${c}</span>`).join('')}</div></div></div>` +
    `</div>`;
  const sgHtml = '<html>' + sgCard('111', 'Fachkraft (m/w/d) f&#252;r Export &amp; Zoll', ['Hannover']) + sgCard('222', 'SAP Consultant', ['Augsburg', 'M&#252;nchen']) + '</html>';
  const sgRows = parseWidget(sgHtml, 'https://renk-group.softgarden.io/de/widgets/jobs');
  if (sgRows.length === 2) pass('softgarden.parseWidget() yields one row per matchElement');
  else fail(`softgarden.parseWidget() returned ${sgRows.length}, expected 2`);
  if (sgRows[0]?.title === 'Fachkraft (m/w/d) für Export & Zoll') pass('softgarden.parseWidget() decodes entities in titles');
  else fail(`softgarden.parseWidget() title wrong: ${JSON.stringify(sgRows[0]?.title)}`);
  if (sgRows[0]?.url === 'https://renk-group.softgarden.io/job/111/slug-111?jobDbPVId=9111&l=de') pass('softgarden.parseWidget() resolves ../../job/ hrefs against the widget path');
  else fail(`softgarden.parseWidget() url wrong: ${JSON.stringify(sgRows[0]?.url)}`);
  if (sgRows[1]?.location === 'Augsburg / München' && sgRows[0]?.postedAt === Date.UTC(2026, 6, 4)) pass('softgarden.parseWidget() joins cities and parses the date');
  else fail(`softgarden.parseWidget() fields wrong: ${JSON.stringify(sgRows[1])}`);
  if (parseWidget('<html>none</html>', 'https://x.softgarden.io/de/widgets/jobs').length === 0 && parseWidget(undefined, 'https://x').length === 0) {
    pass('softgarden.parseWidget() returns [] for card-less / non-string input');
  } else {
    fail('softgarden.parseWidget() should return [] without cards');
  }

  // fetch — single widget request, jobs normalized.
  const sgCtx = { fetchText: async () => sgHtml };
  const sgJobs = await softgarden.fetch({ name: 'Renk', api: 'https://renk-group.softgarden.io/de/widgets/jobs' }, sgCtx);
  if (sgJobs.length === 2 && sgJobs[0].company === 'Renk' && sgJobs.every((j) => j.url.startsWith('https://renk-group.softgarden.io/job/'))) {
    pass('softgarden.fetch() returns normalized jobs from one widget request');
  } else {
    fail(`softgarden.fetch() wrong: ${JSON.stringify(sgJobs)}`);
  }
} catch (e) {
  fail(`softgarden provider tests crashed: ${e.message}`);
}
