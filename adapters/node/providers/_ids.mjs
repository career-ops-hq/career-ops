/** Expose installed provider identifiers as raw registry facts to Python. */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders } from './_registry.mjs';

const providers = await loadProviders(dirname(fileURLToPath(import.meta.url)));
process.stdout.write(`${JSON.stringify([...providers.keys()])}\n`);
