// tests/provider-id-cache.test.mjs — the store behind ctx.idCache.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';
import { openProviderIdCache } from '../provider-id-cache.mjs';

console.log('\nProvider id cache (ctx.idCache store)');
const dir = mkdtempSync(join(tmpdir(), 'career-ops-provider-ids-'));
const read = (id) => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
try {
  // A fresh store has nothing, and an unchanged slice writes no file.
  {
    const store = openProviderIdCache(dir);
    const acme = store.forProvider('acme');
    if (acme && acme.get('board-a') === undefined) pass('an empty store returns undefined for an unknown key');
    else fail('an empty store should return undefined');
    await store.save();
    if (!existsSync(join(dir, 'acme.json'))) pass('save() writes nothing for a slice this run did not change');
    else fail('save() wrote a file for an unchanged slice');
  }

  // set / get / delete, saved as one sorted JSON object per provider with nested values intact.
  {
    const store = openProviderIdCache(dir);
    const acme = store.forProvider('acme');
    acme.set('zeta', { id: 2, domain: 'zeta', checkedAt: '2026-10-01T00:00:00.000Z' });
    acme.set('alpha', { id: 1, domain: 'alpha', checkedAt: '2026-10-01T00:00:00.000Z' });
    acme.set('gone', { id: 3 });
    acme.delete('gone');
    if (acme.get('alpha')?.id === 1 && acme.get('gone') === undefined) pass('set() and delete() are visible to get() at once');
    else fail(`in-memory set/delete wrong: ${JSON.stringify([acme.get('alpha'), acme.get('gone')])}`);
    await store.save();
    const saved = read('acme');
    if (JSON.stringify(Object.keys(saved)) === '["alpha","zeta"]' && saved.zeta.domain === 'zeta' && saved.alpha.checkedAt === '2026-10-01T00:00:00.000Z') {
      pass('save() writes sorted keys and keeps nested values whole');
    } else {
      fail(`saved file wrong: ${JSON.stringify(saved)}`);
    }
  }

  // A later run reads the saved values; each provider has its own file.
  {
    const store = openProviderIdCache(dir);
    if (store.forProvider('acme').get('zeta')?.id === 2 && store.forProvider('bigco').get('zeta') === undefined) {
      pass('a later run reads the saved values, and providers do not share keys');
    } else {
      fail('a later run did not read the saved slice, or slices leaked between providers');
    }
  }

  // Two runs that overlap keep each other's entries, also when they save at the same time.
  {
    const first = openProviderIdCache(dir);
    const second = openProviderIdCache(dir);
    first.forProvider('acme').set('beta', { id: 4 });
    second.forProvider('acme').set('gamma', { id: 5 });
    second.forProvider('acme').delete('alpha');
    await Promise.all([first.save(), second.save()]);
    const saved = read('acme');
    if (saved.beta?.id === 4 && saved.gamma?.id === 5 && saved.zeta?.id === 2 && !('alpha' in saved)) {
      pass('save() merges under a lock, so two runs saving at once keep both sets of changes');
    } else {
      fail(`overlapping runs lost an entry: ${JSON.stringify(saved)}`);
    }
    if (!existsSync(join(dir, 'acme.json.lock'))) pass('save() releases its lock');
    else fail('save() left acme.json.lock behind');
  }

  // A change made while a save is running is kept for the next save.
  {
    const store = openProviderIdCache(dir);
    const acme = store.forProvider('acme');
    acme.set('delta', { id: 6 });
    const saving = store.save();
    acme.set('epsilon', { id: 7 });
    await saving;
    await store.save();
    const saved = read('acme');
    if (saved.delta?.id === 6 && saved.epsilon?.id === 7) pass('a change made during save() is written by the next save()');
    else fail(`a change made during save() was lost: ${JSON.stringify(saved)}`);
  }

  // A provider id that is not a plain name gets no slice; a corrupt file reads as empty.
  {
    const store = openProviderIdCache(dir);
    if (store.forProvider('../evil') === undefined && store.forProvider('') === undefined && store.forProvider(undefined) === undefined) {
      pass('a provider id that is not a plain name gets no slice');
    } else {
      fail('an unsafe provider id got a slice');
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.json'), '{not json', 'utf8');
    const broken = store.forProvider('broken');
    if (broken.get('x') === undefined) pass('an unreadable cache file reads as an empty slice');
    else fail('an unreadable cache file should read as empty');
    broken.set('x', { id: 1 });
    await store.save();
    if (read('broken').x?.id === 1) pass('a slice read from an unreadable file is rewritten as valid JSON');
    else fail('the unreadable file was not replaced');
  }

  // A slice that cannot be written does not stop the others: they are saved,
  // the failed slice keeps its changes for the next save(), and the error is thrown.
  {
    mkdirSync(join(dir, 'blocked.json'), { recursive: true });
    const store = openProviderIdCache(dir);
    store.forProvider('blocked').set('k', { id: 1 });
    store.forProvider('after').set('k', { id: 2 });
    let error = null;
    try {
      await store.save();
    } catch (err) {
      error = err;
    }
    const after = existsSync(join(dir, 'after.json')) ? read('after') : null;
    if (error && after?.k?.id === 2) pass('save() writes the other slices when one fails, then throws');
    else fail(`save() with one failing slice: error=${error?.message}, after=${JSON.stringify(after)}`);
    rmSync(join(dir, 'blocked.json'), { recursive: true, force: true });
    await store.save();
    if (read('blocked').k?.id === 1) pass('the failed slice keeps its changes for the next save()');
    else fail('the failed slice lost its changes');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
