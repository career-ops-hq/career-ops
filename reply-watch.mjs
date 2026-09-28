#!/usr/bin/env node
// Classifies replies into canonical, suggestion-only application activities.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { classifyReply } from './reply-matcher.mjs';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const { positionals, values } = parseArgs({ args: process.argv.slice(2), options: { db: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
const usage = 'Usage: node reply-watch.mjs <reply-candidates.json> --db <opportunities.db>';
if (values.help || !values.db || !positionals[0]) {
  console.log(usage);
  process.exitCode = values.help ? 0 : 1;
} else {
  const candidates = JSON.parse(fs.readFileSync(positionals[0], 'utf8'));
  const store = await openOpportunityStore(values.db);
  try {
    const suggestions = [];
    for (const candidate of candidates) {
      const id = Number(candidate.opportunity_id);
      const reply = classifyReply(candidate);
      const status = String(reply.suggestedTrackerUpdate || '').toLowerCase();
      if (!Number.isInteger(id) || !store.application(id) || !['responded', 'interview', 'offer', 'rejected'].includes(status)) continue;
      store.recordApplicationActivity(id, 'reply_suggested', { messageId: candidate.message_id, toStatus: status, evidence: reply.evidence || [] });
      suggestions.push({ opportunityId: id, current: store.application(id).status, suggested: status, messageId: candidate.message_id });
    }
    console.log(JSON.stringify({ suggestions, note: 'Suggestions only. Confirm and run workflow/career_ops.py application transition with --confirmed and --source.' }, null, 2));
  } finally { store.close(); }
}
