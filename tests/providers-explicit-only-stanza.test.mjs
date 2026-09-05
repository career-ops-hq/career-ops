// tests/providers-explicit-only-stanza.test.mjs — every provider module that
// omits detect() can only ever be reached via an explicit `provider:` field
// (resolveProvider() in providers/_registry.mjs never calls a missing
// detect()), so templates/portals.example.yml is where a user learns HOW to
// configure one — the required/optional fields, as a copy-pasteable stanza.
// Checks that coverage directly against the real provider directory rather
// than trusting the file's own comment claiming to be complete.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nproviders without detect() each get a portals.example.yml stanza');

const { loadProviders } = await import(
  pathToFileURL(join(ROOT, 'providers', '_registry.mjs')).href
);

const providers = await loadProviders(join(ROOT, 'providers'));
const explicitOnlyIds = [...providers.values()]
  .filter((p) => typeof p.detect !== 'function')
  .map((p) => p.id)
  .sort();

if (explicitOnlyIds.length > 0) {
  pass(`found ${explicitOnlyIds.length} provider(s) with no detect(): ${explicitOnlyIds.join(', ')}`);
} else {
  fail('discovered zero providers with no detect() — loadProviders() likely broke, this suite would pass vacuously');
}

const exampleYml = readFileSync(join(ROOT, 'templates', 'portals.example.yml'), 'utf-8');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const missingStanza = explicitOnlyIds.filter((id) => {
  const re = new RegExp(`provider:\\s*"?${escapeRegExp(id)}"?(?![\\w-])`);
  return !re.test(exampleYml);
});

if (missingStanza.length === 0) {
  pass('every no-detect() provider has a `provider: <id>` stanza in templates/portals.example.yml');
} else {
  fail(`no-detect() provider(s) with no stanza in templates/portals.example.yml: ${missingStanza.join(', ')}`);
}
