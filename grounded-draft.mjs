#!/usr/bin/env node
// Prints the one grounded context cover, email, and outreach drafts must consume.
import { parseArgs } from 'node:util';
import { linkGroundedContact, loadGroundedApplicationContext } from './src/applications/context.mjs';

const { values } = parseArgs({ options: { db: { type: 'string' }, opportunity: { type: 'string' }, 'link-contact': { type: 'string' }, confirmed: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, strict: true });
if (values.help) {
  console.log('Usage: node grounded-draft.mjs --db <opportunities.db> --opportunity <id> [--link-contact <contacts-key> --confirmed]');
} else if (!values.db || !/^\d+$/.test(values.opportunity || '')) {
  console.error('Usage: node grounded-draft.mjs --db <opportunities.db> --opportunity <id> [--link-contact <contacts-key> --confirmed]');
  process.exitCode = 1;
} else {
  const id = Number(values.opportunity);
  const task = values['link-contact']
    ? linkGroundedContact(values.db, id, values['link-contact'], { confirmed: values.confirmed })
    : Promise.resolve();
  task.then(() => loadGroundedApplicationContext(values.db, id)).then(context => {
    console.log(JSON.stringify(context, null, 2));
  }).catch(error => { console.error(`grounded-draft: ${error.message}`); process.exitCode = 1; });
}
