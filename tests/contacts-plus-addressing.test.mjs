// tests/contacts-plus-addressing.test.mjs
//
// EMAIL_RE used \w for the local part, and \w is [A-Za-z0-9_] — so `+` terminated the match and a
// plus-addressed address was silently TRUNCATED: `recruiter+a1b2…@reply.cutshort.io` was captured as
// `a1b2…@reply.cutshort.io`. A different mailbox, it would bounce, and it still looks like a valid
// address — so nothing downstream could notice that the tracker was showing an unreachable contact.
//
// Recruiting platforms route replies through exactly this form (CutShort, Greenhouse, Lever,
// Workable all use `name+token@reply.domain`), so the addresses being corrupted were the ones that
// actually reach a human.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nextractContacts — plus-addressed relays (#3283)');
try {
  const { extractContacts } = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
  const first = (notes) => extractContacts(notes)[0]?.email;

  const cases = [
    ['CutShort-style reply relay', 'reply to recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io', 'recruiter+a1b2c3d4e5f60718293a4b5c6d7e8f90@reply.cutshort.io'],
    ['Greenhouse-style token', 'mail jobs+ref123@greenhouse.io', 'jobs+ref123@greenhouse.io'],
    ['plain address unchanged', 'recruiter dana@acme.example replied', 'dana@acme.example'],
    ['dots and dashes still fine', 'contact first.last-name@sub.acme.example', 'first.last-name@sub.acme.example'],
  ];
  for (const [label, notes, want] of cases) {
    const got = first(notes);
    if (got === want) pass(`${label}: ${want}`);
    else fail(`${label}: expected ${want}, got ${got}`);
  }

  // Assert the WHOLE expected address, not merely "not the truncated form". A !== check against
  // the broken value also passes for undefined, for '', and for any other wrong-but-different
  // address — so it would keep reporting green while the extractor returned nothing at all.
  const got = first('reply to recruiter+a1b2@reply.cutshort.io');
  if (got === 'recruiter+a1b2@reply.cutshort.io') {
    pass('the plus-addressed relay is captured whole');
  } else if (got === 'a1b2@reply.cutshort.io') {
    fail('address was truncated at the plus again');
  } else {
    fail(`expected recruiter+a1b2@reply.cutshort.io, got ${JSON.stringify(got)}`);
  }
} catch (err) {
  fail(`plus-addressing suite threw: ${err.message}`);
}
