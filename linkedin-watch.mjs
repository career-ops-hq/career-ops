#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { LINKEDIN_DROP_DIR } from './lib/linkedin-auto.mjs';
import { importMailDrop } from './lib/linkedin-mail-drop.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const USAGE = `Add LinkedIn job alerts from saved email. No Google account.

  node linkedin-watch.mjs
  node linkedin-watch.mjs --dir data/linkedin-alerts
  node linkedin-watch.mjs --dry-run
  node linkedin-watch.mjs --json

Save each alert as .eml, .txt, or .mbox in the folder. The 15-minute scan
schedule reads that folder for you.
`;

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--dir', '--dry-run', '--json', '--help', '-h'], USAGE, {
    valueFlags: ['--dir'],
    requireOperand: true,
  });
  const root = getCareerOpsRoot();
  const dir = flagValue(args, '--dir') || join(root, LINKEDIN_DROP_DIR);
  const dryRun = hasFlag(args, '--dry-run');
  const json = hasFlag(args, '--json');
  if (!existsSync(dir)) {
    const message = `No alert folder at ${dir}. Create it and save LinkedIn alert emails there.`;
    if (json) console.log(JSON.stringify({ added: 0, message }));
    else console.log(message);
    process.exit(flagValue(args, '--dir') ? 1 : 0);
  }
  const result = await importMailDrop({ root, dir, dryRun });
  if (json) console.log(JSON.stringify(result));
  else console.log(result.message);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
