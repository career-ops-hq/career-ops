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

const deText = JSON.stringify(de || {});
check('protected-grounds: DE row cites BAG 2 AZR 621/01, not 7 AZR 621/01',
  deText.includes('2 AZR 621/01') && !deText.includes('7 AZR 621/01'),
  'wrong or missing BAG case number');
check('protected-grounds: DE row credits fixed-term maternity cover to LAG Köln 6 Sa 641/12',
  (de?.grounds || []).some((g) => (g.legitimate_contexts || []).some((c) => /maternity cover \(LAG Köln 6 Sa 641\/12\)/.test(c))),
  'maternity-cover attribution missing');
