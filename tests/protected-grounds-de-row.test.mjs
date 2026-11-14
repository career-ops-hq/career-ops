import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

// Germany (DE) row in templates/protected-grounds.yml (#2333, #6748). The
// test-all header check covers only the commented candidate rows, so this
// pins the DE row itself: its shape, its AGG legal basis, and the corrected
// BAG case number for the pregnancy-question / right-to-lie decision.

console.log('\nprotected-grounds DE row (#6748)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const raw = readFileSync(join(ROOT, 'templates', 'protected-grounds.yml'), 'utf8');
const rows = yaml.load(raw)?.protected_grounds || [];
const de = rows.find((r) => r?.jurisdiction === 'DE');

check('protected-grounds: DE row exists', Boolean(de), 'no row with jurisdiction DE');
check('protected-grounds: DE row has grounds, sources and a quoted as_of',
  Array.isArray(de?.grounds) && de.grounds.length > 0 &&
  de.grounds.every((g) => typeof g?.topic === 'string' && g.topic.length > 0) &&
  Array.isArray(de?.sources) && de.sources.length > 0 &&
  typeof de?.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(de.as_of),
  'incomplete row');

const basis = de?.legal_basis || '';
check('protected-grounds: DE legal_basis cites the AGG',
  basis.includes('AGG') && basis.includes('Allgemeines Gleichbehandlungsgesetz') && /§1\b/.test(basis) && /§7\b/.test(basis),
  'AGG / §1 / §7 missing from legal_basis');

// Both decisions are about the pregnancy question, so look for them on the
// Geschlecht ground only ("Geschlecht (" keeps Geschlechtsidentität out).
const pregnancyGround = (de?.grounds || []).find((g) => g?.topic?.startsWith('Geschlecht ('));
const pregnancyContexts = pregnancyGround?.legitimate_contexts || [];
check('protected-grounds: DE row has the Geschlecht (pregnancy) ground with legitimate_contexts',
  pregnancyContexts.length > 0, 'ground or its legitimate_contexts missing');

const deText = JSON.stringify(de || {});
check('protected-grounds: DE pregnancy ground cites BAG 2 AZR 621/01, and the row never cites 7 AZR 621/01',
  pregnancyContexts.some((c) => c.includes('(BAG 2 AZR 621/01)')) && !deText.includes('7 AZR 621/01'),
  'wrong or missing BAG case number');
check('protected-grounds: DE pregnancy ground credits fixed-term maternity cover to LAG Köln 6 Sa 641/12',
  pregnancyContexts.some((c) => /maternity cover \(LAG Köln 6 Sa 641\/12\)/.test(c)),
  'maternity-cover attribution missing');
