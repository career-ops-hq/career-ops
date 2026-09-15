// Owns discovery operation routing and the provider registry shared by every scanner.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders as loadProviderModules, resolveProvider } from '../../providers/_registry.mjs';
export const discoveryOperations = Object.freeze({
  global: 'scan-ats-full.mjs',
  resolve: 'discover-ats.mjs',
  'resolve-company': 'discover-ats.mjs',
  hn: 'scan-hn.mjs',
});

const providers = await loadProviderModules(join(dirname(fileURLToPath(import.meta.url)), '../../providers'));

export function discoveryProvider(id) {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Missing discovery provider: ${id}`);
  return provider;
}

export { loadProviderModules as loadProviders, resolveProvider };
export { normalizeDiscoveryOffer } from './ingest.mjs';
