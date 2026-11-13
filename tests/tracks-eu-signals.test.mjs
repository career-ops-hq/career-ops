// tests/tracks-eu-signals.test.mjs — lib/eu-signals.mjs and lib/europe.mjs read language and work-authorization requirements (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-eu-signals.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPostingLanguage, readLanguageRequirements, compareLanguages, readWorkAuthorization, assessWorkAuthorization } from '../lib/eu-signals.mjs';
import { europeCountry, authorizedCountries, EUROPE_COUNTRIES } from '../lib/europe.mjs';

const reqs = text => readLanguageRequirements(text).map(r => [r.language, r.level, r.required]);

test('posting language by function words, unknown when short', () => {
  assert.equal(detectPostingLanguage('Wir suchen einen erfahrenen Entwickler für unser Team in München. Sie arbeiten mit unseren Kunden und entwickeln Lösungen, die nicht nur funktionieren. Das ist eine Stelle für die Zukunft und wir freuen uns.'), 'de');
  assert.equal(detectPostingLanguage('We are looking for an experienced engineer to join our team. You will work with the product and you will have ownership of this area. Our customers are important for your success and that matters.'), 'en');
  assert.equal(detectPostingLanguage('Nous recherchons un ingénieur pour rejoindre notre équipe. Vous travaillez avec les clients et les équipes sur des projets dans une entreprise qui est en croissance pour votre carrière.'), 'fr');
  assert.equal(detectPostingLanguage('AI Engineer'), 'unknown');
  assert.equal(detectPostingLanguage(undefined), 'unknown');
});

test('language requirements map wording to CEFR and separate required from optional', () => {
  assert.deepEqual(reqs('Verhandlungssichere Deutschkenntnisse erforderlich.'), [['de', 'C1', true]]);
  assert.deepEqual(reqs('Fluent English is required; German is a plus.'), [['en', 'C1', true], ['de', 'B2', false]]);
  assert.deepEqual(reqs('Gute Englischkenntnisse (B2)'), [['en', 'B2', true]]);
  assert.deepEqual(reqs('French C1 mandatory'), [['fr', 'C1', true]]);
  assert.deepEqual(reqs('Deutsch auf Muttersprachniveau'), [['de', 'native', true]]);
  assert.deepEqual(reqs('Dutch is nice to have'), [['nl', 'B2', false]]);
  assert.deepEqual(reqs('We build in Python and Go.'), []);
});

test('requirements compared with the languages the profile lists', () => {
  const held = { en: 'C1', de: 'native' };
  assert.equal(compareLanguages(readLanguageRequirements('Fluent French required.'), held).verdict, 'gap');
  assert.equal(compareLanguages(readLanguageRequirements('Verhandlungssichere Deutschkenntnisse erforderlich.'), held).verdict, 'ok');
  assert.equal(compareLanguages(readLanguageRequirements('Fluent German required.'), { de: 'B2' }).verdict, 'stretch');
  assert.equal(compareLanguages(readLanguageRequirements('Dutch is nice to have'), held).verdict, 'ok', 'an optional language never blocks');
});

test('sponsorship and right-to-work wording', () => {
  const uk = readWorkAuthorization('You must have the right to work in the UK. We are unable to offer sponsorship.');
  assert.deepEqual([uk.sponsorship, uk.rightToWork], ['refused', ['GB']]);
  assert.equal(readWorkAuthorization('Visa sponsorship available. Relocation support.').sponsorship, 'offered');
  assert.equal(readWorkAuthorization('We support Blue Card applications.').sponsorship, 'offered');
  assert.deepEqual(readWorkAuthorization('Gültige Arbeitserlaubnis für Deutschland erforderlich.').rightToWork, ['DE']);
  const none = readWorkAuthorization('Nothing here.');
  assert.deepEqual([none.sponsorship, none.rightToWork, none.clearance], ['not_stated', [], null]);
  assert.ok(readWorkAuthorization('Active security clearance required.').clearance);
});

test('work authorization against the candidate status', () => {
  const eu = { status: 'eu_citizen', baseCountry: 'Germany' };
  const assess = (text, who, jobCountries) => assessWorkAuthorization(readWorkAuthorization(text), { ...who, jobCountries }).verdict;
  assert.equal(assess('You must have the right to work in the UK. We are unable to offer sponsorship.', eu, ['GB']), 'blocked', 'the UK needs a visa from EU citizens');
  assert.equal(assess('You must have the right to work in the UK.', eu, ['GB']), 'needs_permit');
  assert.equal(assess('EU work permit required.', eu, ['NL']), 'ok');
  assert.equal(assess('', eu, ['CH']), 'ok', 'Switzerland under free movement');
  assert.equal(assess('', eu, []), 'unknown');
  assert.equal(assess('We do not sponsor visas.', { status: 'needs_sponsorship', baseCountry: 'Germany' }, ['NL']), 'blocked');
  assert.equal(assess('Visa sponsorship available.', { status: 'needs_sponsorship', baseCountry: 'Germany' }, ['NL']), 'needs_permit');
  assert.equal(assess('', { status: 'blue_card', baseCountry: 'Germany' }, ['FR']), 'needs_permit', 'a Blue Card is tied to the issuing country');
  assert.equal(assess('', { status: 'blue_card', baseCountry: 'Germany' }, ['DE']), 'ok');
  assert.equal(assess('US citizens only.', eu, ['DE']), 'check');
});

test('country table', () => {
  assert.equal(europeCountry('Deutschland').iso, 'DE');
  assert.equal(europeCountry('AT').payPeriods, 14);
  assert.equal(europeCountry('Narnia'), null);
  assert.equal(authorizedCountries('eu_citizen', 'DE').has('CH'), true);
  assert.equal(authorizedCountries('eu_citizen', 'DE').has('GB'), false);
  assert.deepEqual([...authorizedCountries('residence_permit', 'DE')], ['DE']);
  assert.equal(authorizedCountries('needs_sponsorship', 'DE').size, 0);
  for (const c of EUROPE_COUNTRIES) {
    assert.match(c.iso, /^[A-Z]{2}$/);
    assert.ok(c.currency && c.minLeaveDays >= 20, c.iso);
  }
  assert.equal(new Set(EUROPE_COUNTRIES.map(c => c.iso)).size, EUROPE_COUNTRIES.length, 'no country twice');
});
