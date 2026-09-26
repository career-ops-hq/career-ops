// tests/claude-web-setup-docs.test.mjs — browser-only setup keeps the privacy boundary explicit (#1978).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';

const setup = readFileSync(join(ROOT, 'docs', 'SETUP.md'), 'utf8').replace(/\s+/g, ' ');

const guarantees = [
  ['links the official Claude Code web quick start', 'https://code.claude.com/docs/en/web-quickstart'],
  ['requires a private repository for personal career data', 'private GitHub repository'],
  ['locates the master CV at the cloud checkout root', '| `cv.md` | Your master CV |'],
  ['locates private workflow state under data', '| `data/` | Tracker and other private workflow state |'],
  ['locates evaluations under reports', '| `reports/` | Job evaluations and generated reports |'],
  ['explains that ignored user data does not cross cloud sessions', 'a new cloud session starts from the repository again'],
  ['forbids force-adding private paths', 'Never force-add these paths'],
];

for (const [description, marker] of guarantees) {
  if (setup.includes(marker)) pass(`Claude Code web setup ${description}`);
  else fail(`Claude Code web setup no longer ${description}`);
}
