// tests/update-lock-claim.test.mjs — two concurrent `apply` runs must not both
// acquire `.update-lock`. The claim used to be existsSync-then-writeFileSync,
// which is a check-then-write: both runs can observe no lock and both write it,
// then interleave file checkouts against the same install.
//
// The atomic claim is O_EXCL (`flag: 'wx'`), so the kernel decides the winner.
import { pass, fail } from './helpers.mjs';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { claimUpdateLock, releaseUpdateLock } from '../update-system.mjs';

console.log('\nUpdate lock — the claim is atomic');

const root = mkdtempSync(join(tmpdir(), 'co-update-lock-'));
const lockFile = join(root, '.update-lock');

// A free lock is claimed, and the file carries the claim.
if (claimUpdateLock(root) === true) pass('a free .update-lock is claimed');
else fail('a free .update-lock was not claimed');
if (existsSync(lockFile)) pass('claiming .update-lock creates the file');
else fail('claiming .update-lock did not create the file');

// A second claim on a held lock must lose — this is the race the old
// check-then-write let both sides win.
if (claimUpdateLock(root) === false) pass('a second claim loses while the lock is held');
else fail('a second claim won while the lock was held');

// Release, then claim again.
releaseUpdateLock(root);
if (!existsSync(lockFile)) pass('releasing .update-lock removes the file');
else fail('releasing .update-lock left the file behind');
if (claimUpdateLock(root) === true) pass('a released lock can be claimed again');
else fail('a released lock could not be claimed again');
releaseUpdateLock(root);

// A lock left behind by a crashed run is still refused, not overwritten.
writeFileSync(lockFile, 'stale');
if (claimUpdateLock(root) === false) pass('a stale .update-lock is refused, not overwritten');
else fail('a stale .update-lock was overwritten');
releaseUpdateLock(root);

if (claimUpdateLock(root) === true) pass('the lock can be reclaimed after a stale one is cleared');
else fail('the lock could not be reclaimed after a stale one was cleared');
releaseUpdateLock(root);