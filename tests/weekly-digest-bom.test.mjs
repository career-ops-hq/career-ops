import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessions } from '../weekly-digest.mjs';

const SESSION = [
  '---',
  'company: Acme',
  'role: Data Engineer',
  'round: behavioral',
  'date: 2026-11-10',
  'source: debrief',
  '---',
  '',
  '## Q1',
  '**Interviewer:** Tell me about a time you led a project.',
  '<!-- competency: stakeholder-management -->',
  '**Candidate:** ...',
  '',
].join('\n');

test('a session file saved with a byte order mark is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-digest-bom-'));
  try {
    writeFileSync(join(dir, 'acme-data-engineer-behavioral-2026-11-10.md'), `\uFEFF${SESSION}`);
    writeFileSync(join(dir, 'globex-data-engineer-behavioral-2026-11-11.md'), `\uFEFF${SESSION.replace('Acme', 'Globex').replace('2026-11-10', '2026-11-11').replace(/\n/g, '\r\n')}`);
    const sessions = loadSessions(dir).sort((a, b) => a.company.localeCompare(b.company));
    assert.deepEqual(sessions.map((s) => [s.company, s.date, s.competencyTags]), [
      ['Acme', '2026-11-10', ['stakeholder-management']],
      ['Globex', '2026-11-11', ['stakeholder-management']],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
