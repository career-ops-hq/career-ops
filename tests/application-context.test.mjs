// Verifies draft context uses a shortlisted SQLite opportunity and candidate fact files.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOpportunityStore } from '../src/opportunities/store.mjs';
import { contactKeyFor, linkGroundedContact, loadGroundedApplicationContext } from '../src/applications/context.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-application-context-'));
try {
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), '# CV\nReal evidence only.\n');
  writeFileSync(join(root, 'config/profile.yml'), 'language:\n  output: zh\n');
  const databasePath = join(root, 'data', 'opportunities.db');
  mkdirSync(join(root, 'data'), { recursive: true });
  const store = await openOpportunityStore(databasePath);
  const opportunity = store.ingest({ url: 'https://example.com/job', company: 'Acme', role: 'Engineer', source: 'test', payload: { description: 'JD evidence' } });
  store.claim(opportunity.id, 'test'); store.recordEligibility(opportunity.id, { status: 'pass', evidence: {} });
  store.recordEvaluation(opportunity.id, { lower: 4, upper: 4, coverage: 1, reportHash: 'hash' });
  store.startApplication(opportunity.id);
  store.recordApplicationArtifact(opportunity.id, { kind: 'application-pdf', path: 'output/acme.pdf', sha256: 'pdf' });
  store.recordVerifiedApplicationPdf(opportunity.id, { path: 'output/acme.pdf', sha256: 'pdf' }); store.close();
  writeFileSync(join(root, 'data/contacts.tsv'), 'Jane Doe\tAcme\trecruiter\tTalent\n');
  const contactKey = contactKeyFor('Jane Doe', 'Acme');
  await assert.rejects(() => linkGroundedContact(databasePath, opportunity.id, contactKey, { root }), /explicit candidate confirmation/);
  await linkGroundedContact(databasePath, opportunity.id, contactKey, { confirmed: true, root });
  const context = await loadGroundedApplicationContext(databasePath, opportunity.id, root);
  assert.equal(context.outputLanguage, 'zh'); assert.match(context.candidate.cv, /Real evidence/);
  assert.equal(context.contacts[0].contactKey, contactKey); assert.equal(context.evidence[0].source, 'test');
  assert.equal(context.evaluation.lower, 4); assert.ok(context.artifacts.some(artifact => artifact.kind === 'verified-application-pdf'));
  assert.equal(context.draftContract.draftOnly, true);
  const command = spawnSync(process.execPath, [join(process.cwd(), 'grounded-draft.mjs'), '--db', databasePath, '--opportunity', String(opportunity.id)], { cwd: root, encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).opportunity.id, opportunity.id);
  console.log('application context: canonical opportunity, facts, language, and contacts linked');
} finally { rmSync(root, { recursive: true, force: true }); }
