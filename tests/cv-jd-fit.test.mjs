import {
  computeCvJdFit,
  cvPayloadToText,
  extractBlockBRequirements,
  readCvFitIndex,
  resolveJdText,
  writeCvFitIndex,
} from '../cv-jd-fit.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail } from './helpers.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

console.log('cv-jd-fit');
{
  const fit = computeCvJdFit(
    '## Requirements\n- Python, Agile, PostgreSQL',
    'Summary with Python and PostgreSQL.\nAgile/Scrum delivery in regulated industry.',
  );
  ok('returns fit score', fit.fitScore != null);
  ok('coverage > 0', fit.coveragePct > 0);
  ok('payload flattens skills', cvPayloadToText({ skills: [{ category: 'AI', items: 'n8n' }] }).includes('n8n'));

  const root = mkdtempSync(join(tmpdir(), 'cv-fit-'));
  writeCvFitIndex('82', { fitScore: 3.8, coveragePct: 76, gaps: ['Rust', 'Kafka'] }, root);
  const cached = readCvFitIndex('082', root);
  ok('index round-trip', cached?.fitScore === 3.8 && cached.gaps.includes('Rust'));
  rmSync(root, { recursive: true, force: true });

  const root2 = mkdtempSync(join(tmpdir(), 'cv-fit-jd-'));
  mkdirSync(join(root2, 'reports'));
  mkdirSync(join(root2, 'jds'));
  writeFileSync(join(root2, 'reports', '082-RESERVED.md'), '# placeholder\n');
  writeFileSync(join(root2, 'reports', '082-acme-2026-09-17.md'), '## A) Role\nPM role\n\n## B) Match\nPython Agile\n');
  writeFileSync(join(root2, 'jds', 'acme-pm-1.md'), '## Requirements\n- Python\n');
  const jd = resolveJdText(root2, { report: '82' });
  ok('skips RESERVED report for JD lookup', jd.includes('Python'));
  rmSync(root2, { recursive: true, force: true });

  const blockB = `## B) Match with CV\n| Requirement | CV Evidence |\n|---|---|\n| experience delivering content via iterative/agile development | Lines 32-33: Agile portal |\n| B2B SaaS/enterprise software experience | Lines 20-21: n8n prototype |\n`;
  const rows = extractBlockBRequirements(blockB);
  const blockFit = computeCvJdFit('', 'Agile development of bilingual portal. B2B SaaS n8n prototype.', { reportText: blockB });
  ok('block-b requirements parsed', rows.length === 2);
  ok('block-b fit beats token noise', blockFit.fitScore != null && blockFit.fitScore >= 3);
}
