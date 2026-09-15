#!/usr/bin/env node
// Resolves one canonical opportunity into the context used by every interview action.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const { positionals, values } = parseArgs({ args: process.argv.slice(2), options: { db: { type: 'string' }, sessions: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
const usage = 'Usage: node interview-context.mjs <opportunity-id> --db <opportunities.sqlite> [--sessions <dir>]';
const sessionsFor = (dir, company, role) => !existsSync(dir) ? [] : readdirSync(dir).filter(file => file.endsWith('.md') && file !== 'README.md').filter(file => {
  const text = readFileSync(join(dir, file), 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  return front && new RegExp(`^company:\\s*${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(front[1]) && new RegExp(`^role:\\s*${role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(front[1]);
});

if (values.help || !positionals[0] || !values.db) {
  console.log(usage);
  process.exitCode = values.help ? 0 : 1;
} else {
  const store = await openOpportunityStore(values.db);
  try {
    const opportunity = store.opportunity(Number(positionals[0]));
    if (!opportunity) throw new Error(`Unknown opportunity: ${positionals[0]}`);
    const sessions = sessionsFor(values.sessions || 'interview-prep/sessions', opportunity.company, opportunity.role);
    console.log(JSON.stringify({ opportunity, evaluation: store.evaluation(opportunity.id), artifacts: store.artifacts(opportunity.id), application: store.application(opportunity.id), candidateFacts: ['cv.md', 'article-digest.md', 'config/profile.yml', 'modes/_profile.md'], sessions }, null, 2));
  } catch (error) { console.error(`interview-context: ${error.message}`); process.exitCode = 1; }
  finally { store.close(); }
}
