/** Fetch public VC portfolio records for the Python reverse sweep. */

import { readFileSync, writeFileSync } from 'node:fs';
import { SEED_SOURCES } from './vc-portfolios.mjs';

const [input, output] = process.argv.slice(2);
const { seed } = JSON.parse(readFileSync(input, 'utf8'));
if (!Object.hasOwn(SEED_SOURCES, seed)) throw new Error(`Unknown seed source: ${seed}`);
const companies = await SEED_SOURCES[seed].fetch();
writeFileSync(output, JSON.stringify({ companies, partial: companies.partial === true }));
