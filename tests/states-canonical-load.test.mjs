// tests/states-canonical-load.test.mjs — Bug 1 regression: canonical states
// must be loaded from templates/states.yml, not hardcoded in merge-tracker or
// verify-pipeline.
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nstates — canonical load from states.yml');

const { loadCanonicalStates } = await import(
  pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href
);

const STATES_FILE = join(ROOT, 'templates/states.yml');

// loadCanonicalStates returns all 9 canonical states from the shipped file.
{
  const states = loadCanonicalStates(STATES_FILE);
  const ids = states.map(s => s.id);
  const expected = ['evaluated', 'applied', 'responded', 'interview', 'offer',
                    'rejected', 'discarded', 'skip', 'hired'];
  const missing = expected.filter(id => !ids.includes(id));
  if (missing.length === 0) pass(`all ${expected.length} canonical states present`);
  else fail(`missing state ids: ${missing.join(', ')}`);
}

// Each state has a non-empty label.
{
  const states = loadCanonicalStates(STATES_FILE);
  const noLabel = states.filter(s => !s.label);
  if (noLabel.length === 0) pass('every state has a non-empty label');
  else fail(`states with empty label: ${noLabel.map(s => s.id).join(', ')}`);
}

// Aliases include at least the Spanish equivalents the hardcoded list had.
{
  const states = loadCanonicalStates(STATES_FILE);
  const allAliases = states.flatMap(s => s.aliases.map(a => a.toLowerCase()));
  const checked = ['evaluada', 'aplicado', 'entrevista', 'contratado', 'rechazado'];
  const missing = checked.filter(a => !allAliases.includes(a));
  if (missing.length === 0) pass('Spanish alias coverage maintained');
  else fail(`missing Spanish aliases: ${missing.join(', ')}`);
}

// A custom states.yml with an extra state is parsed correctly.
{
  const tmp = join(ROOT, '.tmp-states-test-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(join(tmp, 'custom-states.yml'), `
states:
  - id: evaluated
    label: Evaluated
    aliases: []
  - id: pending
    label: Pending
    aliases: [waiting, hold]
`);
    const states = loadCanonicalStates(join(tmp, 'custom-states.yml'));
    if (states.length === 2 && states[1].id === 'pending') {
      pass('custom states.yml with extra state parsed correctly');
    } else {
      fail(`unexpected parse result: ${JSON.stringify(states)}`);
    }

    // The alias map built from the custom file includes the new aliases.
    const aliasMap = Object.fromEntries(
      states.flatMap(s => s.aliases.map(a => [a.toLowerCase(), s.label]))
    );
    if (aliasMap['waiting'] === 'Pending' && aliasMap['hold'] === 'Pending') {
      pass('alias map from custom states resolves correctly');
    } else {
      fail(`alias map unexpected: ${JSON.stringify(aliasMap)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Malformed file throws rather than silently returning empty/wrong data.
{
  const tmp = join(ROOT, '.tmp-states-bad-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(join(tmp, 'bad.yml'), 'not_states: true\n');
    try {
      loadCanonicalStates(join(tmp, 'bad.yml'));
      fail('malformed states file should throw');
    } catch (err) {
      if (/malformed/i.test(err.message)) pass('malformed states file throws with clear message');
      else fail(`malformed states file threw unexpected: ${err.message}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
