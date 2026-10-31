// tests/speculative-state.test.mjs — the Speculative state from the gambit mode reaches every tracker script
import { readFileSync } from 'node:fs';
import { pass, fail } from './helpers.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8');

console.log('\nSpeculative state (gambit)');

if (read('templates/states.yml').includes('label: Speculative')) {
  pass('states.yml defines the Speculative state');
} else {
  fail('states.yml is missing the Speculative state');
}

// verify-pipeline.mjs and merge-tracker.mjs derive their canonical states and
// aliases from templates/states.yml, so Speculative reaches them from there.
for (const script of ['verify-pipeline.mjs', 'merge-tracker.mjs']) {
  if (read(script).includes('loadCanonicalStates(')) {
    pass(`${script} accepts Speculative as canonical (via states.yml)`);
  } else {
    fail(`${script} no longer reads canonical states from states.yml`);
  }
}

if (/canonical\s*=\s*\[[^\]]*'Speculative'/s.test(read('normalize-statuses.mjs'))) {
  pass('normalize-statuses.mjs treats Speculative as canonical');
} else {
  fail('normalize-statuses.mjs canonical array missing Speculative');
}

const rank = (id) => Number(read('dedup-tracker.mjs').match(new RegExp(`'${id}': ([\\d.]+)`))?.[1]);
if (rank('evaluated') < rank('speculative') && rank('speculative') < rank('applied')) {
  pass('dedup-tracker.mjs ranks speculative between evaluated and applied');
} else {
  fail(`dedup-tracker.mjs ranks: evaluated=${rank('evaluated')} speculative=${rank('speculative')} applied=${rank('applied')}`);
}

const gambit = read('modes/gambit.md');
if (gambit.includes('`**URL:** N/A (no posting)`') && gambit.includes('| `send` | `Evaluated` |')) {
  pass('gambit keeps research links out of the URL header and records Speculative only once sent');
} else {
  fail('gambit.md lost the no-posting URL header or the send → Evaluated mapping');
}
