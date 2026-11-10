// tests/upgrade-fixture-state.test.mjs — the upgrade gate only seeds fixture
// states that match a released shape (#6707).
//
// fixtureStateFor() mapped a pre-v1.18 ancestor tag to a state-v1.16 fixture
// whose files match no released version: its profile was still the flat
// `name`/`narrative` shape both v1.16.0 and v1.18.0 replaced
// (candidate.full_name, target_roles, compensation.target_range,
// location.country), portals.yml used `companies:` with `ats:`/`slug:` while
// both releases read `tracked_companies:` with careers_url,
// data/follow-ups.md carried a five-column header both releases spell as
// eight columns, reports used section names no release's modes/oferta.md
// format produces, and data/scan-history.tsv carried three headerless cells
// while scan.mjs has written a six-column header since 2026-04-10. Meanwhile
// every upgrade leg takes its old tag from newestAncestorTag(), which is
// >= v1.18 on any tree with release tags — so no leg ever seeded
// state-v1.16, and nothing validated those files.
//
// The state is gone now. seed-fixture.mjs refuses unknown states by name
// (assertKnownState), so a later leg that naively re-pins an old tag fails
// loudly instead of silently seeding the wrong shape.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listStates, seedFixture } from '../seed-fixture.mjs';
import { pass, fail, rmSync } from './helpers.mjs';

function check(label, fn) {
  try {
    fn();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message.split('\n')[0]}`);
  }
}

check('the runtime-discovered fixture states are exactly the v1.18 state', () => {
  const states = listStates();
  if (states.includes('state-v1.16')) {
    throw new Error('state-v1.16 is still discoverable - a leg could seed files that match no released shape');
  }
  if (!states.includes('state-v1.18')) {
    throw new Error('state-v1.18 is missing - the upgrade gate has no fixture to seed');
  }
});

check('seedFixture refuses the removed state-v1.16 instead of seeding a wrong shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-fixture-'));
  try {
    const target = join(root, 'install');
    mkdirSync(target, { recursive: true });
    let error = null;
    try {
      seedFixture(target, { state: 'state-v1.16' });
    } catch (err) {
      error = err;
    }
    if (!error || !/Unknown fixture state: state-v1\.16/.test(error.message)) {
      throw new Error(`seedFixture must refuse state-v1.16 by name; got: ${error ? error.message : 'no error - the ghost fixture seeded'}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

check('seeding the live state-v1.18 still materializes a full install', () => {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-fixture-'));
  try {
    mkdirSync(join(root, 'install'), { recursive: true });
    const { files, manifest } = seedFixture(join(root, 'install'), { state: 'state-v1.18' });
    if (files.length < 8) throw new Error(`only ${files.length} files seeded, expected >= 8`);
    if (files.includes('expected.json')) throw new Error('internal expectations file must not seed into an install');
    for (const required of ['config/profile.yml', 'portals.yml', 'data/scan-history.tsv']) {
      if (!files.includes(required)) throw new Error(`required file not seeded: ${required}`);
    }
    if (JSON.stringify(JSON.parse(JSON.stringify(manifest))) !== JSON.stringify(manifest)) {
      throw new Error('manifest is not deterministic');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
