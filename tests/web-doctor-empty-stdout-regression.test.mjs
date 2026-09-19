import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR_ROUTE = join(ROOT, 'web', 'src', 'app', 'api', 'doctor', 'route.ts');

test('doctor route does not coerce empty stdout into a clean setup result', () => {
  const src = readFileSync(DOCTOR_ROUTE, 'utf8');

  // issue 3809 reproduction: when the child process yields empty stdout,
  // `|| "{}"` turns that failure into `{}` and then into onboardingNeeded:false.
  assert.doesNotMatch(
    src,
    /\|\|\s*"\{\}"/,
    'doctor route still falls back to "{}" when stdout is empty',
  );
});
