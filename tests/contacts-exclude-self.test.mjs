// tests/contacts-exclude-self.test.mjs
//
// extractContacts had no concept of "me". Tracker notes routinely cite the candidate's own mailbox
// while recording where a search ran — "searched both accounts (personal + me@work.example)",
// written to establish that a reply was NOT received — and that was read as a repliable human.
// The row then advertises a contact that cannot be written to, which is worse than reporting none:
// it makes an un-chaseable row look actionable in the follow-up dashboard.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nextractContacts — exclude the candidate\'s own addresses (#3281)');
try {
  const { extractContacts, loadSelfIdentities } = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
  const self = new Set(['me@work.example']);

  const mine = extractContacts('searched both accounts (personal + me@work.example) for this thread', self);
  if (mine.length === 0) pass('a note citing the candidate\'s own address yields no contact');
  else fail(`self-mention produced ${JSON.stringify(mine)}`);

  const theirs = extractContacts('recruiter Dana (dana@acme.example) said they would call', self);
  if (theirs.length === 1 && theirs[0].email === 'dana@acme.example') pass('a real counterparty address is still extracted');
  else fail(`real contact produced ${JSON.stringify(theirs)}`);

  const mixed = extractContacts('mailed dana@acme.example from me@work.example', self);
  if (mixed.length === 1 && mixed[0].email === 'dana@acme.example') pass('only the counterparty survives when both appear');
  else fail(`mixed note produced ${JSON.stringify(mixed)}`);

  // Case-insensitive: profiles and notes disagree on casing all the time.
  const upper = extractContacts('cc ME@Work.Example on the thread', self);
  if (upper.length === 0) pass('self matching is case-insensitive');
  else fail(`uppercase self-mention produced ${JSON.stringify(upper)}`);

  // Fails open: with no identities configured, behaviour is exactly as before.
  const none = extractContacts('mailed dana@acme.example from me@work.example', new Set());
  if (none.length === 2) pass('with no identities configured, nothing is filtered (unchanged behaviour)');
  else fail(`empty identity set produced ${JSON.stringify(none)}`);

  if (loadSelfIdentities('/nonexistent/profile.yml').size === 0) pass('an absent profile yields no identities rather than throwing');
  else fail('absent profile did not yield an empty set');

  // A hand-edited profile can hold a mapping here instead of a list. `for...of` on an object throws,
  // and SELF_IDENTITIES is initialised at import time, so that would take the whole module down at
  // load over a cosmetic config mistake.
  const { mkdtempSync, writeFileSync } = await import('fs');
  const { tmpdir } = await import('os');
  const dir = mkdtempSync(join(tmpdir(), 'self-ids-'));
  const profile = join(dir, 'profile.yml');

  writeFileSync(profile, 'candidate:\n  email: a@b.c\n  alternate_emails: { work: me@x.y }\n');
  let mapped;
  try {
    mapped = loadSelfIdentities(profile);
    pass('a mapping under alternate_emails does not throw');
  } catch (err) {
    fail(`a mapping under alternate_emails threw: ${err.message}`);
  }
  if (mapped && mapped.size === 1 && mapped.has('a@b.c')) pass('the malformed key is ignored and candidate.email still loads');
  else fail(`mapping case produced ${mapped && [...mapped]}`);

  writeFileSync(profile, 'candidate:\n  email: a@b.c\n  alternate_emails:\n    - me@x.y\n');
  const listed = loadSelfIdentities(profile);
  if (listed.size === 2 && listed.has('me@x.y')) pass('a proper list of alternate_emails is read');
  else fail(`list case produced ${[...listed]}`);
} catch (err) {
  fail(`self-contact suite threw: ${err.message}`);
}
