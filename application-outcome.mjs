#!/usr/bin/env node
// Records a reviewed outcome against one canonical application without rewriting tracker files.
import { parseArgs } from 'node:util';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const target = { interview_progress: 'interview', offer_received: 'offer', hired: 'hired', offer_declined: 'discarded', rejected: 'rejected', no_response: 'discarded', interview_only: 'discarded' };
const { positionals, values } = parseArgs({ args: process.argv.slice(2), options: { db: { type: 'string' }, source: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
const usage = `Usage: node application-outcome.mjs <opportunity-id> <${Object.keys(target).join('|')}> --db <path> [--source <source>]`;
if (values.help || !values.db || !/^\d+$/.test(positionals[0] || '') || !target[positionals[1]]) {
  console.log(usage);
  process.exitCode = values.help ? 0 : 1;
} else {
  const store = await openOpportunityStore(values.db);
  try {
    const id = Number(positionals[0]);
    const outcome = positionals[1];
    const application = store.application(id);
    if (!application) throw new Error(`Opportunity ${id} has no submitted application`);
    const transitioned = application.status === target[outcome]
      ? { status: application.status }
      : store.transitionApplication(id, target[outcome], { source: values.source || 'candidate-confirmed', payload: { outcome } });
    if (application.status !== target[outcome]) store.recordApplicationActivity(id, 'outcome_recorded', { outcome });
    console.log(JSON.stringify({ opportunityId: id, outcome, status: transitioned.status, preservedArtifacts: store.artifacts(id) }, null, 2));
  } catch (error) { console.error(`application-outcome: ${error.message}`); process.exitCode = 1; }
  finally { store.close(); }
}
