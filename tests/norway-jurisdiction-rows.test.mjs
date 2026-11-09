import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractRows } from '../check-table-freshness.mjs';

// Norway (NO) rows in the jurisdiction templates (#6615). Pins the verified
// dates, citations and official URLs, and that the NO key stays quoted so a
// YAML 1.1 reader cannot turn it into boolean false.

console.log('\nNorway jurisdiction rows (#6615)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const read = (f) => readFileSync(join(ROOT, 'templates', f), 'utf8');

// --- candidate-paid fees ---
{
  const raw = read('jurisdiction-candidate-fees.yml');
  const no = yaml.load(raw)?.jurisdictions?.NO;
  check('candidate-fees: NO key is quoted', /^ {2}"NO":$/m.test(raw), 'bare NO key');
  check('candidate-fees: NO row carries the verified dates',
    no?.effective === '2024-07-01' && no?.as_of === '2026-11-06', `${no?.effective} / ${no?.as_of}`);
  const ex = (no?.exceptions || []).join('\n');
  check('candidate-fees: NO row cites arbeidsmarkedsloven ss. 26, 27 no. 3 and 30',
    ['s. 26 first paragraph', 's. 26 second paragraph', 's. 27 first paragraph no. 3', 's. 30'].every((c) => ex.includes(c)),
    'citation missing');
  check('candidate-fees: NO applies_to covers job seekers whatever their status and leaves intermediary type unverified',
    /nationality or immigration status/.test(no?.applies_to || '') && /not verified/.test(no?.applies_to || ''),
    'scope missing');
  check('candidate-fees: NO official_source is the Lovdata chapter 8 page',
    no?.official_source?.url === 'https://lovdata.no/dokument/NL/lov/2004-12-10-76/KAPITTEL_8', String(no?.official_source?.url));
}

// --- agency licensing ---
{
  const raw = read('agency-licensing.yml');
  const doc = yaml.load(raw);
  const no = doc?.jurisdictions?.NO;
  check('agency-licensing: NO key is quoted', /^ {2}"NO":$/m.test(raw), 'bare NO key');
  check('agency-licensing: NO row covers staffing enterprises only, effective 2024-01-01',
    no?.licensing_required_for === 'temporary_help_agency' && no?.effective === '2024-01-01' && no?.as_of === '2026-11-06',
    `${no?.licensing_required_for} / ${no?.effective} / ${no?.as_of}`);
  check('agency-licensing: NO registry is the Arbeidstilsynet register',
    no?.registry?.url === 'https://www.arbeidstilsynet.no/bemanningsvirksomhet/'
      && (no?.registry?.what_it_shows || '').length > 0,
    String(no?.registry?.url));
  check('agency-licensing: NO legal basis cites FOR-2008-06-04-541 and the 2024 amendment',
    /FOR-2008-06-04-541/.test(no?.legal_basis || '') && /FOR-2023-05-25-733/.test(no?.legal_basis || ''),
    String(no?.legal_basis));
  check('agency-licensing: NO client-side rule cites § 11 and arbeidsmiljøloven § 14-14',
    /§ 11/.test(no?.client_side_prohibition || '') && /§ 14-14/.test(no?.client_side_prohibition || ''),
    'client-side rule missing');
  check('agency-licensing: NO penalties keep § 13 withdrawal apart from the § 14 penalty',
    /§ 14/.test(no?.penalties || '') && /under § 13/.test(no?.penalties || '') && /not a penalty/.test(no?.penalties || ''),
    String(no?.penalties));
  check('agency-licensing: NO transitional notes say the register does not answer for recruiters',
    /privat arbeidsformidling, defined in arbeidsmarkedsloven § 25/.test(no?.transitional_notes || '') && /expired/.test(no?.transitional_notes || ''),
    'recruiter scope note missing');
  check('agency-licensing: freshness check discovers the NO row with as_of',
    extractRows(doc).some((f) => f.row.jurisdiction === 'NO' && !f.missingAsOf), 'NO row not found');
}

// --- jurisdiction-prohibited content ---
{
  const raw = read('jurisdiction-prohibited-content.yml');
  const doc = yaml.load(raw);
  const no = (doc?.entries || []).find((e) => e.jurisdiction === 'NO');
  check('prohibited-content: NO jurisdiction value is quoted', /- jurisdiction: "NO"$/m.test(raw), 'bare NO value');
  check('prohibited-content: NO entry has the schema fields and effective date',
    no && typeof no.prohibited === 'string' && typeof no.matching === 'string'
      && no.effective === '2018-01-01' && Array.isArray(no.sources) && no.sources.length >= 2,
    JSON.stringify(no?.effective));
  check('prohibited-content: NO legal basis cites ldl § 30 and aml §§ 13-4 and 9-3',
    /§ 30/.test(no?.legal_basis || '') && /§ 13-4/.test(no?.legal_basis || '') && /§ 9-3/.test(no?.legal_basis || ''),
    String(no?.legal_basis));
  check('prohibited-content: NO matching keeps pregnancy without exception and voluntary self-ID as uncertain',
    /no exception for pregnancy/.test(no?.matching || '') && /voluntary self-identification/.test(no?.matching || ''),
    'matching guidance missing');
  check('prohibited-content: no entry carries as_of, so the table stays outside the freshness check',
    !(doc?.entries || []).some((e) => Object.hasOwn(e, 'as_of')), 'as_of added to one entry');
}
