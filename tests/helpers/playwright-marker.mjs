import { writeFileSync } from 'node:fs';

if (process.env.PLAYWRIGHT_MARKER) writeFileSync(process.env.PLAYWRIGHT_MARKER, 'loaded');

export const chromium = {
  async launch() {
    throw new Error('playwright-loaded');
  },
};
