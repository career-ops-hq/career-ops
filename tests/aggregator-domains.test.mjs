// tests/aggregator-domains.test.mjs — tests for aggregator domain parsing and detection (#3577).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\naggregator-domains — known aggregators matched, Indeed excluded');

try {
  const {
    parseAggregatorDomains,
    checkAggregatorRepost,
    loadAggregatorDomains,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // 1. Test parsing function
  const sample = [
    '# Header comment',
    '# Indeed (indeed.com) is deliberately excluded',
    '',
    'recruit.net # aggregator, reposts listings from other boards',
    'zippia.com # aggregator, scrapes and reposts job listings',
    '  uk.adzuna.com # subdomain example  ',
  ].join('\n');

  const parsedMap = parseAggregatorDomains(sample);

  if (parsedMap.size === 3 && parsedMap.has('recruit.net') && parsedMap.has('zippia.com') && parsedMap.has('uk.adzuna.com')) {
    pass('parseAggregatorDomains ignores comments/blank lines and extracts domain map correctly');
  } else {
    fail('parseAggregatorDomains failed: size=' + parsedMap.size);
  }

  // 2. Test checkAggregatorRepost with known aggregator domain
  const recruitOffer = { url: 'https://recruit.net/job/12345', company: 'Acme', title: 'Developer' };
  const subDomainOffer = { url: 'https://uk.adzuna.com/land/ad/99', company: 'Globex', title: 'Designer' };
  const recruitMatch = checkAggregatorRepost(recruitOffer, parsedMap);
  const subMatch = checkAggregatorRepost(subDomainOffer, parsedMap);

  if (recruitMatch && recruitMatch.domain === 'recruit.net') {
    pass('checkAggregatorRepost matches a known aggregator domain');
  } else {
    fail('checkAggregatorRepost failed for known domain: ' + JSON.stringify(recruitMatch));
  }

  if (subMatch && subMatch.domain === 'uk.adzuna.com') {
    pass('checkAggregatorRepost matches a subdomain of a known aggregator domain');
  } else {
    fail('checkAggregatorRepost failed for subdomain match');
  }

  // 3. Test checkAggregatorRepost with an unrelated domain (no match)
  const cleanOffer = { url: 'https://careers.acme.com/jobs/1', company: 'Acme', title: 'Developer' };
  const cleanMatch = checkAggregatorRepost(cleanOffer, parsedMap);

  if (cleanMatch === null) {
    pass('checkAggregatorRepost returns null for an unrelated company domain');
  } else {
    fail('checkAggregatorRepost returned unexpected match for clean domain: ' + JSON.stringify(cleanMatch));
  }

  // 4. Test Indeed carve-out (Indeed does NOT match)
  const indeedOffer = { url: 'https://www.indeed.com/viewjob?jk=abcdef', company: 'TechCorp', title: 'Engineer' };
  const indeedMatch = checkAggregatorRepost(indeedOffer, parsedMap);

  if (indeedMatch === null) {
    pass('checkAggregatorRepost returns null for Indeed (deliberately excluded carve-out)');
  } else {
    fail('checkAggregatorRepost matched Indeed when it should be excluded: ' + JSON.stringify(indeedMatch));
  }

  // 5. Test loading actual data/aggregator-domains.txt file
  const realDomainsMap = loadAggregatorDomains();
  if (realDomainsMap.size >= 15 && realDomainsMap.has('recruit.net') && realDomainsMap.has('zippia.com')) {
    pass('loadAggregatorDomains successfully loads data/aggregator-domains.txt');
  } else {
    fail('loadAggregatorDomains loaded unexpected size or missing keys: size=' + realDomainsMap.size);
  }

  if (checkAggregatorRepost(indeedOffer, realDomainsMap) === null) {
    pass('data/aggregator-domains.txt does not contain Indeed');
  } else {
    fail('data/aggregator-domains.txt contains Indeed');
  }

} catch (e) {
  fail('aggregator-domains.test.mjs crashed: ' + (e.stack || e.message));
}

