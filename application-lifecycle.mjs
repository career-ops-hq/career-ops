#!/usr/bin/env node
// Reads canonical application views and records explicit, validated transitions.
import { parseArgs } from 'node:util';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { db: { type: 'string' }, source: { type: 'string' }, type: { type: 'string' }, confirmed: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  allowPositionals: true,
  strict: true,
});
const usage = 'Usage: node application-lifecycle.mjs view|followups --db <path> | transition <opportunity-id> <status> --source <source> --db <path> | activity <opportunity-id> --type <type> --confirmed --db <path>';
if (values.help || !values.db || !['view', 'followups', 'transition', 'activity'].includes(positionals[0])) {
  console.log(usage);
  process.exitCode = values.help ? 0 : 1;
} else {
  const store = await openOpportunityStore(values.db);
  try {
    if (positionals[0] === 'view') console.log(JSON.stringify(store.applicationViews(), null, 2));
    else if (positionals[0] === 'followups') console.log(JSON.stringify(store.followupViews(), null, 2));
    else if (positionals[0] === 'activity') {
      const id = Number(positionals[1]);
      if (!Number.isInteger(id) || id < 1 || !values.type || !values.confirmed) throw new Error(usage);
      store.recordApplicationActivity(id, values.type);
      console.log(JSON.stringify({ recorded: values.type, opportunityId: id }, null, 2));
    } else {
      const id = Number(positionals[1]);
      if (!Number.isInteger(id) || id < 1 || !positionals[2] || !values.source) throw new Error(usage);
      console.log(JSON.stringify(store.transitionApplication(id, positionals[2], { source: values.source }), null, 2));
    }
  } catch (error) { console.error(`application-lifecycle: ${error.message}`); process.exitCode = 1; }
  finally { store.close(); }
}
