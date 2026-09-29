#!/usr/bin/env node

/** Keep the historical CLI path while Python owns liveness workflow decisions. */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(join(root, 'workflow/.venv/bin/python'),
  ['-B', join(root, 'workflow/liveness_check.py'), ...process.argv.slice(2)],
  { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
